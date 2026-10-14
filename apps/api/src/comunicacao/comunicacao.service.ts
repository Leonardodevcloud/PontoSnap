import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import {
  comunicado, comunicadoDestinatario, comunicadoMidia, empregado, usuario, pushSubscription, pontoHorarioContratual, tenant, pontoRep,
  comTenant, comoMaster, type Db, type BlocoComunicado, type PublicoComunicado,
} from '@ponto/db';
import { reconhecerVideo } from '@ponto/shared';
import { gerarCienciaComunicadoPdf } from '@ponto/rep-core';
import { DB } from '../database/database.module';
import { PushService } from '../notificacao/push.service';

/**
 * Comunicação interna: o RH monta um comunicado em blocos (texto, fotos,
 * áudio, vídeo por link, PDF), escolhe o público e publica. Cada destinatário
 * fica registrado (foto do público na publicação) com quando abriu, quando
 * assistiu/ouviu e quando deu ciência — o PDF de ciência sai daí.
 *
 * Destinatário = funcionário ativo com acesso ao app (sem acesso, não teria
 * como ler; o RH vê quantos ficam de fora antes de publicar).
 */

export const REACOES = ['👍', '❤️', '👏', '😂', '🙏'] as const;
const MAX_BLOCOS = 20;
const MAX_FOTOS_BLOCO = 12;
const MAX_TEXTO = 5000;
export const LIMITES = {
  FOTO: 2 * 1024 * 1024,
  MINI: 120 * 1024,
  AUDIO: 10 * 1024 * 1024,
  ARQUIVO: 10 * 1024 * 1024,
};

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type StatusComunicado = 'RASCUNHO' | 'AGENDADO' | 'PUBLICADO' | 'ARQUIVADO';

export interface DadosComunicado {
  titulo: string;
  blocos: BlocoComunicado[];
  publico: PublicoComunicado;
  pedirCiencia: boolean;
  fixado: boolean;
  notificar: boolean;
  lembrar: boolean;
  reacoes: boolean;
  autorNome?: string;
}

export interface ArquivoEnviado { buffer: Buffer; mimetype: string; originalname: string; size: number }

/** "-0300" → minutos. */
function offset(fuso: string) {
  const s = fuso.startsWith('-') ? -1 : 1;
  return s * (Number(fuso.slice(1, 3)) * 60 + Number(fuso.slice(3, 5) || 0));
}
export function dataHoraLocal(d: Date | null, fuso: string): string | null {
  if (!d) return null;
  const x = new Date(d.getTime() + offset(fuso) * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(x.getUTCDate())}/${p(x.getUTCMonth() + 1)}/${x.getUTCFullYear()} ${p(x.getUTCHours())}:${p(x.getUTCMinutes())}`;
}

/** Resumo das mídias para a notificação e a lista ("vídeo, fotos e áudio"). */
export function resumoMidias(blocos: BlocoComunicado[]): string {
  const tem = new Set(blocos.map((b) => b.tipo));
  const nomes: string[] = [];
  if (tem.has('VIDEO')) nomes.push('vídeo');
  if (tem.has('FOTOS')) nomes.push(blocos.some((b) => b.tipo === 'FOTOS' && b.midias.length > 1) ? 'fotos' : 'foto');
  if (tem.has('AUDIO')) nomes.push('áudio');
  if (tem.has('ARQUIVO')) nomes.push('PDF');
  if (nomes.length === 0) return '';
  return nomes.length === 1 ? nomes[0]! : `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)}`;
}

/** Miniatura da lista do RH: a 1ª foto publicada ou o vídeo (YouTube tem capa pública). */
export function capaDe(blocos: BlocoComunicado[]): { tipo: 'FOTO'; midiaId: string } | { tipo: 'VIDEO'; provedor: string; videoId: string } | null {
  for (const b of blocos) {
    if (b.tipo === 'FOTOS' && b.midias[0]) return { tipo: 'FOTO', midiaId: b.midias[0] };
    if (b.tipo === 'VIDEO') return { tipo: 'VIDEO', provedor: b.provedor, videoId: b.videoId };
  }
  return null;
}

@Injectable()
export class ComunicacaoService {
  private readonly log = new Logger(ComunicacaoService.name);
  constructor(@Inject(DB) private readonly db: Db, private readonly push: PushService) {}

  // ───────────────────────── apoio ─────────────────────────

  async empregadoDoUsuario(tenantId: string, usuarioId: string): Promise<string> {
    return comTenant(this.db, tenantId, async (tx) => {
      const u = (await tx.select({ e: usuario.empregadoId }).from(usuario).where(eq(usuario.id, usuarioId)).limit(1))[0];
      if (!u?.e) throw new ForbiddenException('Este acesso não está vinculado a um funcionário.');
      return u.e;
    });
  }

  private async fusoDo(tenantId: string): Promise<string> {
    const t = await comoMaster(this.db, (tx) => tx.select({ fuso: tenant.fuso }).from(tenant).where(eq(tenant.id, tenantId)).limit(1));
    return t[0]?.fuso ?? '-0300';
  }

  /** Funcionários ativos com acesso ao app (podem receber comunicados). */
  private async pessoasDoTenant(tx: Tx, tenantId: string) {
    const emps = await tx.select({ id: empregado.id, nome: empregado.nome, cpf: empregado.cpf, cliente: empregado.cliente, horarioId: empregado.horarioContratualId })
      .from(empregado).where(and(eq(empregado.tenantId, tenantId), eq(empregado.ativo, true))).orderBy(empregado.nome);
    const us = await tx.select({ id: usuario.id, empregadoId: usuario.empregadoId }).from(usuario)
      .where(and(eq(usuario.tenantId, tenantId), eq(usuario.ativo, true), eq(usuario.perfil, 'COLABORADOR')));
    const subs = await tx.selectDistinct({ u: pushSubscription.usuarioId }).from(pushSubscription).where(eq(pushSubscription.tenantId, tenantId));
    const comPush = new Set(subs.map((s) => s.u));
    const usuariosDe = new Map<string, string[]>();
    for (const u of us) if (u.empregadoId) usuariosDe.set(u.empregadoId, [...(usuariosDe.get(u.empregadoId) ?? []), u.id]);
    return emps.map((e) => {
      const uids = usuariosDe.get(e.id) ?? [];
      return { ...e, usuarios: uids, temApp: uids.length > 0, temPush: uids.some((u) => comPush.has(u)) };
    });
  }

  private filtrarPublico<T extends { id: string; cliente: string | null; horarioId: string | null; temApp: boolean }>(pessoas: T[], p: PublicoComunicado): T[] {
    const v = new Set(p.valores);
    return pessoas.filter((x) => x.temApp && (
      p.tipo === 'TODOS' ? true
        : p.tipo === 'CLIENTE' ? v.has(x.cliente ?? '')
          : p.tipo === 'ESCALA' ? v.has(x.horarioId ?? '')
            : v.has(x.id)));
  }

  private validarPublico(p: PublicoComunicado | undefined): PublicoComunicado {
    const tipo = p?.tipo ?? 'TODOS';
    if (!['TODOS', 'CLIENTE', 'ESCALA', 'PESSOAS'].includes(tipo)) throw new BadRequestException('Público inválido.');
    const valores = tipo === 'TODOS' ? [] : [...new Set((p?.valores ?? []).map(String).filter(Boolean))].slice(0, 2000);
    return { tipo, valores };
  }

  /** Confere e limpa os blocos. Fotos/áudios/PDFs precisam existir no tenant. */
  private async validarBlocos(tx: Tx, tenantId: string, blocos: BlocoComunicado[] | undefined, id: string | null): Promise<BlocoComunicado[]> {
    const lista = Array.isArray(blocos) ? blocos : [];
    if (lista.length > MAX_BLOCOS) throw new BadRequestException(`Use no máximo ${MAX_BLOCOS} blocos.`);
    const ids = new Set<string>();
    const out: BlocoComunicado[] = [];
    for (const b of lista) {
      switch (b?.tipo) {
        case 'TEXTO': {
          const texto = String(b.texto ?? '').trim();
          if (texto.length > MAX_TEXTO) throw new BadRequestException(`Um bloco de texto passou de ${MAX_TEXTO} caracteres.`);
          if (texto) out.push({ tipo: 'TEXTO', texto });
          break;
        }
        case 'FOTOS': {
          const midias = (b.midias ?? []).map(String).slice(0, MAX_FOTOS_BLOCO);
          midias.forEach((m) => ids.add(m));
          if (midias.length) out.push({ tipo: 'FOTOS', midias });
          break;
        }
        case 'AUDIO': {
          ids.add(String(b.midiaId));
          const picos = (Array.isArray(b.picos) ? b.picos : []).slice(0, 64).map((n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0))));
          out.push({ tipo: 'AUDIO', midiaId: String(b.midiaId), duracaoSeg: Math.max(0, Math.min(3600, Math.round(Number(b.duracaoSeg) || 0))), picos });
          break;
        }
        case 'VIDEO': {
          const v = reconhecerVideo(String(b.url ?? ''));
          if (!v) throw new BadRequestException('Link de vídeo não reconhecido. Use um link do YouTube, Vimeo ou Google Drive.');
          out.push({ tipo: 'VIDEO', url: String(b.url).trim().slice(0, 500), provedor: v.provedor, videoId: v.videoId, titulo: b.titulo ? String(b.titulo).slice(0, 160) : null });
          break;
        }
        case 'ARQUIVO': {
          ids.add(String(b.midiaId));
          out.push({ tipo: 'ARQUIVO', midiaId: String(b.midiaId), nome: String(b.nome ?? 'arquivo.pdf').slice(0, 160), bytes: Number(b.bytes) || 0 });
          break;
        }
        default: throw new BadRequestException('Tipo de bloco inválido.');
      }
    }
    if (ids.size) {
      const lista = [...ids];
      if (lista.some((x) => !/^[0-9a-f-]{36}$/i.test(x))) throw new BadRequestException('Mídia inválida.');
      const achadas = await tx.select({ id: comunicadoMidia.id, c: comunicadoMidia.comunicadoId }).from(comunicadoMidia)
        .where(and(eq(comunicadoMidia.tenantId, tenantId), inArray(comunicadoMidia.id, lista)));
      const ok = achadas.filter((m) => m.c === null || m.c === id);
      if (ok.length !== lista.length) throw new BadRequestException('Alguma foto, áudio ou PDF não foi encontrado. Envie de novo.');
    }
    return out;
  }

  /** Liga as mídias usadas ao comunicado e apaga as que saíram. */
  private async vincularMidias(tx: Tx, tenantId: string, id: string, blocos: BlocoComunicado[]) {
    const usadas = blocos.flatMap((b) => (b.tipo === 'FOTOS' ? b.midias : b.tipo === 'AUDIO' || b.tipo === 'ARQUIVO' ? [b.midiaId] : []));
    if (usadas.length) {
      await tx.update(comunicadoMidia).set({ comunicadoId: id })
        .where(and(eq(comunicadoMidia.tenantId, tenantId), inArray(comunicadoMidia.id, usadas), isNull(comunicadoMidia.comunicadoId)));
    }
    const atuais = await tx.select({ id: comunicadoMidia.id }).from(comunicadoMidia).where(eq(comunicadoMidia.comunicadoId, id));
    const sobra = atuais.map((m) => m.id).filter((m) => !usadas.includes(m));
    if (sobra.length) await tx.delete(comunicadoMidia).where(inArray(comunicadoMidia.id, sobra));
  }

  // ───────────────────────── RH ─────────────────────────

  /** Pessoas, clientes e escalas para escolher o público (e quantos recebem push). */
  async opcoesPublico(tenantId: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const pessoas = await this.pessoasDoTenant(tx, tenantId);
      const hors = await tx.select({ id: pontoHorarioContratual.id, codigo: pontoHorarioContratual.codigo }).from(pontoHorarioContratual)
        .where(eq(pontoHorarioContratual.tenantId, tenantId));
      const contar = (f: (p: typeof pessoas[number]) => boolean) => pessoas.filter((p) => p.temApp && f(p)).length;
      const clientes = [...new Set(pessoas.map((p) => p.cliente).filter((c): c is string => !!c))].sort()
        .map((c) => ({ valor: c, rotulo: c, pessoas: contar((p) => p.cliente === c) }));
      const escalas = hors.map((h) => ({ valor: h.id, rotulo: h.codigo, pessoas: contar((p) => p.horarioId === h.id) })).filter((h) => h.pessoas > 0);
      return {
        pessoas: pessoas.map((p) => ({ id: p.id, nome: p.nome, cliente: p.cliente, horarioId: p.horarioId, temApp: p.temApp, temPush: p.temPush })),
        clientes, escalas,
      };
    });
  }

  async listar(tenantId: string) {
    const fuso = await this.fusoDo(tenantId);
    return comTenant(this.db, tenantId, async (tx) => {
      const cs = await tx.select().from(comunicado).where(eq(comunicado.tenantId, tenantId))
        .orderBy(desc(comunicado.fixado), desc(sql`coalesce(${comunicado.publicadoEm}, ${comunicado.agendadoPara}, ${comunicado.atualizadoEm})`));
      const ids = cs.map((c) => c.id);
      const ds = ids.length ? await tx.select().from(comunicadoDestinatario).where(inArray(comunicadoDestinatario.comunicadoId, ids)) : [];
      const porCom = new Map<string, typeof ds>();
      for (const d of ds) porCom.set(d.comunicadoId, [...(porCom.get(d.comunicadoId) ?? []), d]);

      const agora = Date.now();
      const inicioMes = (() => { const x = new Date(agora + offset(fuso) * 60_000); return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), 1) - offset(fuso) * 60_000; })();
      const pendentes = new Set<string>();
      let somaLeitura = 0, somaLeitura24 = 0, nLeitura = 0;
      const itens = cs.map((c) => {
        const d = porCom.get(c.id) ?? [];
        const abertos = d.filter((x) => x.abertoEm).length;
        const cientes = d.filter((x) => x.cienteEm).length;
        const pend = c.status === 'PUBLICADO' && c.pedirCiencia ? d.filter((x) => !x.cienteEm) : [];
        pend.forEach((x) => pendentes.add(x.empregadoId));
        if (c.status !== 'RASCUNHO' && c.status !== 'AGENDADO' && d.length && c.publicadoEm) {
          nLeitura++;
          somaLeitura += abertos / d.length;
          somaLeitura24 += d.filter((x) => x.abertoEm && x.abertoEm.getTime() - c.publicadoEm!.getTime() <= 86_400_000).length / d.length;
        }
        return {
          id: c.id, titulo: c.titulo, status: c.status as StatusComunicado, fixado: c.fixado, pedirCiencia: c.pedirCiencia,
          publicadoEm: c.publicadoEm?.toISOString() ?? null, agendadoPara: c.agendadoPara?.toISOString() ?? null,
          atualizadoEm: c.atualizadoEm.toISOString(), autorNome: c.autorNome, publico: c.publico,
          tipos: [...new Set(c.blocos.map((b) => b.tipo))], midias: resumoMidias(c.blocos), capa: capaDe(c.blocos),
          destinatarios: d.length, abertos, cientes, pendentesCiencia: pend.length,
        };
      });
      const publicados = itens.filter((i) => i.status === 'PUBLICADO' || i.status === 'ARQUIVADO');
      const proximo = itens.filter((i) => i.status === 'AGENDADO' && i.agendadoPara).sort((a, b) => a.agendadoPara!.localeCompare(b.agendadoPara!))[0];
      return {
        itens,
        resumo: {
          enviadosMes: publicados.filter((i) => i.publicadoEm && Date.parse(i.publicadoEm) >= inicioMes).length,
          comCienciaMes: publicados.filter((i) => i.pedirCiencia && i.publicadoEm && Date.parse(i.publicadoEm) >= inicioMes).length,
          leituraMedia: nLeitura ? Math.round((somaLeitura / nLeitura) * 100) : null,
          leitura24h: nLeitura ? Math.round((somaLeitura24 / nLeitura) * 100) : null,
          pessoasPendentes: pendentes.size,
          comunicadosPendentes: itens.filter((i) => i.pendentesCiencia > 0).length,
          agendados: itens.filter((i) => i.status === 'AGENDADO').length,
          proximoAgendado: proximo?.agendadoPara ?? null,
        },
      };
    });
  }

  async obter(tenantId: string, id: string) {
    const fuso = await this.fusoDo(tenantId);
    return comTenant(this.db, tenantId, async (tx) => {
      const c = (await tx.select().from(comunicado).where(and(eq(comunicado.tenantId, tenantId), eq(comunicado.id, id))).limit(1))[0];
      if (!c) throw new NotFoundException('Comunicado não encontrado.');
      const midias = await tx.select({ id: comunicadoMidia.id, tipo: comunicadoMidia.tipo, nome: comunicadoMidia.nome, bytes: comunicadoMidia.bytes })
        .from(comunicadoMidia).where(eq(comunicadoMidia.comunicadoId, id));
      const ds = await tx.select().from(comunicadoDestinatario).where(eq(comunicadoDestinatario.comunicadoId, id));
      const pessoas = new Map((await this.pessoasDoTenant(tx, tenantId)).map((p) => [p.id, p]));
      const faltantes = ds.filter((d) => !pessoas.has(d.empregadoId)).map((d) => d.empregadoId);
      const extras = faltantes.length ? await tx.select({ id: empregado.id, nome: empregado.nome, cliente: empregado.cliente }).from(empregado).where(inArray(empregado.id, faltantes)) : [];
      const nomeDe = (eid: string) => pessoas.get(eid) ?? extras.find((x) => x.id === eid);
      const destinatarios = ds.map((d) => {
        const p = nomeDe(d.empregadoId);
        return {
          empregadoId: d.empregadoId, nome: p?.nome ?? '—', cliente: p?.cliente ?? null, temPush: !!(p && 'temPush' in p && p.temPush),
          abertoEm: d.abertoEm?.toISOString() ?? null, midiaEm: d.midiaEm?.toISOString() ?? null,
          cienteEm: d.cienteEm?.toISOString() ?? null, reacao: d.reacao,
        };
      }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      const grupos = new Map<string, { total: number; ok: number }>();
      for (const d of destinatarios) {
        const k = d.cliente ?? 'Sem cliente';
        const g = grupos.get(k) ?? { total: 0, ok: 0 };
        g.total++; if (c.pedirCiencia ? d.cienteEm : d.abertoEm) g.ok++;
        grupos.set(k, g);
      }
      const reacoes: Record<string, number> = {};
      for (const d of ds) if (d.reacao) reacoes[d.reacao] = (reacoes[d.reacao] ?? 0) + 1;
      return {
        id: c.id, titulo: c.titulo, blocos: c.blocos, publico: c.publico, status: c.status as StatusComunicado,
        pedirCiencia: c.pedirCiencia, fixado: c.fixado, notificar: c.notificar, lembrar: c.lembrar, reacoes: c.reacoes,
        agendadoPara: c.agendadoPara?.toISOString() ?? null, publicadoEm: c.publicadoEm?.toISOString() ?? null,
        publicadoEmLocal: dataHoraLocal(c.publicadoEm, fuso), lembreteEm: c.lembreteEm?.toISOString() ?? null,
        notificados: c.notificados, autorNome: c.autorNome, midias, destinatarios,
        porCliente: [...grupos].map(([nome, g]) => ({ nome, ...g })).sort((a, b) => b.total - a.total),
        contagemReacoes: reacoes,
      };
    });
  }

  async salvar(tenantId: string, id: string | null, d: DadosComunicado, autor: { id: string; nome: string }) {
    const titulo = String(d.titulo ?? '').trim();
    if (!titulo) throw new BadRequestException('Dê um título ao comunicado.');
    if (titulo.length > 160) throw new BadRequestException('Título muito longo (máximo 160 caracteres).');
    // Título do vídeo do YouTube (para a lista e a notificação), quando não veio.
    for (const b of d.blocos ?? []) {
      if (b?.tipo === 'VIDEO' && !b.titulo) b.titulo = (await this.infoVideo(String(b.url ?? '')).catch(() => null))?.titulo ?? null;
    }
    return comTenant(this.db, tenantId, async (tx) => {
      let atual: typeof comunicado.$inferSelect | undefined;
      if (id) {
        atual = (await tx.select().from(comunicado).where(and(eq(comunicado.tenantId, tenantId), eq(comunicado.id, id))).limit(1))[0];
        if (!atual) throw new NotFoundException('Comunicado não encontrado.');
        if (atual.status === 'ARQUIVADO') throw new BadRequestException('Comunicado arquivado não pode ser editado.');
      }
      const blocos = await this.validarBlocos(tx, tenantId, d.blocos, id);
      const publicado = atual?.status === 'PUBLICADO';
      const valores = {
        titulo, blocos,
        // Depois de publicado, o público e a ciência não mudam (o comprovante vale para quem recebeu).
        publico: publicado ? atual!.publico : this.validarPublico(d.publico),
        pedirCiencia: publicado ? atual!.pedirCiencia : !!d.pedirCiencia,
        fixado: !!d.fixado, notificar: !!d.notificar, lembrar: !!d.lembrar, reacoes: !!d.reacoes,
        autorNome: (d.autorNome ?? '').trim().slice(0, 160) || atual?.autorNome || autor.nome,
        atualizadoEm: new Date(),
      };
      let cid = id;
      if (id) await tx.update(comunicado).set(valores).where(eq(comunicado.id, id));
      else cid = (await tx.insert(comunicado).values({ ...valores, tenantId, autorId: autor.id }).returning({ id: comunicado.id }))[0]!.id;
      await this.vincularMidias(tx, tenantId, cid!, blocos);
      return { id: cid! };
    });
  }

  /** Publica agora, ou agenda (data no futuro). */
  async publicar(tenantId: string, id: string, agendadoPara: string | null | undefined) {
    const quando = agendadoPara ? new Date(agendadoPara) : null;
    if (quando && Number.isNaN(quando.getTime())) throw new BadRequestException('Data de agendamento inválida.');
    await this.conferirPublicavel(tenantId, id);
    if (quando && quando.getTime() > Date.now() + 60_000) {
      await comTenant(this.db, tenantId, (tx) => tx.update(comunicado).set({ status: 'AGENDADO', agendadoPara: quando, atualizadoEm: new Date() })
        .where(and(eq(comunicado.id, id), inArray(comunicado.status, ['RASCUNHO', 'AGENDADO']))));
      return { status: 'AGENDADO' as const, destinatarios: 0 };
    }
    const r = await this.efetivarPublicacao(tenantId, id);
    // A notificação sai em segundo plano: com muita gente, não trava a tela do RH.
    void r.envio.catch((e) => this.log.error(`Notificar comunicado ${id}: ${(e as Error).message}`));
    return { status: 'PUBLICADO' as const, destinatarios: r.destinatarios };
  }

  private async conferirPublicavel(tenantId: string, id: string) {
    const c = (await comTenant(this.db, tenantId, (tx) => tx.select().from(comunicado).where(and(eq(comunicado.tenantId, tenantId), eq(comunicado.id, id))).limit(1)))[0];
    if (!c) throw new NotFoundException('Comunicado não encontrado.');
    if (c.status === 'PUBLICADO' || c.status === 'ARQUIVADO') throw new BadRequestException('Este comunicado já foi publicado.');
    if (c.blocos.length === 0) throw new BadRequestException('Adicione pelo menos um texto, foto, áudio, vídeo ou PDF.');
    if (c.publico.tipo !== 'TODOS' && c.publico.valores.length === 0) throw new BadRequestException('Escolha para quem vai o comunicado.');
  }

  /**
   * Publica de fato: marca PUBLICADO (só uma vez, mesmo com duas instâncias),
   * grava os destinatários e devolve a promessa do envio das notificações.
   */
  async efetivarPublicacao(tenantId: string, id: string): Promise<{ destinatarios: number; envio: Promise<number> }> {
    const r = await comTenant(this.db, tenantId, async (tx) => {
      const c = (await tx.update(comunicado).set({ status: 'PUBLICADO', publicadoEm: new Date(), agendadoPara: null, atualizadoEm: new Date() })
        .where(and(eq(comunicado.tenantId, tenantId), eq(comunicado.id, id), inArray(comunicado.status, ['RASCUNHO', 'AGENDADO']))).returning())[0];
      if (!c) return null;
      const alvo = this.filtrarPublico(await this.pessoasDoTenant(tx, tenantId), c.publico);
      if (alvo.length) {
        await tx.insert(comunicadoDestinatario).values(alvo.map((p) => ({ comunicadoId: id, empregadoId: p.id, tenantId }))).onConflictDoNothing();
      }
      return { c, alvo };
    });
    if (!r) return { destinatarios: 0, envio: Promise.resolve(0) };
    const { c, alvo } = r;
    const envio = (async () => {
      if (!c.notificar || !this.push.ativo) return 0;
      const extra = resumoMidias(c.blocos);
      const texto = c.blocos.find((b) => b.tipo === 'TEXTO') as { texto: string } | undefined;
      const corpo = extra ? `${c.autorNome ?? 'RH'} · ${extra} · toque para ver` : `${c.autorNome ?? 'RH'}: ${(texto?.texto ?? '').slice(0, 110)}`;
      const n = await this.notificarPessoas(tenantId, alvo, { titulo: `📢 ${c.titulo}`, corpo, url: `/avisos/${id}`, tag: `comunicado-${id}` });
      await comTenant(this.db, tenantId, (tx) => tx.update(comunicado).set({ notificados: n }).where(eq(comunicado.id, id)));
      return n;
    })();
    return { destinatarios: alvo.length, envio };
  }

  /** Manda push para cada pessoa (todos os aparelhos). Devolve quantas pessoas receberam. */
  private async notificarPessoas(tenantId: string, pessoas: { id: string; usuarios: string[] }[], n: { titulo: string; corpo: string; url: string; tag: string }) {
    let alcancadas = 0;
    const fila = [...pessoas];
    const trabalhar = async () => {
      for (let p = fila.shift(); p; p = fila.shift()) {
        let chegou = false;
        for (const u of p.usuarios) {
          try {
            const r = await this.push.enviar(tenantId, u, p.id, 'comunicado', n);
            if (r.entregues > 0) chegou = true;
          } catch (e) { this.log.error(`Push comunicado: ${(e as Error).message}`); }
        }
        if (chegou) alcancadas++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, fila.length) }, trabalhar));
    return alcancadas;
  }

  /** Lembrete para quem ainda não leu (ou não deu ciência). */
  async lembrar(tenantId: string, id: string, empregadoIds?: string[], tagFixa?: string) {
    const r = await comTenant(this.db, tenantId, async (tx) => {
      const c = (await tx.select().from(comunicado).where(and(eq(comunicado.tenantId, tenantId), eq(comunicado.id, id))).limit(1))[0];
      if (!c) throw new NotFoundException('Comunicado não encontrado.');
      if (c.status !== 'PUBLICADO') throw new BadRequestException('Só dá para lembrar comunicados publicados.');
      const ds = await tx.select().from(comunicadoDestinatario).where(eq(comunicadoDestinatario.comunicadoId, id));
      const pend = ds.filter((d) => (c.pedirCiencia ? !d.cienteEm : !d.abertoEm) && (!empregadoIds?.length || empregadoIds.includes(d.empregadoId)));
      const pessoas = (await this.pessoasDoTenant(tx, tenantId)).filter((p) => pend.some((d) => d.empregadoId === p.id));
      return { c, pessoas };
    });
    if (!this.push.ativo) return { pessoas: r.pessoas.length, receberam: 0, semChaves: true };
    const tag = tagFixa ?? `comunicado-lembrete-${id}-${Date.now()}`;
    const receberam = await this.notificarPessoas(tenantId, r.pessoas, {
      titulo: r.c.pedirCiencia ? `Falta sua ciência: ${r.c.titulo}` : `Você ainda não viu: ${r.c.titulo}`,
      corpo: r.c.pedirCiencia ? 'Abra o comunicado e toque em "Li e estou ciente".' : 'Toque para abrir o comunicado do RH.',
      url: `/avisos/${id}`, tag,
    });
    return { pessoas: r.pessoas.length, receberam, semChaves: false };
  }

  async fixar(tenantId: string, id: string, fixado: boolean) {
    await this.alterarStatus(tenantId, id, { fixado });
    return { ok: true };
  }
  async arquivar(tenantId: string, id: string, arquivar: boolean) {
    const c = await this.alterarStatus(tenantId, id, arquivar ? { status: 'ARQUIVADO', fixado: false } : { status: 'PUBLICADO' });
    if (arquivar && c.status !== 'PUBLICADO') throw new BadRequestException('Só comunicados publicados podem ser arquivados.');
    return { ok: true };
  }
  private async alterarStatus(tenantId: string, id: string, set: Partial<typeof comunicado.$inferInsert>) {
    return comTenant(this.db, tenantId, async (tx) => {
      const c = (await tx.select().from(comunicado).where(and(eq(comunicado.tenantId, tenantId), eq(comunicado.id, id))).limit(1))[0];
      if (!c) throw new NotFoundException('Comunicado não encontrado.');
      if (set.status === 'ARQUIVADO' && c.status !== 'PUBLICADO') return c;
      if (set.status === 'PUBLICADO' && c.status !== 'ARQUIVADO') return c;
      await tx.update(comunicado).set({ ...set, atualizadoEm: new Date() }).where(eq(comunicado.id, id));
      return c;
    });
  }
  /** Volta um agendado para rascunho. */
  async desagendar(tenantId: string, id: string) {
    await comTenant(this.db, tenantId, (tx) => tx.update(comunicado).set({ status: 'RASCUNHO', agendadoPara: null, atualizadoEm: new Date() })
      .where(and(eq(comunicado.tenantId, tenantId), eq(comunicado.id, id), eq(comunicado.status, 'AGENDADO'))));
    return { ok: true };
  }
  async excluir(tenantId: string, id: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const c = (await tx.select({ status: comunicado.status }).from(comunicado).where(and(eq(comunicado.tenantId, tenantId), eq(comunicado.id, id))).limit(1))[0];
      if (!c) throw new NotFoundException('Comunicado não encontrado.');
      if (c.status === 'PUBLICADO' || c.status === 'ARQUIVADO') throw new BadRequestException('Comunicado publicado não pode ser excluído (vale como comprovante). Arquive.');
      await tx.delete(comunicado).where(eq(comunicado.id, id));
      return { ok: true };
    });
  }

  // ───────────────────────── mídia ─────────────────────────

  async enviarMidia(tenantId: string, tipo: string, arquivo: ArquivoEnviado | undefined, miniatura?: ArquivoEnviado) {
    if (!arquivo?.buffer?.length) throw new BadRequestException('Nenhum arquivo enviado.');
    const b = arquivo.buffer;
    let mime = arquivo.mimetype || 'application/octet-stream';
    if (tipo === 'FOTO') {
      const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
      const png = b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const webp = b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP';
      if (!jpeg && !png && !webp) throw new BadRequestException('A foto precisa ser JPG, PNG ou WEBP.');
      if (b.length > LIMITES.FOTO) throw new BadRequestException('Foto grande demais (máximo 2 MB).');
      mime = jpeg ? 'image/jpeg' : png ? 'image/png' : 'image/webp';
      if (miniatura && (miniatura.buffer.length > LIMITES.MINI || !(miniatura.buffer[0] === 0xff && miniatura.buffer[1] === 0xd8))) {
        throw new BadRequestException('Miniatura inválida.');
      }
    } else if (tipo === 'AUDIO') {
      if (!/^(audio|video)\/(webm|ogg|mp4|mpeg|mp3|aac|x-m4a|m4a|wav|x-wav|opus)/i.test(mime) && !/\.(webm|ogg|opus|m4a|mp3|aac|wav|mp4)$/i.test(arquivo.originalname)) {
        throw new BadRequestException('Formato de áudio não aceito. Use MP3, M4A, OGG, OPUS, WAV ou WEBM.');
      }
      if (b.length > LIMITES.AUDIO) throw new BadRequestException('Áudio grande demais (máximo 10 MB, uns 10 minutos).');
      if (mime.startsWith('video/')) mime = mime.replace('video/', 'audio/');
      if (mime === 'application/octet-stream') mime = /\.mp3$/i.test(arquivo.originalname) ? 'audio/mpeg' : /\.(m4a|mp4|aac)$/i.test(arquivo.originalname) ? 'audio/mp4' : /\.wav$/i.test(arquivo.originalname) ? 'audio/wav' : 'audio/ogg';
    } else if (tipo === 'ARQUIVO') {
      if (b.subarray(0, 4).toString('ascii') !== '%PDF') throw new BadRequestException('O arquivo precisa ser PDF.');
      if (b.length > LIMITES.ARQUIVO) throw new BadRequestException('PDF grande demais (máximo 10 MB).');
      mime = 'application/pdf';
    } else throw new BadRequestException('Tipo de mídia inválido.');

    const nome = (arquivo.originalname || '').replace(/[^\p{L}\p{N} ._()-]/gu, '').slice(0, 160) || null;
    const m = await comTenant(this.db, tenantId, (tx) => tx.insert(comunicadoMidia).values({
      tenantId, tipo, mime, nome, bytes: b.length, dados: b, miniatura: miniatura?.buffer ?? null,
    }).returning({ id: comunicadoMidia.id }));
    return { id: m[0]!.id, tipo, nome, bytes: b.length, mime };
  }

  /**
   * Bytes de uma mídia. O RH vê tudo do tenant; o funcionário só o que está
   * num comunicado publicado para ele.
   */
  async midia(tenantId: string, id: string, empregadoId: string | null, mini: boolean) {
    return comTenant(this.db, tenantId, async (tx) => {
      const m = (await tx.select().from(comunicadoMidia).where(and(eq(comunicadoMidia.tenantId, tenantId), eq(comunicadoMidia.id, id))).limit(1))[0];
      if (!m) throw new NotFoundException('Mídia não encontrada.');
      if (empregadoId) {
        if (!m.comunicadoId) throw new NotFoundException('Mídia não encontrada.');
        const ok = await tx.select({ c: comunicado.id }).from(comunicadoDestinatario)
          .innerJoin(comunicado, eq(comunicado.id, comunicadoDestinatario.comunicadoId))
          .where(and(eq(comunicadoDestinatario.comunicadoId, m.comunicadoId), eq(comunicadoDestinatario.empregadoId, empregadoId), eq(comunicado.status, 'PUBLICADO'))).limit(1);
        if (!ok.length) throw new NotFoundException('Mídia não encontrada.');
      }
      if (mini && m.miniatura) return { dados: m.miniatura, mime: 'image/jpeg', nome: m.nome };
      return { dados: m.dados, mime: m.mime, nome: m.nome };
    });
  }

  /** Reconhece o link e busca o título (YouTube/Vimeo têm oEmbed público). */
  async infoVideo(url: string) {
    const v = reconhecerVideo(url);
    if (!v) throw new BadRequestException('Link não reconhecido. Use um link do YouTube, Vimeo ou Google Drive.');
    let titulo: string | null = null;
    const oembed = v.provedor === 'YOUTUBE' ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${v.videoId}`)}`
      : v.provedor === 'VIMEO' ? `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(`https://vimeo.com/${v.videoId}`)}` : null;
    let miniatura = v.miniatura;
    if (oembed && process.env.NODE_ENV !== 'test') {
      try {
        const r = await fetch(oembed, { signal: AbortSignal.timeout(3500) });
        if (r.ok) {
          const j = await r.json() as { title?: string; thumbnail_url?: string };
          titulo = j.title?.slice(0, 160) ?? null;
          if (!miniatura && j.thumbnail_url) miniatura = j.thumbnail_url;
        }
      } catch { /* sem título: segue só com o link */ }
    }
    return { ...v, miniatura, titulo };
  }

  async pdfCiencia(tenantId: string, id: string) {
    const fuso = await this.fusoDo(tenantId);
    const d = await this.obter(tenantId, id);
    if (d.status !== 'PUBLICADO' && d.status !== 'ARQUIVADO') throw new BadRequestException('O comunicado ainda não foi publicado.');
    const extra = await comTenant(this.db, tenantId, async (tx) => {
      const cpfs = d.destinatarios.length ? await tx.select({ id: empregado.id, cpf: empregado.cpf }).from(empregado)
        .where(inArray(empregado.id, d.destinatarios.map((x) => x.empregadoId))) : [];
      const rep = (await tx.select({ r: pontoRep.razaoSocial }).from(pontoRep).where(eq(pontoRep.tenantId, tenantId)).limit(1))[0];
      return { cpfs: new Map(cpfs.map((c) => [c.id, c.cpf])), razao: rep?.r };
    });
    const razao = extra.razao ?? (await comoMaster(this.db, (tx) => tx.select({ r: tenant.razaoSocial }).from(tenant).where(eq(tenant.id, tenantId)).limit(1)))[0]?.r ?? '';
    const buffer = await gerarCienciaComunicadoPdf({
      empregador: razao, titulo: d.titulo, publicadoEm: d.publicadoEmLocal ?? '—', autor: d.autorNome ?? 'RH',
      pedirCiencia: d.pedirCiencia, geradoEm: dataHoraLocal(new Date(), fuso)!,
      linhas: d.destinatarios.map((x) => ({
        nome: x.nome, cpf: extra.cpfs.get(x.empregadoId) ?? '',
        abertoEm: dataHoraLocal(x.abertoEm ? new Date(x.abertoEm) : null, fuso), cienteEm: dataHoraLocal(x.cienteEm ? new Date(x.cienteEm) : null, fuso),
      })),
    });
    const slug = d.titulo.normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 40) || 'comunicado';
    return { buffer, nomeArquivo: `ciencia_${slug}.pdf` };
  }

  // ───────────────────────── funcionário ─────────────────────────

  async meus(tenantId: string, empregadoId: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const linhas = await tx.select({ c: comunicado, d: comunicadoDestinatario }).from(comunicadoDestinatario)
        .innerJoin(comunicado, eq(comunicado.id, comunicadoDestinatario.comunicadoId))
        .where(and(eq(comunicadoDestinatario.tenantId, tenantId), eq(comunicadoDestinatario.empregadoId, empregadoId), eq(comunicado.status, 'PUBLICADO')))
        .orderBy(desc(comunicado.fixado), desc(comunicado.publicadoEm)).limit(100);
      const ids = linhas.map((l) => l.c.id);
      const reac = ids.length ? await tx.select({ c: comunicadoDestinatario.comunicadoId, r: comunicadoDestinatario.reacao, n: sql<number>`count(*)::int` })
        .from(comunicadoDestinatario).where(and(inArray(comunicadoDestinatario.comunicadoId, ids), sql`${comunicadoDestinatario.reacao} is not null`))
        .groupBy(comunicadoDestinatario.comunicadoId, comunicadoDestinatario.reacao) : [];
      const itens = linhas.map(({ c, d }) => this.cartao(c, d, reac.filter((r) => r.c === c.id)));
      return {
        itens,
        naoLidos: itens.filter((i) => !i.abertoEm).length,
        pendentesCiencia: itens.filter((i) => i.pedirCiencia && !i.cienteEm).length,
      };
    });
  }

  /** Resumo leve para a bolinha da aba e o aviso na tela de ponto. */
  async meuResumo(tenantId: string, empregadoId: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const ls = await tx.select({ titulo: comunicado.titulo, id: comunicado.id, pedir: comunicado.pedirCiencia, aberto: comunicadoDestinatario.abertoEm, ciente: comunicadoDestinatario.cienteEm })
        .from(comunicadoDestinatario).innerJoin(comunicado, eq(comunicado.id, comunicadoDestinatario.comunicadoId))
        .where(and(eq(comunicadoDestinatario.tenantId, tenantId), eq(comunicadoDestinatario.empregadoId, empregadoId), eq(comunicado.status, 'PUBLICADO')))
        .orderBy(desc(comunicado.publicadoEm));
      const pend = ls.filter((l) => l.pedir && !l.ciente);
      return { naoLidos: ls.filter((l) => !l.aberto).length, pendentesCiencia: pend.length, primeiroPendente: pend[0] ? { id: pend[0].id, titulo: pend[0].titulo } : null };
    });
  }

  private cartao(c: typeof comunicado.$inferSelect, d: typeof comunicadoDestinatario.$inferSelect, reac: { r: string | null; n: number }[]) {
    const texto = c.blocos.find((b) => b.tipo === 'TEXTO') as { texto: string } | undefined;
    const video = c.blocos.find((b) => b.tipo === 'VIDEO') as Extract<BlocoComunicado, { tipo: 'VIDEO' }> | undefined;
    const fotos = c.blocos.flatMap((b) => (b.tipo === 'FOTOS' ? b.midias : []));
    const audio = c.blocos.find((b) => b.tipo === 'AUDIO') as Extract<BlocoComunicado, { tipo: 'AUDIO' }> | undefined;
    // Destaque do cartão: vídeo > fotos > áudio (o resto vira "+ áudio e 3 fotos").
    const destaque = video ? 'VIDEO' : fotos.length ? 'FOTOS' : audio ? 'AUDIO' : null;
    const outros: string[] = [];
    if (destaque !== 'AUDIO' && audio) outros.push('áudio');
    if (destaque !== 'FOTOS' && fotos.length) outros.push(fotos.length === 1 ? '1 foto' : `${fotos.length} fotos`);
    if (c.blocos.some((b) => b.tipo === 'ARQUIVO')) outros.push('PDF');
    return {
      id: c.id, titulo: c.titulo, autorNome: c.autorNome ?? 'RH', publicadoEm: c.publicadoEm!.toISOString(), fixado: c.fixado,
      pedirCiencia: c.pedirCiencia, reacoesAtivas: c.reacoes,
      trecho: texto ? texto.texto.slice(0, 180) : null,
      destaque, video: video ? { provedor: video.provedor, videoId: video.videoId, titulo: video.titulo } : null,
      fotos: fotos.slice(0, 3), totalFotos: fotos.length, audio: audio ?? null, outros,
      abertoEm: d.abertoEm?.toISOString() ?? null, cienteEm: d.cienteEm?.toISOString() ?? null, midiaEm: d.midiaEm?.toISOString() ?? null,
      minhaReacao: d.reacao, reacoes: c.reacoes ? Object.fromEntries(reac.filter((r) => r.r).map((r) => [r.r!, r.n])) : {},
    };
  }

  private async meuDestino(tx: Tx, tenantId: string, empregadoId: string, id: string) {
    const r = (await tx.select({ c: comunicado, d: comunicadoDestinatario }).from(comunicadoDestinatario)
      .innerJoin(comunicado, eq(comunicado.id, comunicadoDestinatario.comunicadoId))
      .where(and(eq(comunicadoDestinatario.tenantId, tenantId), eq(comunicadoDestinatario.comunicadoId, id), eq(comunicadoDestinatario.empregadoId, empregadoId), eq(comunicado.status, 'PUBLICADO'))).limit(1))[0];
    if (!r) throw new NotFoundException('Comunicado não encontrado.');
    return r;
  }

  /** Abre o comunicado (marca como lido na primeira vez). */
  async abrir(tenantId: string, empregadoId: string, id: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const { c, d } = await this.meuDestino(tx, tenantId, empregadoId, id);
      let abertoEm = d.abertoEm;
      if (!abertoEm) {
        abertoEm = new Date();
        await tx.update(comunicadoDestinatario).set({ abertoEm })
          .where(and(eq(comunicadoDestinatario.comunicadoId, id), eq(comunicadoDestinatario.empregadoId, empregadoId)));
      }
      const midias = await tx.select({ id: comunicadoMidia.id, tipo: comunicadoMidia.tipo, nome: comunicadoMidia.nome, bytes: comunicadoMidia.bytes })
        .from(comunicadoMidia).where(eq(comunicadoMidia.comunicadoId, id));
      const reac = await tx.select({ r: comunicadoDestinatario.reacao, n: sql<number>`count(*)::int` }).from(comunicadoDestinatario)
        .where(and(eq(comunicadoDestinatario.comunicadoId, id), sql`${comunicadoDestinatario.reacao} is not null`)).groupBy(comunicadoDestinatario.reacao);
      return {
        id: c.id, titulo: c.titulo, autorNome: c.autorNome ?? 'RH', publicadoEm: c.publicadoEm!.toISOString(), blocos: c.blocos, midias,
        pedirCiencia: c.pedirCiencia, reacoesAtivas: c.reacoes,
        abertoEm: abertoEm.toISOString(), cienteEm: d.cienteEm?.toISOString() ?? null, midiaEm: d.midiaEm?.toISOString() ?? null,
        minhaReacao: d.reacao, reacoes: c.reacoes ? Object.fromEntries(reac.filter((r) => r.r).map((r) => [r.r!, r.n])) : {},
      };
    });
  }

  private async marcar(tenantId: string, empregadoId: string, id: string, set: Partial<typeof comunicadoDestinatario.$inferInsert>, soSeNulo?: 'midiaEm' | 'cienteEm') {
    return comTenant(this.db, tenantId, async (tx) => {
      const { c, d } = await this.meuDestino(tx, tenantId, empregadoId, id);
      if (soSeNulo && d[soSeNulo]) return { c, d };
      await tx.update(comunicadoDestinatario).set({ ...set, abertoEm: d.abertoEm ?? new Date() })
        .where(and(eq(comunicadoDestinatario.comunicadoId, id), eq(comunicadoDestinatario.empregadoId, empregadoId)));
      return { c, d };
    });
  }

  async marcarMidia(tenantId: string, empregadoId: string, id: string) {
    await this.marcar(tenantId, empregadoId, id, { midiaEm: new Date() }, 'midiaEm');
    return { ok: true };
  }
  async ciente(tenantId: string, empregadoId: string, id: string) {
    const agora = new Date();
    const r = await this.marcar(tenantId, empregadoId, id, { cienteEm: agora }, 'cienteEm');
    return { cienteEm: (r.d.cienteEm ?? agora).toISOString() };
  }
  async reagir(tenantId: string, empregadoId: string, id: string, reacao: string | null) {
    if (reacao !== null && !(REACOES as readonly string[]).includes(reacao)) throw new BadRequestException('Reação inválida.');
    await comTenant(this.db, tenantId, async (tx) => {
      const { c } = await this.meuDestino(tx, tenantId, empregadoId, id);
      if (!c.reacoes) throw new BadRequestException('Este comunicado não aceita reações.');
      await tx.update(comunicadoDestinatario).set({ reacao })
        .where(and(eq(comunicadoDestinatario.comunicadoId, id), eq(comunicadoDestinatario.empregadoId, empregadoId)));
    });
    return { ok: true };
  }

  // ───────────────────────── rotina ─────────────────────────

  /** Publica os agendados que venceram, manda o lembrete de 24h e limpa mídias órfãs. */
  async rotina(agora = new Date()) {
    const vencidos = await comoMaster(this.db, (tx) => tx.select({ id: comunicado.id, t: comunicado.tenantId }).from(comunicado)
      .where(and(eq(comunicado.status, 'AGENDADO'), lte(comunicado.agendadoPara, agora))));
    let publicados = 0, lembretes = 0;
    for (const v of vencidos) {
      try {
        const r = await this.efetivarPublicacao(v.t, v.id);
        await r.envio;
        publicados++;
      } catch (e) { this.log.error(`Publicar agendado ${v.id}: ${(e as Error).message}`); }
    }
    // Lembrete automático: 24h depois, uma vez só (a marcação lembrete_em é a trava).
    const limite = new Date(agora.getTime() - 86_400_000);
    const pend = await comoMaster(this.db, (tx) => tx.update(comunicado).set({ lembreteEm: agora })
      .where(and(eq(comunicado.status, 'PUBLICADO'), eq(comunicado.lembrar, true), isNull(comunicado.lembreteEm), lte(comunicado.publicadoEm, limite)))
      .returning({ id: comunicado.id, t: comunicado.tenantId }));
    for (const p of pend) {
      try { await this.lembrar(p.t, p.id, undefined, `comunicado-lembrete-${p.id}`); lembretes++; }
      catch (e) { this.log.error(`Lembrete comunicado ${p.id}: ${(e as Error).message}`); }
    }
    await comoMaster(this.db, (tx) => tx.delete(comunicadoMidia)
      .where(and(isNull(comunicadoMidia.comunicadoId), lt(comunicadoMidia.criadoEm, new Date(agora.getTime() - 86_400_000)))));
    return { publicados, lembretes };
  }
}
