import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import JSZip from 'jszip';
import {
  comTenant, comoMaster, pessoalLancamento, pessoalNfArquivo, pessoalNota, pessoalPrestador, prestadorConvite, pushSubscription,
  tenant, usuario, type ConferenciaNota, type Db, type LinhaDetalheNota,
} from '@ponto/db';
import { DB } from '../database/database.module';
import { PessoalService, type CompetenciaPessoal } from '../pessoal/pessoal.service';
import { PushService } from '../notificacao/push.service';
import { EmailService } from '../email/email.service';
import { emailConvitePrestador } from '../email/templates';
import { AuthService } from '../auth/auth.service';
import { hashSenha } from '../auth/senha';
import { centavos } from '../pessoal/calculo';
import {
  conferir, dataBr, detalheMei, detalheSemana, diaMes, fimDaSemana, gerarCodigo, lerNfseXml, linkWhatsapp, maisUrgente, mascararPix,
  mensagemConvite, reaisBr, rotuloMes, rotuloPeriodo, situacaoDe, valorSemana, type Situacao, type StatusNota,
} from './regras';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Nota = typeof pessoalNota.$inferSelect;
type Prestador = typeof pessoalPrestador.$inferSelect;

const COMP_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
const DIA_MS = 86_400_000;
const EMISSOR_NFSE = 'https://www.nfse.gov.br/EmissorNacional';
const urlWeb = () => (process.env.APP_WEB_URL ?? 'https://painel.pontosnap.app.br').replace(/\/$/, '');

/** Hoje (YYYY-MM-DD) e hora no fuso da empresa ("-0300"). */
function agoraLocal(fuso: string, agora = new Date()) {
  const m = /^([+-])(\d{2})(\d{2})$/.exec(fuso);
  const min = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : -180;
  const x = new Date(agora.getTime() + min * 60_000);
  return { hoje: x.toISOString().slice(0, 10), hora: x.getUTCHours() };
}

export interface ArquivoNota { id: string; nome: string; mime: string; bytes: number }

@Injectable()
export class PortalService {
  private readonly log = new Logger(PortalService.name);
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly pessoal: PessoalService,
    private readonly push: PushService,
    private readonly email: EmailService,
    private readonly auth: AuthService,
  ) {}

  // ───────────────────────── apoio ─────────────────────────

  private validarComp(c: string) {
    if (!COMP_RE.test(c ?? '')) throw new BadRequestException('Competência inválida (use YYYY-MM)');
  }

  private async fusoDo(tenantId: string) {
    return (await comoMaster(this.db, (tx) => tx.select({ fuso: tenant.fuso }).from(tenant).where(eq(tenant.id, tenantId)).limit(1)))[0]?.fuso ?? '-0300';
  }

  /** Empresa (nome curto para mensagens) e tomador padrão da nota. */
  private async empresaDo(tenantId: string) {
    const t = (await comoMaster(this.db, (tx) => tx.select({ razao: tenant.razaoSocial, cnpj: tenant.cnpj }).from(tenant).where(eq(tenant.id, tenantId)).limit(1)))[0];
    return { razao: t?.razao ?? '', cnpj: t?.cnpj ?? '' };
  }

  private tomadorDe(p: Prestador, emp: { razao: string; cnpj: string }) {
    return { nome: p.tomadorNome || emp.razao, cnpj: p.tomadorCnpj || emp.cnpj };
  }

  /** Prestador dono desta conta (perfil PRESTADOR). */
  async prestadorDoUsuario(tenantId: string, usuarioId: string): Promise<Prestador> {
    return comTenant(this.db, tenantId, async (tx) => {
      const u = (await tx.select({ p: usuario.prestadorId }).from(usuario).where(eq(usuario.id, usuarioId)).limit(1))[0];
      if (!u?.p) throw new ForbiddenException('Este acesso não está vinculado a um prestador.');
      const p = (await tx.select().from(pessoalPrestador).where(and(eq(pessoalPrestador.id, u.p), eq(pessoalPrestador.tenantId, tenantId))).limit(1))[0];
      if (!p) throw new ForbiddenException('Prestador não encontrado.');
      return p;
    });
  }

  /** Contas ativas de prestador (para mandar push), por prestador. */
  private async contasDe(tx: Tx, tenantId: string, ids: string[]) {
    if (!ids.length) return new Map<string, string>();
    const us = await tx.select({ id: usuario.id, p: usuario.prestadorId }).from(usuario)
      .where(and(eq(usuario.tenantId, tenantId), eq(usuario.ativo, true), eq(usuario.perfil, 'PRESTADOR'), inArray(usuario.prestadorId, ids)));
    return new Map(us.filter((u) => u.p).map((u) => [u.p!, u.id]));
  }

  private async avisar(tenantId: string, usuarioId: string | undefined, n: { titulo: string; corpo: string; url: string; tag: string }) {
    if (!usuarioId) return false;
    try { return (await this.push.enviar(tenantId, usuarioId, null, 'sempre', n)).entregues > 0; }
    catch (e) { this.log.warn(`Push do portal falhou: ${(e as Error).message}`); return false; }
  }

  /** Lançamentos (NF digitada e pagamento) de um conjunto de prestadores. */
  private async lancamentosDe(tx: Tx, tenantId: string, ids: string[], comp?: string) {
    if (!ids.length) return [];
    return tx.select().from(pessoalLancamento).where(and(
      eq(pessoalLancamento.tenantId, tenantId), inArray(pessoalLancamento.pessoaId, ids),
      ...(comp ? [eq(pessoalLancamento.competencia, comp)] : [])));
  }

  private async arquivosDe(tx: Tx, tenantId: string, ids: string[], comp?: string) {
    if (!ids.length) return [];
    return tx.select({
      id: pessoalNfArquivo.id, pessoaId: pessoalNfArquivo.pessoaId, competencia: pessoalNfArquivo.competencia, periodo: pessoalNfArquivo.periodo,
      nome: pessoalNfArquivo.arquivoNome, mime: pessoalNfArquivo.arquivoMime, bytes: pessoalNfArquivo.arquivoBytes,
    }).from(pessoalNfArquivo).where(and(eq(pessoalNfArquivo.tenantId, tenantId), inArray(pessoalNfArquivo.pessoaId, ids),
      ...(comp ? [eq(pessoalNfArquivo.competencia, comp)] : [])));
  }

  /** Visão da nota (comum ao prestador e ao RH). */
  private visao(n: Nota, extra: {
    lanc?: typeof pessoalLancamento.$inferSelect; arquivo?: ArquivoNota | null;
  }) {
    const l = extra.lanc;
    const pago = !!l?.pago;
    return {
      id: n.id, pessoaTipo: n.pessoaTipo, competencia: n.competencia, periodo: n.periodo,
      rotulo: rotuloPeriodo(n.competencia, n.periodo), fim: n.periodo === 'MES' ? null : fimDaSemana(n.periodo),
      valorCent: n.valorCent, detalhe: n.detalhe, versao: n.versao, liberadoEm: n.liberadoEm.toISOString(), prazo: n.prazo,
      pedirConfirmacao: n.pedirConfirmacao, status: n.status as StatusNota, vistoEm: n.vistoEm?.toISOString() ?? null,
      confirmacao: n.confirmacao, contestacao: n.contestacao, resposta: n.resposta, respondidoEm: n.respondidoEm?.toISOString() ?? null,
      enviadaEm: n.enviadaEm?.toISOString() ?? null, motivoRecusa: n.motivoRecusa, conferidaEm: n.conferidaEm?.toISOString() ?? null,
      conferencia: n.conferencia ?? null, nfValorCent: n.nfValorCent,
      nf: { numero: l?.nfNumero ?? null, data: l?.nfData ?? null, arquivo: extra.arquivo ?? null },
      pago, pagoEm: pago ? l?.pagoEm?.toISOString() ?? null : null,
      valorPagoCent: pago && l?.valorPago != null ? centavos(l.valorPago) : null,
      lembretes: n.lembretes, lembreteEm: n.lembreteEm?.toISOString() ?? null,
    };
  }

  // ───────────────────────── convite (público) ─────────────────────────

  private async conviteValido(codigo: string) {
    const c = codigo.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const fmt = c.length === 6 ? `${c.slice(0, 4)}-${c.slice(4)}` : codigo;
    return comoMaster(this.db, async (tx) => {
      const r = (await tx.select({ conv: prestadorConvite, p: pessoalPrestador, emp: tenant.razaoSocial })
        .from(prestadorConvite)
        .innerJoin(pessoalPrestador, eq(pessoalPrestador.id, prestadorConvite.prestadorId))
        .innerJoin(tenant, eq(tenant.id, prestadorConvite.tenantId))
        .where(eq(prestadorConvite.codigo, fmt)).limit(1))[0];
      return r ?? null;
    });
  }

  /** Dados do convite para a tela de primeiro acesso (sem expor o documento inteiro). */
  async convite(codigo: string) {
    const r = await this.conviteValido(codigo);
    if (!r) throw new NotFoundException('Convite não encontrado. Peça um novo link ao RH.');
    const doc = r.p.documento ?? '';
    return {
      nome: r.p.nome.split(/\s+/)[0], empresa: r.emp, tipo: r.p.tipo,
      tipoDocumento: doc.length === 14 ? 'CNPJ' : 'CPF',
      finalDocumento: doc.slice(-2),
      telefone: r.p.telefone,
      expirado: r.conv.expiraEm < new Date(), usado: !!r.conv.usadoEm,
    };
  }

  /** Cria (ou recria) a conta do prestador e já abre a sessão. */
  async aceitarConvite(codigo: string, d: { documento: string; senha: string; telefone?: string | null }) {
    const r = await this.conviteValido(codigo);
    if (!r) throw new NotFoundException('Convite não encontrado. Peça um novo link ao RH.');
    if (r.conv.usadoEm) throw new BadRequestException('Este link já foi usado. Entre com seu CPF/CNPJ e senha.');
    if (r.conv.expiraEm < new Date()) throw new BadRequestException('Este link venceu. Peça um novo ao RH.');
    const doc = d.documento.replace(/\D/g, '');
    if (!r.p.documento || doc !== r.p.documento) throw new BadRequestException('O CPF/CNPJ não confere com o cadastro. Fale com o RH.');
    if (d.senha.length < 8) throw new BadRequestException('A senha precisa ter pelo menos 8 caracteres.');
    const senhaHash = await hashSenha(d.senha);
    const tel = d.telefone?.replace(/\D/g, '') || null;
    const u = await comoMaster(this.db, async (tx) => {
      const atual = (await tx.select().from(usuario).where(eq(usuario.prestadorId, r.p.id)).limit(1))[0];
      let conta: typeof usuario.$inferSelect;
      if (atual) {
        [conta] = await tx.update(usuario).set({ senhaHash, ativo: true, deveTrocarSenha: false, documento: doc })
          .where(eq(usuario.id, atual.id)).returning() as [typeof usuario.$inferSelect];
      } else {
        [conta] = await tx.insert(usuario).values({
          tenantId: r.conv.tenantId, email: `prestador.${r.p.id}@portal.pontosnap.app.br`, senhaHash,
          perfil: 'PRESTADOR', prestadorId: r.p.id, documento: doc, deveTrocarSenha: false,
        }).returning() as [typeof usuario.$inferSelect];
      }
      await tx.update(prestadorConvite).set({ usadoEm: new Date() }).where(eq(prestadorConvite.id, r.conv.id));
      if (tel) await tx.update(pessoalPrestador).set({ telefone: tel }).where(eq(pessoalPrestador.id, r.p.id));
      return conta;
    });
    return this.auth.sessaoDe(u);
  }

  // ───────────────────────── prestador ─────────────────────────

  /** Tudo que o app do prestador precisa: quem é, notas (mais recente primeiro) e dados para emitir. */
  async eu(tenantId: string, usuarioId: string) {
    const p = await this.prestadorDoUsuario(tenantId, usuarioId);
    const emp = await this.empresaDo(tenantId);
    const { notas, lancs, arqs } = await comTenant(this.db, tenantId, async (tx) => ({
      notas: await tx.select().from(pessoalNota).where(and(eq(pessoalNota.tenantId, tenantId), eq(pessoalNota.pessoaId, p.id)))
        .orderBy(desc(pessoalNota.competencia), desc(pessoalNota.periodo)),
      lancs: await this.lancamentosDe(tx, tenantId, [p.id]),
      arqs: await this.arquivosDe(tx, tenantId, [p.id]),
    }));
    const lista = notas.map((n) => this.visao(n, {
      lanc: lancs.find((l) => l.competencia === n.competencia && l.periodo === n.periodo),
      arquivo: arqs.find((a) => a.competencia === n.competencia && a.periodo === n.periodo) ?? null,
    }));
    const tomador = this.tomadorDe(p, emp);
    return {
      prestador: {
        id: p.id, nome: p.nome, tipo: p.tipo, funcao: p.funcao, empresa: p.empresa, documento: p.documento,
        chavePix: mascararPix(p.chavePix), telefone: p.telefone, avatarSemente: p.avatarSemente,
      },
      empresa: emp.razao,
      tomador,
      emissorUrl: EMISSOR_NFSE,
      notas: lista.map((n) => ({ ...n, descricao: this.descricao(p, n.competencia, n.periodo) })),
    };
  }

  private descricao(p: Prestador, comp: string, periodo: string) {
    const servico = p.funcao?.trim() || (p.tipo === 'MOTORISTA' ? 'Serviço de transporte e entregas' : 'Prestação de serviços');
    return periodo === 'MES'
      ? `${servico} — competência ${comp.slice(5, 7)}/${comp.slice(0, 4)}`
      : `${servico} — semana ${dataBr(periodo)} a ${dataBr(fimDaSemana(periodo))}`;
  }

  private async minhaNota(tx: Tx, tenantId: string, prestadorId: string, id: string) {
    const n = (await tx.select().from(pessoalNota).where(and(eq(pessoalNota.tenantId, tenantId), eq(pessoalNota.id, id), eq(pessoalNota.pessoaId, prestadorId))).limit(1))[0];
    if (!n) throw new NotFoundException('Nota não encontrada.');
    return n;
  }

  async marcarVisto(tenantId: string, usuarioId: string, id: string) {
    const p = await this.prestadorDoUsuario(tenantId, usuarioId);
    await comTenant(this.db, tenantId, async (tx) => {
      await this.minhaNota(tx, tenantId, p.id, id);
      await tx.update(pessoalNota).set({ vistoEm: new Date() }).where(and(eq(pessoalNota.id, id), isNull(pessoalNota.vistoEm)));
    });
    return { ok: true };
  }

  /** "Confere" ou "Não confere (motivo)" antes de emitir. */
  async confirmar(tenantId: string, usuarioId: string, id: string, d: { confere: boolean; motivo?: string | null }) {
    const p = await this.prestadorDoUsuario(tenantId, usuarioId);
    const motivo = d.motivo?.trim() || null;
    if (!d.confere && !motivo) throw new BadRequestException('Conte o que não confere para o RH.');
    const r = await comTenant(this.db, tenantId, async (tx) => {
      const n = await this.minhaNota(tx, tenantId, p.id, id);
      if (n.status === 'APROVADA') throw new BadRequestException('Esta nota já foi aprovada.');
      const [x] = await tx.update(pessoalNota).set(d.confere
        ? { confirmacao: 'CONFERE', confirmadoEm: new Date() }
        : { confirmacao: 'CONTESTOU', confirmadoEm: new Date(), contestacao: motivo!.slice(0, 1000), resposta: null, respondidoEm: null })
        .where(eq(pessoalNota.id, id)).returning();
      return x!;
    });
    return { confirmacao: r.confirmacao };
  }

  /**
   * O prestador manda a nota (PDF, XML ou foto). Grava o arquivo no mesmo
   * lugar em que o RH sobe hoje, preenche número/data no lançamento e roda a
   * conferência automática. Reenviar substitui (enquanto não aprovada).
   */
  async enviarNota(tenantId: string, usuarioId: string, id: string, d: {
    arquivoBase64: string; arquivoNome: string; arquivoMime: string; numero: string; data: string; valor?: number | null;
  }) {
    const p = await this.prestadorDoUsuario(tenantId, usuarioId);
    const n = await comTenant(this.db, tenantId, (tx) => this.minhaNota(tx, tenantId, p.id, id));
    if (n.status === 'APROVADA') throw new BadRequestException('Esta nota já foi aprovada pelo RH.');
    if (n.confirmacao === 'CONTESTOU' && !n.resposta) throw new BadRequestException('Você contestou o valor. Aguarde a resposta do RH antes de enviar a nota.');
    if (!DATA_RE.test(d.data ?? '')) throw new BadRequestException('Informe a data de emissão da nota.');
    const numero = (d.numero ?? '').trim();
    if (!numero) throw new BadRequestException('Informe o número da nota.');

    let lido = null;
    const mime = d.arquivoMime === 'text/xml' ? 'application/xml' : d.arquivoMime;
    if (mime === 'application/xml') {
      lido = lerNfseXml(Buffer.from(d.arquivoBase64, 'base64').toString('utf8'));
    }
    const arq = await this.pessoal.salvarNf(tenantId, {
      pessoaTipo: n.pessoaTipo as 'MEI' | 'MOTORISTA', pessoaId: p.id, competencia: n.competencia, periodo: n.periodo,
      arquivoBase64: d.arquivoBase64, arquivoNome: d.arquivoNome, arquivoMime: d.arquivoMime,
    });
    const emp = await this.empresaDo(tenantId);
    const outras = await comTenant(this.db, tenantId, async (tx) => (await tx.select({ nf: pessoalLancamento.nfNumero, comp: pessoalLancamento.competencia, per: pessoalLancamento.periodo })
      .from(pessoalLancamento).where(and(eq(pessoalLancamento.tenantId, tenantId), eq(pessoalLancamento.pessoaId, p.id))))
      .filter((x) => x.nf && !(x.comp === n.competencia && x.per === n.periodo)).map((x) => x.nf!));
    const valorCent = d.valor != null ? Math.round(d.valor * 100) : null;
    const conf: ConferenciaNota = conferir({
      mime, esperadoCent: n.valorCent, competencia: n.competencia, periodo: n.periodo,
      informado: { numero, data: d.data, valorCent }, lido,
      documentoPrestador: p.documento, cnpjTomador: this.tomadorDe(p, emp).cnpj || null, numerosAnteriores: outras,
    });
    await this.pessoal.salvarLancamento(tenantId, {
      pessoaTipo: n.pessoaTipo as 'MEI' | 'MOTORISTA', pessoaId: p.id, competencia: n.competencia, periodo: n.periodo,
      nfNumero: (lido?.numero ?? numero).slice(0, 60), nfData: lido?.data ?? d.data,
    });
    const r = await comTenant(this.db, tenantId, async (tx) => (await tx.update(pessoalNota).set({
      status: 'ENVIADA', enviadaEm: new Date(), nfValorCent: lido?.valorCent ?? valorCent, conferencia: conf,
      motivoRecusa: null, conferidaEm: null, conferidaPor: null,
      ...(n.pedirConfirmacao && !n.confirmacao ? { confirmacao: 'CONFERE', confirmadoEm: new Date() } : {}),
    }).where(eq(pessoalNota.id, id)).returning())[0]!);
    return { ...this.visao(r, { arquivo: arq ? { id: arq.id, nome: arq.nome, mime, bytes: arq.bytes } : null }), conferencia: conf };
  }

  /** O próprio arquivo enviado (o prestador só abre os dele). */
  async meuArquivo(tenantId: string, usuarioId: string, id: string) {
    const p = await this.prestadorDoUsuario(tenantId, usuarioId);
    const arq = await comTenant(this.db, tenantId, async (tx) => {
      const n = await this.minhaNota(tx, tenantId, p.id, id);
      return (await tx.select({ id: pessoalNfArquivo.id }).from(pessoalNfArquivo).where(and(eq(pessoalNfArquivo.tenantId, tenantId),
        eq(pessoalNfArquivo.pessoaId, p.id), eq(pessoalNfArquivo.competencia, n.competencia), eq(pessoalNfArquivo.periodo, n.periodo))).limit(1))[0];
    });
    if (!arq) throw new NotFoundException('Nenhum arquivo enviado.');
    return this.pessoal.baixarNf(tenantId, arq.id);
  }

  // ───────────────────────── RH: liberar ─────────────────────────

  /**
   * Libera os valores para os prestadores emitirem a nota. MEI: só com o mês
   * fechado (o valor é o do retrato). Motorista: por semana. Liberar de novo
   * com valor diferente atualiza a nota, sobe a versão e, se a nota já tinha
   * sido enviada, pede outra (o prestador é avisado).
   */
  async liberar(tenantId: string, d: {
    competencia: string; tipo: 'MEI' | 'MOTORISTA'; semanas?: string[]; prestadorIds?: string[];
    prazo?: string | null; pedirConfirmacao?: boolean; avisar?: boolean;
  }) {
    this.validarComp(d.competencia);
    if (d.prazo && !DATA_RE.test(d.prazo)) throw new BadRequestException('Prazo inválido.');
    const comp = await this.pessoal.competencia(tenantId, d.competencia);
    const filtro = d.prestadorIds?.length ? new Set(d.prestadorIds) : null;
    type Item = { pessoaTipo: 'MEI' | 'MOTORISTA'; pessoaId: string; nome: string; periodo: string; valorCent: number; detalhe: LinhaDetalheNota[] };
    const itens: Item[] = [];
    if (d.tipo === 'MEI') {
      if (!comp.fechado) throw new BadRequestException(`Feche ${rotuloMes(d.competencia)} antes de liberar os valores dos MEI.`);
      for (const m of comp.mei) {
        if (filtro && !filtro.has(m.id)) continue;
        if (m.liquidoCent <= 0) continue;
        itens.push({ pessoaTipo: 'MEI', pessoaId: m.id, nome: m.nome, periodo: 'MES', valorCent: m.liquidoCent, detalhe: detalheMei(m, comp.debitos, d.competencia) });
      }
    } else {
      const semanas = new Set(d.semanas ?? []);
      if (!semanas.size) throw new BadRequestException('Escolha a semana a liberar.');
      for (const m of comp.motoristas) {
        if (filtro && !filtro.has(m.id)) continue;
        for (const s of m.semanas) {
          if (!semanas.has(s.inicio) || s.dias <= 0) continue;
          const v = valorSemana(s);
          if (v <= 0) continue;
          itens.push({ pessoaTipo: 'MOTORISTA', pessoaId: m.id, nome: m.nome, periodo: s.inicio, valorCent: v, detalhe: detalheSemana(m, s) });
        }
      }
    }
    if (!itens.length) throw new BadRequestException('Nenhum valor a liberar com esses filtros.');

    const prazo = d.prazo ?? null;
    const resultado = await comTenant(this.db, tenantId, async (tx) => {
      const existentes = await tx.select().from(pessoalNota).where(and(eq(pessoalNota.tenantId, tenantId), eq(pessoalNota.competencia, d.competencia),
        inArray(pessoalNota.pessoaId, [...new Set(itens.map((i) => i.pessoaId))])));
      const contas = await this.contasDe(tx, tenantId, [...new Set(itens.map((i) => i.pessoaId))]);
      const avisos: { usuarioId?: string; titulo: string; corpo: string; tag: string }[] = [];
      let novas = 0, alteradas = 0, iguais = 0;
      for (const i of itens) {
        const atual = existentes.find((x) => x.pessoaId === i.pessoaId && x.periodo === i.periodo);
        const rotulo = rotuloPeriodo(d.competencia, i.periodo);
        const corpoPrazo = prazo ? `Emita sua nota até ${diaMes(prazo)} e envie pelo app.` : 'Emita sua nota e envie pelo app.';
        if (!atual) {
          const [r] = await tx.insert(pessoalNota).values({
            tenantId, pessoaTipo: i.pessoaTipo, pessoaId: i.pessoaId, competencia: d.competencia, periodo: i.periodo,
            valorCent: i.valorCent, detalhe: i.detalhe, prazo, pedirConfirmacao: !!d.pedirConfirmacao,
          }).returning();
          novas++;
          avisos.push({ usuarioId: contas.get(i.pessoaId), titulo: `${i.periodo === 'MES' ? `${rotulo} fechado` : `${rotulo} fechada`}: R$ ${reaisBr(i.valorCent)}`,
            corpo: corpoPrazo, tag: `nota-liberada-${r!.id}-v1` });
        } else if (atual.valorCent !== i.valorCent) {
          const jaEnviada = atual.status === 'ENVIADA' || atual.status === 'APROVADA';
          await tx.update(pessoalNota).set({
            valorCent: i.valorCent, detalhe: i.detalhe, versao: atual.versao + 1, prazo, pedirConfirmacao: !!d.pedirConfirmacao,
            liberadoEm: new Date(), confirmacao: null, confirmadoEm: null, contestacao: null, resposta: null, respondidoEm: null,
            ...(jaEnviada ? { status: 'RECUSADA', motivoRecusa: `O valor foi corrigido de R$ ${reaisBr(atual.valorCent)} para R$ ${reaisBr(i.valorCent)}. Envie uma nota com o novo valor.`, conferidaEm: new Date(), conferidaPor: 'RH' } : {}),
          }).where(eq(pessoalNota.id, atual.id));
          alteradas++;
          avisos.push({ usuarioId: contas.get(i.pessoaId), titulo: `${rotulo}: o valor mudou`,
            corpo: `Novo valor: R$ ${reaisBr(i.valorCent)}. ${jaEnviada ? 'Envie uma nota com o novo valor.' : corpoPrazo}`, tag: `nota-liberada-${atual.id}-v${atual.versao + 1}` });
        } else {
          await tx.update(pessoalNota).set({ prazo, pedirConfirmacao: !!d.pedirConfirmacao }).where(eq(pessoalNota.id, atual.id));
          iguais++;
        }
      }
      return { novas, alteradas, iguais, avisos, semAcesso: new Set(itens.filter((i) => !contas.has(i.pessoaId)).map((i) => i.pessoaId)).size };
    });
    let notificados = 0;
    if (d.avisar !== false) {
      for (const a of resultado.avisos) if (await this.avisar(tenantId, a.usuarioId, { ...a, url: '/' })) notificados++;
    }
    return { liberadas: resultado.novas, alteradas: resultado.alteradas, mantidas: resultado.iguais, notificados, semAcesso: resultado.semAcesso,
      valorCent: itens.reduce((a, i) => a + i.valorCent, 0), pessoas: new Set(itens.map((i) => i.pessoaId)).size };
  }

  // ───────────────────────── RH: painel ─────────────────────────

  /**
   * Painel do mês: cada prestador com o valor, a situação da nota (mês do MEI;
   * semanas do motorista), o acesso ao app e o pagamento.
   */
  async painel(tenantId: string, competencia: string) {
    this.validarComp(competencia);
    const comp: CompetenciaPessoal = await this.pessoal.competencia(tenantId, competencia);
    const ids = [...comp.mei.map((m) => m.id), ...comp.motoristas.map((m) => m.id)];
    const fuso = await this.fusoDo(tenantId);
    const { hoje } = agoraLocal(fuso);
    const dados = await comTenant(this.db, tenantId, async (tx) => ({
      prest: ids.length ? await tx.select().from(pessoalPrestador).where(and(eq(pessoalPrestador.tenantId, tenantId), inArray(pessoalPrestador.id, ids))) : [],
      notas: ids.length ? await tx.select().from(pessoalNota).where(and(eq(pessoalNota.tenantId, tenantId), eq(pessoalNota.competencia, competencia))) : [],
      contas: ids.length ? await tx.select({ id: usuario.id, p: usuario.prestadorId, ativo: usuario.ativo }).from(usuario)
        .where(and(eq(usuario.tenantId, tenantId), eq(usuario.perfil, 'PRESTADOR'), inArray(usuario.prestadorId, ids))) : [],
      convites: ids.length ? await tx.select().from(prestadorConvite).where(and(eq(prestadorConvite.tenantId, tenantId), inArray(prestadorConvite.prestadorId, ids))) : [],
      subs: await tx.selectDistinct({ u: pushSubscription.usuarioId }).from(pushSubscription).where(eq(pushSubscription.tenantId, tenantId)),
      lancs: await this.lancamentosDe(tx, tenantId, ids, competencia),
      arqs: await this.arquivosDe(tx, tenantId, ids, competencia),
    }));
    const comPush = new Set(dados.subs.map((s) => s.u));
    const pr = new Map(dados.prest.map((p) => [p.id, p]));
    const agora = new Date();

    const acessoDe = (id: string) => {
      const c = dados.contas.find((x) => x.p === id);
      if (c?.ativo) return { status: 'ATIVO' as const, temPush: comPush.has(c.id), conviteExpiraEm: null };
      const conv = dados.convites.filter((x) => x.prestadorId === id && !x.usadoEm).sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime())[0];
      if (conv && conv.expiraEm > agora) return { status: 'CONVIDADO' as const, temPush: false, conviteExpiraEm: conv.expiraEm.toISOString() };
      return { status: (c ? 'BLOQUEADO' : conv ? 'CONVITE_VENCIDO' : 'SEM') as 'BLOQUEADO' | 'CONVITE_VENCIDO' | 'SEM', temPush: false, conviteExpiraEm: null };
    };
    const unidade = (id: string, tipo: 'MEI' | 'MOTORISTA', periodo: string, valorCent: number) => {
      const n = dados.notas.find((x) => x.pessoaId === id && x.periodo === periodo) ?? null;
      const lanc = dados.lancs.find((l) => l.pessoaId === id && l.periodo === periodo);
      const arq = dados.arqs.find((a) => a.pessoaId === id && a.periodo === periodo);
      const temNfDoRh = !!(arq || lanc?.nfNumero) && (!n || n.status === 'AGUARDANDO');
      const sit: Situacao = situacaoDe(n, temNfDoRh);
      const pago = !!lanc?.pago;
      const atrasada = !!n?.prazo && n.prazo < hoje && (sit === 'FALTA' || sit === 'RECUSADA');
      return {
        periodo, rotulo: rotuloPeriodo(competencia, periodo), valorCent: n?.valorCent ?? valorCent, situacao: sit, atrasada, pago,
        valorPagoCent: pago && lanc?.valorPago != null ? centavos(lanc.valorPago) : null, pagoEm: pago ? lanc?.pagoEm?.toISOString() ?? null : null,
        nota: n ? this.visao(n, { lanc, arquivo: arq ?? null }) : null,
        nf: { numero: lanc?.nfNumero ?? null, arquivo: arq ?? null },
        tipo,
      };
    };

    const linhas = [
      ...comp.mei.map((m) => ({ id: m.id, tipo: 'MEI' as const, nome: m.nome, valorCent: m.liquidoCent, unidades: [unidade(m.id, 'MEI', 'MES', m.liquidoCent)] })),
      ...comp.motoristas.map((m) => ({
        id: m.id, tipo: 'MOTORISTA' as const, nome: m.nome, valorCent: m.liquidoCent,
        unidades: m.semanas.filter((s) => s.dias > 0).map((s) => unidade(m.id, 'MOTORISTA', s.inicio, valorSemana(s))),
      })),
    ].map((l) => {
      const p = pr.get(l.id);
      const liberadas = l.unidades.filter((u) => u.nota);
      const sit = maisUrgente(l.unidades.map((u) => u.situacao));
      return {
        ...l, empresa: p?.empresa ?? null, funcao: p?.funcao ?? null, documento: p?.documento ?? null, telefone: p?.telefone ?? null, email: p?.email ?? null,
        tomadorNome: p?.tomadorNome ?? null, tomadorCnpj: p?.tomadorCnpj ?? null, avatarSemente: p?.avatarSemente ?? null,
        acesso: acessoDe(l.id), situacao: sit, atrasada: l.unidades.some((u) => u.atrasada),
        vistoEm: liberadas.map((u) => u.nota!.vistoEm).filter(Boolean).sort().pop() ?? null,
        pago: l.unidades.length > 0 && l.unidades.every((u) => u.pago),
        pagoCent: l.unidades.reduce((a, u) => a + (u.valorPagoCent ?? 0), 0),
      };
    });

    const us = linhas.flatMap((l) => l.unidades);
    const conta = (f: (s: Situacao) => boolean) => us.filter((u) => f(u.situacao)).length;
    const semanas = comp.semanas.map((s) => ({
      ...s, encerrada: s.fim < hoje,
      liberada: dados.notas.some((n) => n.periodo === s.inicio),
      motoristas: comp.motoristas.filter((m) => m.semanas.some((x) => x.inicio === s.inicio && x.dias > 0)).length,
      valorCent: comp.motoristas.reduce((a, m) => a + valorSemana(m.semanas.find((x) => x.inicio === s.inicio) ?? { totalCent: 0, debitoAplicadoCent: 0 } as never), 0),
    }));
    return {
      competencia, rotulo: rotuloMes(competencia), fechado: comp.fechado, fechadoEm: comp.fechadoEm, hoje,
      meiLiberado: dados.notas.some((n) => n.periodo === 'MES'),
      semanas,
      totais: {
        pessoas: linhas.length, mei: comp.mei.length, motoristas: comp.motoristas.length,
        aPagarCent: linhas.reduce((a, l) => a + l.valorCent, 0),
        comAcesso: linhas.filter((l) => l.acesso.status === 'ATIVO').length,
        convidados: linhas.filter((l) => l.acesso.status === 'CONVIDADO').length,
        semAcesso: linhas.filter((l) => l.acesso.status !== 'ATIVO').length,
        notas: us.filter((u) => u.situacao !== 'NAO_LIBERADO').length,
        recebidas: conta((s) => s === 'CONFERIR' || s === 'APROVADA' || s === 'RH'),
        conferir: conta((s) => s === 'CONFERIR'),
        faltam: conta((s) => s === 'FALTA' || s === 'RECUSADA'),
        recusadas: conta((s) => s === 'RECUSADA'),
        aprovadas: conta((s) => s === 'APROVADA' || s === 'RH'),
        contestaram: conta((s) => s === 'CONTESTOU'),
        pagos: us.filter((u) => u.pago).length,
        pagosCent: us.reduce((a, u) => a + (u.valorPagoCent ?? 0), 0),
      },
      linhas: linhas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    };
  }

  /** Fila de conferência: notas enviadas pelo app, mais antigas primeiro. */
  async filaConferir(tenantId: string) {
    const r = await comTenant(this.db, tenantId, async (tx) => {
      const notas = await tx.select({ n: pessoalNota, nome: pessoalPrestador.nome, documento: pessoalPrestador.documento, empresa: pessoalPrestador.empresa, avatarSemente: pessoalPrestador.avatarSemente })
        .from(pessoalNota).innerJoin(pessoalPrestador, eq(pessoalPrestador.id, pessoalNota.pessoaId))
        .where(and(eq(pessoalNota.tenantId, tenantId), eq(pessoalNota.status, 'ENVIADA'))).orderBy(pessoalNota.enviadaEm);
      const ids = [...new Set(notas.map((x) => x.n.pessoaId))];
      return { notas, lancs: await this.lancamentosDe(tx, tenantId, ids), arqs: await this.arquivosDe(tx, tenantId, ids) };
    });
    return r.notas.map(({ n, nome, documento, empresa, avatarSemente }) => ({
      ...this.visao(n, {
        lanc: r.lancs.find((l) => l.pessoaId === n.pessoaId && l.competencia === n.competencia && l.periodo === n.periodo),
        arquivo: r.arqs.find((a) => a.pessoaId === n.pessoaId && a.competencia === n.competencia && a.periodo === n.periodo) ?? null,
      }),
      pessoaId: n.pessoaId, nome, documento, empresa, avatarSemente,
    }));
  }

  /** Detalhe de uma nota para o RH (com o arquivo para conferir). */
  async notaRh(tenantId: string, id: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const n = (await tx.select().from(pessoalNota).where(and(eq(pessoalNota.tenantId, tenantId), eq(pessoalNota.id, id))).limit(1))[0];
      if (!n) throw new NotFoundException('Nota não encontrada.');
      const lanc = (await this.lancamentosDe(tx, tenantId, [n.pessoaId], n.competencia)).find((l) => l.periodo === n.periodo);
      const arq = (await this.arquivosDe(tx, tenantId, [n.pessoaId], n.competencia)).find((a) => a.periodo === n.periodo) ?? null;
      return this.visao(n, { lanc, arquivo: arq });
    });
  }

  async aprovar(tenantId: string, ids: string[], autor: string) {
    if (!ids.length) throw new BadRequestException('Escolha as notas.');
    const r = await comTenant(this.db, tenantId, async (tx) => {
      const ns = await tx.update(pessoalNota).set({ status: 'APROVADA', conferidaEm: new Date(), conferidaPor: autor.slice(0, 160), motivoRecusa: null })
        .where(and(eq(pessoalNota.tenantId, tenantId), inArray(pessoalNota.id, ids), eq(pessoalNota.status, 'ENVIADA'))).returning();
      return { ns, contas: await this.contasDe(tx, tenantId, ns.map((n) => n.pessoaId)) };
    });
    for (const n of r.ns) {
      await this.avisar(tenantId, r.contas.get(n.pessoaId), {
        titulo: `Nota aprovada · ${rotuloPeriodo(n.competencia, n.periodo)}`, corpo: `O RH aprovou sua nota de R$ ${reaisBr(n.valorCent)}. Agora é só aguardar o pagamento.`,
        url: '/', tag: `nota-aprovada-${n.id}-v${n.versao}`,
      });
    }
    return { aprovadas: r.ns.length };
  }

  async recusar(tenantId: string, id: string, motivo: string, autor: string) {
    const m = motivo?.trim();
    if (!m) throw new BadRequestException('Diga o motivo — o prestador vê no app.');
    const r = await comTenant(this.db, tenantId, async (tx) => {
      const [n] = await tx.update(pessoalNota).set({ status: 'RECUSADA', motivoRecusa: m.slice(0, 500), conferidaEm: new Date(), conferidaPor: autor.slice(0, 160) })
        .where(and(eq(pessoalNota.tenantId, tenantId), eq(pessoalNota.id, id), or(eq(pessoalNota.status, 'ENVIADA'), eq(pessoalNota.status, 'APROVADA')))).returning();
      if (!n) throw new BadRequestException('Só dá para recusar nota enviada.');
      return { n, contas: await this.contasDe(tx, tenantId, [n.pessoaId]) };
    });
    await this.avisar(tenantId, r.contas.get(r.n.pessoaId), {
      titulo: `O RH pediu outra nota · ${rotuloPeriodo(r.n.competencia, r.n.periodo)}`, corpo: m, url: '/', tag: `nota-recusada-${r.n.id}-${Date.now()}`,
    });
    return { recusada: true };
  }

  async responder(tenantId: string, id: string, resposta: string) {
    const t = resposta?.trim();
    if (!t) throw new BadRequestException('Escreva a resposta.');
    const r = await comTenant(this.db, tenantId, async (tx) => {
      const [n] = await tx.update(pessoalNota).set({ resposta: t.slice(0, 1000), respondidoEm: new Date() })
        .where(and(eq(pessoalNota.tenantId, tenantId), eq(pessoalNota.id, id), eq(pessoalNota.confirmacao, 'CONTESTOU'))).returning();
      if (!n) throw new NotFoundException('Contestação não encontrada.');
      return { n, contas: await this.contasDe(tx, tenantId, [n.pessoaId]) };
    });
    await this.avisar(tenantId, r.contas.get(r.n.pessoaId), {
      titulo: `O RH respondeu sobre o valor · ${rotuloPeriodo(r.n.competencia, r.n.periodo)}`, corpo: t, url: '/', tag: `nota-resposta-${r.n.id}-${Date.now()}`,
    });
    return { respondida: true };
  }

  /** Lembra quem ainda não mandou (ou teve a nota recusada). Sem ids: todos da competência. */
  async lembrar(tenantId: string, d: { competencia?: string; notaIds?: string[] }) {
    const r = await comTenant(this.db, tenantId, async (tx) => {
      const ns = await tx.select().from(pessoalNota).where(and(eq(pessoalNota.tenantId, tenantId),
        inArray(pessoalNota.status, ['AGUARDANDO', 'RECUSADA']),
        ...(d.notaIds?.length ? [inArray(pessoalNota.id, d.notaIds)] : d.competencia ? [eq(pessoalNota.competencia, d.competencia)] : [])));
      return { ns, contas: await this.contasDe(tx, tenantId, [...new Set(ns.map((n) => n.pessoaId))]) };
    });
    if (!d.notaIds?.length && !d.competencia) throw new BadRequestException('Informe a competência ou as notas.');
    let enviados = 0, semAcesso = 0;
    const minuto = Math.floor(Date.now() / 60_000);
    for (const n of r.ns) {
      const uid = r.contas.get(n.pessoaId);
      if (!uid) { semAcesso++; continue; }
      const ok = await this.avisar(tenantId, uid, this.textoLembrete(n, `nota-lembrete-${n.id}-m${minuto}`));
      await comTenant(this.db, tenantId, (tx) => tx.update(pessoalNota).set({ lembreteEm: new Date(), lembretes: n.lembretes + 1 }).where(eq(pessoalNota.id, n.id)));
      if (ok) enviados++;
    }
    return { notas: r.ns.length, enviados, semAcesso };
  }

  private textoLembrete(n: Nota, tag: string) {
    const rot = rotuloPeriodo(n.competencia, n.periodo);
    return n.status === 'RECUSADA'
      ? { titulo: `Falta a nota corrigida · ${rot}`, corpo: `O RH pediu outra nota de R$ ${reaisBr(n.valorCent)}. Envie pelo app.`, url: '/', tag }
      : { titulo: `Sua nota de R$ ${reaisBr(n.valorCent)}`, corpo: `${rot}: ${n.prazo ? `o prazo é ${diaMes(n.prazo)}. ` : ''}Emita e envie pelo app.`, url: '/', tag };
  }

  /** Marca como pago (valor = o liberado) e avisa o prestador. */
  async pagar(tenantId: string, notaIds: string[]) {
    if (!notaIds.length) throw new BadRequestException('Escolha as notas.');
    const ns = await comTenant(this.db, tenantId, (tx) => tx.select().from(pessoalNota)
      .where(and(eq(pessoalNota.tenantId, tenantId), inArray(pessoalNota.id, notaIds))));
    const contas = await comTenant(this.db, tenantId, (tx) => this.contasDe(tx, tenantId, ns.map((n) => n.pessoaId)));
    for (const n of ns) {
      await this.pessoal.registrarPagamento(tenantId, {
        pessoaTipo: n.pessoaTipo as 'MEI' | 'MOTORISTA', pessoaId: n.pessoaId, competencia: n.competencia, pago: true, valorPago: n.valorCent / 100,
        ...(n.periodo !== 'MES' ? { periodo: n.periodo } : {}),
      });
      await this.avisar(tenantId, contas.get(n.pessoaId), {
        titulo: `Pagamento registrado · ${rotuloPeriodo(n.competencia, n.periodo)}`, corpo: `R$ ${reaisBr(n.valorCent)} pagos.`, url: '/notas', tag: `nota-paga-${n.id}`,
      });
    }
    return { pagas: ns.length };
  }

  // ───────────────────────── RH: acesso ─────────────────────────

  /**
   * Gera o link pessoal de cada prestador (vale 7 dias; um novo invalida o
   * anterior). Volta a mensagem pronta e o link do WhatsApp; com e-mail
   * cadastrado e porEmail, manda também por e-mail.
   */
  async convidar(tenantId: string, prestadorIds: string[], porEmail = false) {
    if (!prestadorIds.length) throw new BadRequestException('Escolha os prestadores.');
    const emp = await this.empresaDo(tenantId);
    const nomeEmpresa = emp.razao.replace(/\s+(LTDA|S\/?A|EIRELI|ME|EPP)\.?$/i, '').trim() || emp.razao;
    const ps = await comTenant(this.db, tenantId, (tx) => tx.select().from(pessoalPrestador)
      .where(and(eq(pessoalPrestador.tenantId, tenantId), inArray(pessoalPrestador.id, prestadorIds))));
    const saida = [];
    for (const p of ps) {
      const doc = p.documento ?? '';
      if (doc.length !== 11 && doc.length !== 14) {
        saida.push({ prestadorId: p.id, nome: p.nome, erro: 'Cadastre o CPF/CNPJ dele antes (é o usuário de login).' });
        continue;
      }
      const codigo = gerarCodigo(randomBytes);
      const expiraEm = new Date(Date.now() + 7 * DIA_MS);
      await comTenant(this.db, tenantId, async (tx) => {
        await tx.delete(prestadorConvite).where(and(eq(prestadorConvite.tenantId, tenantId), eq(prestadorConvite.prestadorId, p.id), isNull(prestadorConvite.usadoEm)));
        await tx.insert(prestadorConvite).values({ tenantId, prestadorId: p.id, codigo, expiraEm });
      });
      const link = `${urlWeb()}/c/${codigo}`;
      const mensagem = mensagemConvite(p.nome, nomeEmpresa, link, doc.length === 14 ? 'CNPJ' : 'CPF');
      let emailEnviado = false;
      if (porEmail && p.email) {
        const { assunto, html } = emailConvitePrestador(p.nome.split(/\s+/)[0] ?? p.nome, nomeEmpresa, link);
        emailEnviado = await this.email.enviar({ para: p.email, assunto, html }).catch(() => false);
      }
      saida.push({ prestadorId: p.id, nome: p.nome, telefone: p.telefone, email: p.email, codigo, link, mensagem,
        whatsapp: linkWhatsapp(p.telefone, mensagem), emailEnviado, expiraEm: expiraEm.toISOString() });
    }
    return saida;
  }

  /** Corta (ou devolve) o acesso de um prestador ao app. */
  async definirAcesso(tenantId: string, prestadorId: string, ativo: boolean) {
    const r = await comTenant(this.db, tenantId, (tx) => tx.update(usuario).set({ ativo })
      .where(and(eq(usuario.tenantId, tenantId), eq(usuario.prestadorId, prestadorId), eq(usuario.perfil, 'PRESTADOR'))).returning({ id: usuario.id }));
    if (!r.length) throw new NotFoundException('Este prestador ainda não tem acesso.');
    return { ativo };
  }

  /** Contato, documento e tomador. Mudou o CPF/CNPJ: o login acompanha. */
  async salvarContato(tenantId: string, id: string, d: { telefone?: string | null; email?: string | null; documento?: string | null; tomadorNome?: string | null; tomadorCnpj?: string | null }) {
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) throw new BadRequestException('E-mail inválido.');
    const doc = d.documento === undefined ? undefined : d.documento?.replace(/\D/g, '') || null;
    if (doc && doc.length !== 11 && doc.length !== 14) throw new BadRequestException('CPF/CNPJ inválido.');
    const r = await this.pessoal.editarPrestador(tenantId, id, d);
    if (doc) await comTenant(this.db, tenantId, (tx) => tx.update(usuario).set({ documento: doc })
      .where(and(eq(usuario.tenantId, tenantId), eq(usuario.prestadorId, id))));
    return r;
  }

  /** Todas as notas (arquivos) da competência num ZIP, para o contador. */
  async zip(tenantId: string, competencia: string, ids?: string[]) {
    this.validarComp(competencia);
    const r = await comTenant(this.db, tenantId, async (tx) => ({
      arqs: await tx.select({ id: pessoalNfArquivo.id, pessoaId: pessoalNfArquivo.pessoaId, periodo: pessoalNfArquivo.periodo, nome: pessoalNfArquivo.arquivoNome, tipo: pessoalNfArquivo.pessoaTipo })
        .from(pessoalNfArquivo).where(and(eq(pessoalNfArquivo.tenantId, tenantId), eq(pessoalNfArquivo.competencia, competencia),
          ...(ids?.length ? [inArray(pessoalNfArquivo.pessoaId, ids)] : []))),
      prest: await tx.select({ id: pessoalPrestador.id, nome: pessoalPrestador.nome }).from(pessoalPrestador).where(eq(pessoalPrestador.tenantId, tenantId)),
      lancs: await tx.select({ p: pessoalLancamento.pessoaId, per: pessoalLancamento.periodo, nf: pessoalLancamento.nfNumero }).from(pessoalLancamento)
        .where(and(eq(pessoalLancamento.tenantId, tenantId), eq(pessoalLancamento.competencia, competencia))),
    }));
    if (!r.arqs.length) throw new NotFoundException('Nenhuma nota com arquivo neste mês.');
    const zip = new JSZip();
    const nomes = new Map(r.prest.map((p) => [p.id, p.nome]));
    const limpar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w .-]/g, '').trim();
    for (const a of r.arqs) {
      const f = await this.pessoal.baixarNf(tenantId, a.id);
      const ext = (a.nome.match(/\.[a-z0-9]{2,4}$/i)?.[0] ?? '').toLowerCase();
      const nf = r.lancs.find((l) => l.p === a.pessoaId && l.per === a.periodo)?.nf;
      const pasta = a.tipo === 'MOTORISTA' ? 'Motoristas' : 'MEI';
      const base = `${limpar(nomes.get(a.pessoaId) ?? 'prestador')}${a.periodo !== 'MES' ? ` - semana ${a.periodo}` : ''}${nf ? ` - NF ${limpar(nf)}` : ''}`;
      zip.file(`${pasta}/${base}${ext}`, f.bytes);
    }
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    return { buffer, nomeArquivo: `notas_${competencia}.zip`, arquivos: r.arqs.length };
  }

  // ───────────────────────── rotina diária ─────────────────────────

  /**
   * Lembrete automático: a partir das 9h (fuso da empresa), uma vez por dia,
   * para quem tem nota liberada e ainda não mandou (ou foi recusada). Começa
   * no dia seguinte à liberação e para 7 dias depois do prazo.
   */
  async rotina(agora = new Date()) {
    const candidatas = await comoMaster(this.db, (tx) => tx.select({ n: pessoalNota, fuso: tenant.fuso, uid: usuario.id })
      .from(pessoalNota)
      .innerJoin(tenant, eq(tenant.id, pessoalNota.tenantId))
      .innerJoin(usuario, and(eq(usuario.prestadorId, pessoalNota.pessoaId), eq(usuario.ativo, true), eq(usuario.perfil, 'PRESTADOR')))
      .where(inArray(pessoalNota.status, ['AGUARDANDO', 'RECUSADA'])));
    let lembretes = 0;
    for (const { n, fuso, uid } of candidatas) {
      const { hoje, hora } = agoraLocal(fuso, agora);
      if (hora < 9) continue;
      const diaLib = agoraLocal(fuso, n.liberadoEm).hoje;
      if (diaLib >= hoje) continue;
      if (n.lembreteEm && agoraLocal(fuso, n.lembreteEm).hoje >= hoje) continue;
      if (n.confirmacao === 'CONTESTOU' && !n.resposta) continue;
      if (n.prazo) {
        const limite = new Date(`${n.prazo}T12:00:00Z`); limite.setUTCDate(limite.getUTCDate() + 7);
        if (hoje > limite.toISOString().slice(0, 10)) continue;
      }
      // Grava antes de mandar: com mais de uma instância, só uma leva o dia.
      const marcou = await comTenant(this.db, n.tenantId, (tx) => tx.update(pessoalNota).set({ lembreteEm: agora, lembretes: n.lembretes + 1 })
        .where(and(eq(pessoalNota.id, n.id), n.lembreteEm ? eq(pessoalNota.lembreteEm, n.lembreteEm) : isNull(pessoalNota.lembreteEm))).returning({ id: pessoalNota.id }));
      if (!marcou.length) continue;
      await this.avisar(n.tenantId, uid, this.textoLembrete(n, `nota-lembrete-${n.id}-${hoje}`));
      lembretes++;
    }
    return { lembretes };
  }
}
