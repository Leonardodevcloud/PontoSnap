import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { comTenant, empregado, pontoPerfilRegra, type Db } from '@ponto/db';
import { DB } from '../database/database.module';
import { TratamentoService } from '../tratamento/tratamento.service';
import { DeepSeekService, type Mensagem } from './deepseek.service';
import { buscarConhecimento } from './conhecimento/base';
import { mascarar, restaurar, type MapaMascara } from './mascara';
import { SISTEMA_ARGOS, embrulhar } from './prompts';

export interface PerguntaArgos {
  pergunta: string;
  empregadoId?: string | null;
  mes?: string | null;             // AAAA-MM
  historico?: { pergunta: string; resposta: string }[];
}

export interface RespostaArgos {
  resposta: string;
  fontes: string[];
  pessoa: string | null;
  empregadoId: string | null;
  mes: string;
}

/** Argos: explica o ponto (apuração + regras + CLT/CCT) com a IA do DeepSeek. */
@Injectable()
export class ArgosService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ia: DeepSeekService,
    private readonly tratamento: TratamentoService,
  ) {}

  get ativo(): boolean { return this.ia.ativo; }

  async perguntar(tenantId: string, _usuarioId: string, p: PerguntaArgos): Promise<RespostaArgos> {
    const pergunta = (p.pergunta ?? '').trim();
    if (!pergunta) throw new BadRequestException('Pergunta vazia.');

    const mes = /^\d{4}-\d{2}$/.test(p.mes ?? '') ? p.mes! : new Date().toISOString().slice(0, 7);
    const empregadoId = p.empregadoId || (await this.acharPessoa(tenantId, pergunta));

    const mapa: MapaMascara = new Map();
    const nomes: string[] = [];
    const partes: string[] = [];
    let pessoaNome: string | null = null;

    if (empregadoId) {
      const emp = (await comTenant(this.db, tenantId, (tx) =>
        tx.select().from(empregado).where(and(eq(empregado.id, empregadoId), eq(empregado.tenantId, tenantId))).limit(1)))[0];
      if (emp) {
        pessoaNome = emp.nome;
        nomes.push(emp.nome);
        partes.push(`REGRAS DO FUNCIONÁRIO:\n${await this.regrasDaPessoa(tenantId, emp)}`);
        const { inicio, fim } = this.periodo(mes);
        try {
          const fer = (await this.tratamento.feriadosDoEmpregado(tenantId, empregadoId, inicio, fim) as { data?: string }[])
            .map((f) => f.data).filter((d): d is string => !!d);
          const ap = await this.tratamento.apurarPeriodoCLT(tenantId, empregadoId, inicio, fim, fer);
          partes.push(`APURAÇÃO DE ${mes} (calculada pelo sistema, determinística):\n${JSON.stringify(ap).slice(0, 9000)}`);
        } catch (e) {
          partes.push(`APURAÇÃO DE ${mes}: não consegui calcular agora (${(e as Error).message}).`);
        }
      }
    }

    const itens = buscarConhecimento(pergunta);
    if (itens.length) partes.push(`BASE DE CONHECIMENTO:\n${itens.map((i) => `[${i.codigo}] ${i.titulo}\n${i.texto}`).join('\n\n')}`);

    const materiais = mascarar(partes.join('\n\n') || '(sem materiais específicos; responda com a base da CLT se possível)', nomes, mapa);
    const mensagens: Mensagem[] = [];
    for (const t of (p.historico ?? []).slice(-4)) {
      mensagens.push({ papel: 'user', conteudo: mascarar(t.pergunta, nomes, mapa) });
      mensagens.push({ papel: 'assistant', conteudo: mascarar(t.resposta, nomes, mapa) });
    }
    mensagens.push({
      papel: 'user',
      conteudo:
        (pessoaNome ? `Pergunta sobre ${mascarar(pessoaNome, nomes, mapa)} (mês ${mes}).\n` : '') +
        `Materiais:\n${embrulhar(materiais)}\n\nPergunta:\n${embrulhar(mascarar(pergunta, nomes, mapa))}`,
    });

    const bruto = await this.ia.gerar({ sistema: SISTEMA_ARGOS, mensagens, json: true, temperatura: 0.1, maxTokens: 1400, raciocinio: 'desligado' });
    let out: { resposta?: string; fontes?: string[] };
    try { out = JSON.parse(bruto) as { resposta?: string; fontes?: string[] }; }
    catch { out = { resposta: bruto }; }
    const resposta = restaurar((out.resposta ?? '').trim() || 'Não consegui montar a resposta.', mapa);
    const fontes = Array.isArray(out.fontes) ? out.fontes.map((x) => String(x)) : [];
    return { resposta, fontes, pessoa: pessoaNome, empregadoId: empregadoId || null, mes };
  }

  private periodo(mes: string) {
    const [a, m] = mes.split('-').map(Number);
    return { inicio: `${mes}-01`, fim: new Date(Date.UTC(a!, m!, 0)).toISOString().slice(0, 10) };
  }

  /** Acha o funcionário citado na pergunta pelo nome (fallback quando não vem o id). */
  private async acharPessoa(tenantId: string, pergunta: string): Promise<string | undefined> {
    const emps = await comTenant(this.db, tenantId, (tx) =>
      tx.select({ id: empregado.id, nome: empregado.nome }).from(empregado)
        .where(and(eq(empregado.tenantId, tenantId), eq(empregado.ativo, true))));
    const limpo = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const p = limpo(pergunta);
    const achados = emps
      .map((e) => ({ e, n: limpo(e.nome) }))
      .filter(({ n }) => {
        const primeiro = n.split(' ')[0] ?? '';
        return n.length > 2 && (p.includes(n) || (primeiro.length > 2 && new RegExp(`\\b${primeiro}\\b`).test(p)));
      })
      .sort((a, b) => b.n.length - a.n.length);
    return achados[0]?.e.id;
  }

  private async regrasDaPessoa(tenantId: string, emp: typeof empregado.$inferSelect): Promise<string> {
    const linhas: string[] = [
      `Nome: ${emp.nome}. Admissão: ${emp.dataAdmissao ?? '—'}. Salário mensal: ${emp.salarioMensal ?? '—'}.`,
    ];
    if (emp.perfilRegraId) {
      const perfil = (await comTenant(this.db, tenantId, (tx) =>
        tx.select().from(pontoPerfilRegra).where(eq(pontoPerfilRegra.id, emp.perfilRegraId!)).limit(1)))[0];
      if (perfil) {
        linhas.push(`Perfil de regra: ${perfil.nome}. Config: ${JSON.stringify(perfil.config)}.`);
        if (perfil.cctSindicato) linhas.push(`Convenção coletiva: ${perfil.cctSindicato}${perfil.cctVigencia ? ` (vigência ${perfil.cctVigencia})` : ''}.`);
        else linhas.push('Convenção coletiva: não informada no perfil — usar pisos da CLT.');
      }
    } else {
      linhas.push('Perfil de regra: CLT padrão (nenhum perfil específico escolhido).');
    }
    return linhas.join('\n');
  }
}
