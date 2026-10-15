import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import {
  empregado, pontoHorarioContratual, pontoDocumento, pontoAjuste, pontoPerfilRegra,
  espelhoAssinatura, pessoalFechamento, usuario, empregadoFoto, comTenant, type Db,
} from '@ponto/db';
import { DB } from '../database/database.module';
import { TratamentoService } from '../tratamento/tratamento.service';
import { mesPadrao } from './mes-padrao';
import { PessoalService } from './pessoal.service';

/**
 * Central "Precisa de atenção": junta, numa lista só, tudo que está pendente
 * nas telas do RH — com o motivo em português e para onde ir resolver.
 *
 * Grupos:
 *  - BLOQUEIA: sem isso o mês sai errado (batida em aberto, semana que não fecha,
 *    atestado e ajuste esperando decisão).
 *  - ANTES: precisa estar pronto antes de fechar o mês (NF, assinatura, mês anterior).
 *  - CADASTRO: não trava, mas muda valores (sem salário, sem escala, sem VR/VT,
 *    regra com nome que contradiz a escala).
 */
export type GrupoAtencao = 'BLOQUEIA' | 'ANTES' | 'CADASTRO';
export interface ItemAtencao {
  id: string;
  grupo: GrupoAtencao;
  tipo: 'BATIDAS' | 'SEMANA' | 'ATESTADO' | 'AJUSTE' | 'MES_ANTERIOR' | 'NF' | 'ASSINATURA'
    | 'PADRAO_BENEFICIO' | 'SEM_SALARIO' | 'SEM_ESCALA' | 'SEM_BENEFICIO' | 'REGRA_NOME' | 'FOTO_REVISAR';
  /** Quantas ocorrências o item resume (dias, pessoas, notas…). */
  qtd: number;
  titulo: string;
  /** Por que importa, em uma frase. */
  texto: string;
  pessoas: { nome: string; detalhe?: string; empregadoId?: string | null }[];
  acao: { rotulo: string; rota?: string; abrir?: 'BATIDAS' | 'FOTOS' };
  acao2?: { rotulo: string; rota: string };
}
export interface RespAtencao {
  hoje: string; competencia: string; anterior: string;
  itens: ItemAtencao[];
  totais: { total: number; bloqueia: number; antes: number; cadastro: number };
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const nomeMes = (comp: string) => MESES[Number(comp.slice(5, 7)) - 1] ?? comp;
const DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const dow = (iso: string) => DOW[new Date(`${iso}T12:00:00-0300`).getUTCDay()]!;
const primeiroNome = (n: string) => n.trim().split(/\s+/)[0] ?? n;
const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

function compAnterior(comp: string): string {
  const [a, m] = comp.split('-').map(Number) as [number, number];
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
}
function segunda(iso: string): string {
  const d = new Date(`${iso}T12:00:00-0300`);
  const w = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (w === 0 ? -6 : 1 - w));
  return d.toISOString().slice(0, 10);
}
function maisDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00-0300`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function ultimoDia(comp: string): string {
  const [a, m] = comp.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

@Injectable()
export class AtencaoService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly trat: TratamentoService,
    private readonly pessoal: PessoalService,
  ) {}

  async listar(tenantId: string): Promise<RespAtencao> {
    const painel = await this.trat.painel(tenantId);
    const hoje = painel.data;
    const anterior = compAnterior(hoje.slice(0, 7));
    const itens: ItemAtencao[] = [];

    const base = await comTenant(this.db, tenantId, async (tx) => {
      const emps = await tx.select({
        id: empregado.id, nome: empregado.nome, horarioId: empregado.horarioContratualId,
        perfilId: empregado.perfilRegraId, inicio: empregado.dataInicioPonto,
      }).from(empregado).where(and(eq(empregado.tenantId, tenantId), eq(empregado.ativo, true)));
      const horIds = [...new Set(emps.map((e) => e.horarioId).filter((x): x is string => !!x))];
      const horarios = horIds.length ? await tx.select({
        id: pontoHorarioContratual.id, codigo: pontoHorarioContratual.codigo, flexivel: pontoHorarioContratual.flexivel,
        compensa: pontoHorarioContratual.compensaSemana, regime: pontoHorarioContratual.regime,
      }).from(pontoHorarioContratual).where(inArray(pontoHorarioContratual.id, horIds)) : [];
      const docs = await tx.select({
        id: pontoDocumento.id, empregadoId: pontoDocumento.empregadoId, ini: pontoDocumento.dataInicio, fim: pontoDocumento.dataFim,
      }).from(pontoDocumento).where(and(eq(pontoDocumento.tenantId, tenantId), eq(pontoDocumento.status, 'EM_ANALISE')));
      const ajustes = await tx.select({
        id: pontoAjuste.id, empregadoId: pontoAjuste.empregadoId, data: pontoAjuste.data, obs: pontoAjuste.observacao,
      }).from(pontoAjuste).where(and(eq(pontoAjuste.tenantId, tenantId), eq(pontoAjuste.status, 'EM_ANALISE')));
      const perfis = await tx.select({ id: pontoPerfilRegra.id, nome: pontoPerfilRegra.nome, config: pontoPerfilRegra.config })
        .from(pontoPerfilRegra).where(eq(pontoPerfilRegra.tenantId, tenantId));
      const usaAssinatura = (await tx.select({ id: espelhoAssinatura.id }).from(espelhoAssinatura)
        .where(eq(espelhoAssinatura.tenantId, tenantId)).limit(1)).length > 0;
      const assinadasAnt = usaAssinatura ? await tx.select({ empregadoId: espelhoAssinatura.empregadoId }).from(espelhoAssinatura)
        .where(and(eq(espelhoAssinatura.tenantId, tenantId), eq(espelhoAssinatura.competencia, anterior))) : [];
      const comApp = emps.length ? await tx.select({ empregadoId: usuario.empregadoId }).from(usuario)
        .where(and(eq(usuario.tenantId, tenantId), eq(usuario.ativo, true), inArray(usuario.empregadoId, emps.map((e) => e.id)))) : [];
      const fechs = await tx.select({ c: pessoalFechamento.competencia }).from(pessoalFechamento)
        .where(eq(pessoalFechamento.tenantId, tenantId));
      const fotosRevisar = await tx.select({ empregadoId: empregadoFoto.empregadoId }).from(empregadoFoto)
        .where(and(eq(empregadoFoto.tenantId, tenantId), eq(empregadoFoto.status, 'REVISAR')));
      return { emps, horarios, docs, ajustes, perfis, usaAssinatura, assinadasAnt, comApp, fechs, fotosRevisar };
    });

    // Mês do cartão "fechar X": o anterior nos primeiros dias, se ainda não fechou.
    const comp = mesPadrao(hoje, base.fechs.some((f) => f.c === anterior)).competencia;

    const empPorId = new Map(base.emps.map((e) => [e.id, e]));
    const horPorId = new Map(base.horarios.map((h) => [h.id, h]));
    const nome = (id: string) => empPorId.get(id)?.nome ?? 'Funcionário';

    // ---------- BLOQUEIA ----------
    type Revisar = { nome: string; data: string; empregadoId?: string | null };
    const revisar = ((painel.pendencias as { _revisarCompleto?: Revisar[] })._revisarCompleto ?? painel.pendencias.revisar) as Revisar[];
    if (revisar.length > 0) {
      const ordem = [...revisar].sort((a, b) => a.data.localeCompare(b.data));
      itens.push({
        id: 'batidas', grupo: 'BLOQUEIA', tipo: 'BATIDAS', qtd: ordem.length,
        titulo: `${ordem.length} ${plural(ordem.length, 'dia com batida faltando', 'dias com batida faltando')}`,
        texto: 'Enquanto faltar batida, o dia fica pendente: sem extra, sem falta, e a semana de quem compensa não fecha.',
        pessoas: ordem.map((r) => ({ nome: primeiroNome(r.nome), detalhe: `${dow(r.data)} ${dataCurta(r.data)}`, empregadoId: r.empregadoId ?? null })),
        acao: { rotulo: 'Completar batidas', abrir: 'BATIDAS' },
        acao2: { rotulo: 'Ver todas', rota: '/rh/batidas-faltando' },
      });

      // Semana que não fecha: batida em aberto de quem tem escala que compensa na semana.
      const semanas = new Map<string, { nome: string; ini: string; empregadoId: string | null }>();
      for (const r of revisar) {
        const e = r.empregadoId ? empPorId.get(r.empregadoId) : undefined;
        const h = e?.horarioId ? horPorId.get(e.horarioId) : undefined;
        if (!h?.compensa || h.regime === 'r12x36') continue;
        const ini = segunda(r.data);
        semanas.set(`${r.empregadoId}|${ini}`, { nome: r.nome, ini, empregadoId: r.empregadoId ?? null });
      }
      if (semanas.size > 0) {
        const l = [...semanas.values()].sort((a, b) => a.ini.localeCompare(b.ini));
        itens.push({
          id: 'semanas', grupo: 'BLOQUEIA', tipo: 'SEMANA', qtd: l.length,
          titulo: `${l.length} ${plural(l.length, 'semana sem fechar', 'semanas sem fechar')}`,
          texto: 'Escala que compensa na semana: a semana só fecha (extra, atraso ou falta) quando a batida em aberto for completada.',
          pessoas: l.map((s) => ({ nome: primeiroNome(s.nome), detalhe: `semana ${dataCurta(s.ini)}–${dataCurta(maisDias(s.ini, 6))}`, empregadoId: s.empregadoId })),
          acao: { rotulo: 'Completar batidas', abrir: 'BATIDAS' },
        });
      }
    }
    if (base.docs.length > 0) {
      itens.push({
        id: 'atestados', grupo: 'BLOQUEIA', tipo: 'ATESTADO', qtd: base.docs.length,
        titulo: `${base.docs.length} ${plural(base.docs.length, 'atestado aguardando decisão', 'atestados aguardando decisão')}`,
        texto: 'Até decidir, os dias contam como falta no cálculo.',
        pessoas: base.docs.map((d) => ({
          nome: primeiroNome(nome(d.empregadoId)), empregadoId: d.empregadoId,
          detalhe: d.ini === d.fim ? dataCurta(d.ini) : `${dataCurta(d.ini)} a ${dataCurta(d.fim)}`,
        })),
        acao: { rotulo: 'Decidir', rota: '/rh/atestados' },
      });
    }
    if (base.ajustes.length > 0) {
      const um = base.ajustes.length === 1 ? base.ajustes[0]! : null;
      itens.push({
        id: 'ajustes', grupo: 'BLOQUEIA', tipo: 'AJUSTE', qtd: base.ajustes.length,
        titulo: `${base.ajustes.length} ${plural(base.ajustes.length, 'ajuste de ponto pedido', 'ajustes de ponto pedidos')}`,
        texto: um ? `“${um.obs.slice(0, 140)}”` : 'O funcionário pediu correção da batida. Aprovar ou recusar muda o cálculo do dia.',
        pessoas: base.ajustes.map((a) => ({ nome: primeiroNome(nome(a.empregadoId)), detalhe: `${dow(a.data)} ${dataCurta(a.data)}`, empregadoId: a.empregadoId })),
        acao: { rotulo: 'Decidir', rota: '/rh/ajustes' },
      });
    }

    // ---------- ANTES ----------
    const fechadas = new Set(base.fechs.map((f) => f.c));
    if (fechadas.size > 0 && !fechadas.has(anterior)) {
      itens.push({
        id: 'mes-anterior', grupo: 'ANTES', tipo: 'MES_ANTERIOR', qtd: 1,
        titulo: `${nomeMes(anterior)[0]!.toUpperCase()}${nomeMes(anterior).slice(1)} ainda não foi fechado`,
        texto: 'Enquanto o mês não fecha, valores e benefícios podem mudar se alguém mexer no ponto.',
        pessoas: [],
        acao: { rotulo: `Fechar ${nomeMes(anterior)}`, rota: `/rh/pessoal?mes=${anterior}` },
      });
    }
    if (base.usaAssinatura) {
      const fimAnt = ultimoDia(anterior);
      const assinou = new Set(base.assinadasAnt.map((a) => a.empregadoId));
      const temApp = new Set(base.comApp.map((u) => u.empregadoId));
      const faltam = base.emps.filter((e) => temApp.has(e.id) && !assinou.has(e.id) && (!e.inicio || e.inicio <= fimAnt));
      if (faltam.length > 0) {
        const total = base.emps.filter((e) => temApp.has(e.id) && (!e.inicio || e.inicio <= fimAnt)).length;
        itens.push({
          id: 'assinatura', grupo: 'ANTES', tipo: 'ASSINATURA', qtd: faltam.length,
          titulo: `Espelho de ${nomeMes(anterior)} sem assinatura`,
          texto: `${faltam.length} de ${total} ${plural(total, 'funcionário ainda não assinou', 'funcionários ainda não assinaram')} no app.`,
          pessoas: faltam.map((e) => ({ nome: primeiroNome(e.nome), empregadoId: e.id })),
          acao: { rotulo: 'Ver espelhos', rota: `/rh/espelhos?mes=${anterior}` },
        });
      }
    }

    let pess: Awaited<ReturnType<PessoalService['competencia']>> | null = null;
    try { pess = await this.pessoal.competencia(tenantId, comp); } catch { pess = null; }
    if (pess && !pess.fechado) {
      // Só cobra nota de período já encerrado: a NF do MEI sai depois do fim do
      // mês e a do motorista depois do fim da semana — antes disso não existe.
      const mesEncerrado = hoje > ultimoDia(comp);
      const semanaEncerrada = (inicio: string) => {
        const d = new Date(`${inicio}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 6);
        return d.toISOString().slice(0, 10) < hoje;
      };
      const semNf = [
        ...(mesEncerrado ? pess.mei.filter((m) => !m.lanc.nfNumero && !m.lanc.nfArquivo).map((m) => ({ nome: primeiroNome(m.nome), detalhe: 'mensal' })) : []),
        ...pess.motoristas.flatMap((m) => m.semanas.filter((s) => s.dias > 0 && semanaEncerrada(s.inicio) && !s.nfNumero && !s.nfArquivo)
          .map((s) => ({ nome: primeiroNome(m.nome), detalhe: `semana ${dataCurta(s.inicio)}` }))),
      ];
      if (semNf.length > 0) {
        itens.push({
          id: 'nf', grupo: 'ANTES', tipo: 'NF', qtd: semNf.length,
          titulo: `${semNf.length} ${plural(semNf.length, 'nota fiscal faltando', 'notas fiscais faltando')}`,
          texto: 'Prestador sem nota fiscal fica sem comprovante do pagamento do mês.',
          pessoas: semNf,
          acao: { rotulo: 'Anexar NF', rota: `/rh/pessoal?mes=${comp}&aba=prestadores` },
        });
      }
      if (!pess.padrao && pess.clt.length > 0) {
        itens.push({
          id: 'padrao', grupo: 'ANTES', tipo: 'PADRAO_BENEFICIO', qtd: 1,
          titulo: 'Padrão de VR/VT da empresa não definido',
          texto: 'Sem o padrão, quem não tem valor próprio fica sem benefício na carga do mês.',
          pessoas: [],
          acao: { rotulo: 'Definir padrão', rota: `/rh/pessoal?mes=${comp}&aba=beneficios` },
        });
      }
    }

    // ---------- CADASTRO ----------
    if (pess) {
      const semSal = pess.clt.filter((c) => c.salarioCent == null);
      if (semSal.length > 0) {
        itens.push({
          id: 'sem-salario', grupo: 'CADASTRO', tipo: 'SEM_SALARIO', qtd: semSal.length,
          titulo: semSal.length === 1 ? `${primeiroNome(semSal[0]!.nome)} está sem salário` : `${semSal.length} funcionários sem salário`,
          texto: 'Sem salário, a folha mostra as horas mas não calcula o valor de extras e faltas.',
          pessoas: semSal.map((c) => ({ nome: primeiroNome(c.nome), empregadoId: c.empregadoId })),
          acao: { rotulo: 'Definir salário', rota: '/rh/funcionarios' },
        });
      }
      if (pess.padrao) {
        const semBen = pess.clt.filter((c) => c.config.origem === 'NENHUM');
        if (semBen.length > 0) {
          itens.push({
            id: 'sem-beneficio', grupo: 'CADASTRO', tipo: 'SEM_BENEFICIO', qtd: semBen.length,
            titulo: semBen.length === 1 ? `${primeiroNome(semBen[0]!.nome)} está sem VR/VT` : `${semBen.length} funcionários sem VR/VT`,
            texto: 'Marcado como “sem benefício”. Confira se é isso mesmo ou se deve seguir o padrão da empresa.',
            pessoas: semBen.map((c) => ({ nome: primeiroNome(c.nome), empregadoId: c.empregadoId })),
            acao: { rotulo: 'Revisar benefícios', rota: `/rh/pessoal?mes=${comp}&aba=beneficios` },
          });
        }
      }
    }
    const semEscala = base.emps.filter((e) => !e.horarioId);
    if (semEscala.length > 0) {
      itens.push({
        id: 'sem-escala', grupo: 'CADASTRO', tipo: 'SEM_ESCALA', qtd: semEscala.length,
        titulo: semEscala.length === 1 ? `${primeiroNome(semEscala[0]!.nome)} está sem escala` : `${semEscala.length} funcionários sem escala`,
        texto: 'Sem escala o sistema não sabe a carga do dia: não calcula extra, atraso nem falta.',
        pessoas: semEscala.map((e) => ({ nome: primeiroNome(e.nome), empregadoId: e.id })),
        acao: { rotulo: 'Definir escala', rota: '/rh/funcionarios' },
      });
    }
    // Regra cujo nome fala em "contrato de horas" usada por quem tem escala de horário fixo.
    const enganosas = base.perfis.filter((p) => /contrato\s+de\s+horas/i.test(p.nome)
      && (p.config as { contrato?: { tipoJornada?: string } } | null)?.contrato?.tipoJornada !== 'CONTRATO_HORAS');
    for (const p of enganosas) {
      const quem = base.emps.filter((e) => e.perfilId === p.id && e.horarioId && !horPorId.get(e.horarioId)?.flexivel);
      if (quem.length === 0) continue;
      itens.push({
        id: `regra-${p.id}`, grupo: 'CADASTRO', tipo: 'REGRA_NOME', qtd: quem.length,
        titulo: 'Nome de regra que engana',
        texto: `A regra de cálculo se chama “${p.nome}”, mas quem define o contrato de horas é a escala, e a escala de ${quem.length === 1 ? primeiroNome(quem[0]!.nome) : 'quem usa a regra'} é horário fixo. Renomeie a regra pelo que ela faz ou troque a escala.`,
        pessoas: quem.map((e) => ({ nome: primeiroNome(e.nome), detalhe: horPorId.get(e.horarioId!)?.codigo ?? undefined, empregadoId: e.id })),
        acao: { rotulo: 'Renomear regra', rota: '/rh/regras' },
        acao2: { rotulo: 'Trocar escala', rota: '/rh/funcionarios' },
      });
    }

    const fotos = base.fotosRevisar.filter((f) => empPorId.has(f.empregadoId));
    if (fotos.length > 0) {
      itens.push({
        id: 'fotos', grupo: 'CADASTRO', tipo: 'FOTO_REVISAR', qtd: fotos.length,
        titulo: `${fotos.length} ${plural(fotos.length, 'foto nova para revisar', 'fotos novas para revisar')}`,
        texto: 'A foto já aparece no sistema. Se não estiver boa, recuse com o motivo e o app pede outra.',
        pessoas: fotos.map((f) => ({ nome: primeiroNome(nome(f.empregadoId)), empregadoId: f.empregadoId })),
        acao: { rotulo: 'Revisar fotos', abrir: 'FOTOS' },
      });
    }

    const totais = {
      total: itens.length,
      bloqueia: itens.filter((i) => i.grupo === 'BLOQUEIA').length,
      antes: itens.filter((i) => i.grupo === 'ANTES').length,
      cadastro: itens.filter((i) => i.grupo === 'CADASTRO').length,
    };
    return { hoje, competencia: comp, anterior, itens, totais };
  }
}
