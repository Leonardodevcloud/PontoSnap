import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { and, desc, eq, inArray, lt, or, isNull } from 'drizzle-orm';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import JSZip from 'jszip';
import {
  assinaturaDocumento, assinaturaUpload, comTenant, comoMaster, empregado, integracaoAutentique, pessoalFechamento, usuario, type Db,
} from '@ponto/db';
import { DB } from '../database/database.module';
import { CriptoService } from '../common/cripto.service';
import { TratamentoService } from '../tratamento/tratamento.service';
import { PushService } from '../notificacao/push.service';
import { textosDoPdf } from '../portal/pdf-texto';
import { AutentiqueHttp, ErroAutentique, type AutentiqueApi, type SignatarioAutentique } from './autentique.client';

/** Fábrica do cliente da Autentique (os testes trocam por uma falsa). */
export const AUTENTIQUE_FABRICA = 'AUTENTIQUE_FABRICA';
export type FabricaAutentique = (token: string) => AutentiqueApi;

type Tipo = 'ESPELHO' | 'CONTRACHEQUE';
type Status = 'RASCUNHO' | 'ENVIADO' | 'VISUALIZADO' | 'ASSINADO' | 'RECUSADO' | 'CANCELADO' | 'ERRO';
type Doc = typeof assinaturaDocumento.$inferSelect;
type Como = 'CPF' | 'NOME' | 'CPF_PDF' | 'NOME_PDF';

const COMP_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX = 10 * 1024 * 1024;
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const nomeMes = (c: string) => `${MESES[Number(c.slice(5, 7)) - 1]}/${c.slice(0, 4)}`;
const ultimoDia = (c: string) => { const [a, m] = c.split('-').map(Number) as [number, number]; return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); };
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const PENDENTES: Status[] = ['ENVIADO', 'VISUALIZADO'];
const urlApi = () => (process.env.API_PUBLIC_URL ?? process.env.API_URL ?? 'https://api.pontosnap.app.br').replace(/\/$/, '');

/** Telefone do cadastro → +55DDDNUMERO (ou null). */
export function telefoneE164(t: string | null | undefined): string | null {
  const d = (t ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) return `+55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return `+${d}`;
  return null;
}
/** E-mail que serve para receber (descarta os gerados pelo sistema). */
export function emailValido(e: string | null | undefined): string | null {
  const x = (e ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(x) || /@portal\.pontosnap|@local\b|\.local$/.test(x)) return null;
  return x;
}

/**
 * De quem é este contracheque? CPF no nome do arquivo, nome no arquivo, CPF
 * dentro do PDF, nome dentro do PDF — nessa ordem. Nunca chuta: com dúvida
 * (dois candidatos), volta null e o RH escolhe.
 */
export function identificarContracheque(nomeArquivo: string, textoPdf: string, emps: { id: string; nome: string; cpf: string }[]): { empregadoId: string; como: Como } | null {
  const porCpf = (txt: string) => {
    const achados = new Set([...txt.matchAll(/(?<!\d)(\d{3})\.?(\d{3})\.?(\d{3})-?(\d{2})(?!\d)/g)].map((m) => m.slice(1).join('')));
    const hits = emps.filter((e) => achados.has(e.cpf));
    return hits.length === 1 ? hits[0]! : null;
  };
  const porNome = (txt: string, exigeCompleto: boolean) => {
    const t = ` ${semAcento(txt).replace(/[^a-z0-9]+/g, ' ')} `;
    const hits = emps.filter((e) => {
      const partes = semAcento(e.nome).split(/\s+/).filter((p) => p.length > 1);
      if (partes.length < 2) return false;
      if (exigeCompleto) return t.includes(` ${partes.join(' ')} `);
      return t.includes(` ${partes[0]} `) && t.includes(` ${partes[partes.length - 1]} `);
    });
    return hits.length === 1 ? hits[0]! : null;
  };
  const a = porCpf(nomeArquivo); if (a) return { empregadoId: a.id, como: 'CPF' };
  const b = porNome(nomeArquivo.replace(/\.[a-z0-9]+$/i, ''), false); if (b) return { empregadoId: b.id, como: 'NOME' };
  const c = porCpf(textoPdf); if (c) return { empregadoId: c.id, como: 'CPF_PDF' };
  const d = porNome(textoPdf, true); if (d) return { empregadoId: d.id, como: 'NOME_PDF' };
  return null;
}

/** Acha ids de documento num payload de webhook (o formato varia por evento). */
export function idsDeDocumento(p: unknown): string[] {
  const ids = new Set<string>();
  const visitar = (o: unknown, depth: number) => {
    if (!o || typeof o !== 'object' || depth > 8) return;
    const x = o as Record<string, unknown>;
    if (x.object === 'document' && typeof x.id === 'string') ids.add(x.id);
    if (x.document && typeof x.document === 'object' && typeof (x.document as { id?: unknown }).id === 'string') ids.add((x.document as { id: string }).id);
    if (typeof x.document_id === 'string') ids.add(x.document_id);
    for (const v of Object.values(x)) visitar(v, depth + 1);
  };
  visitar(p, 0);
  return [...ids];
}

/**
 * Assinatura eletrônica (Autentique) do espelho de ponto e do contracheque.
 * O espelho é gerado pelo sistema quando a Folha do mês fecha; o contracheque
 * vem da contabilidade (PDF). Cada arquivo vira um documento na Autentique com
 * o funcionário como signatário; o status volta pelo webhook (e por uma
 * conferência periódica, se o webhook falhar).
 */
@Injectable()
export class AssinaturaService {
  private readonly log = new Logger(AssinaturaService.name);
  /** Pausa entre chamadas (a API aceita 60 por minuto). Os testes zeram. */
  pausaMs = 1100;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly cripto: CriptoService,
    private readonly trat: TratamentoService,
    private readonly push: PushService,
    @Optional() @Inject(AUTENTIQUE_FABRICA) private readonly fabrica?: FabricaAutentique,
  ) {}

  private cliente(tokenCifrado: string): AutentiqueApi {
    const token = this.cripto.decifrar(tokenCifrado);
    return this.fabrica ? this.fabrica(token) : new AutentiqueHttp(token);
  }
  private validarComp(c: string) { if (!COMP_RE.test(c ?? '')) throw new BadRequestException('Competência inválida (use YYYY-MM).'); }
  private dormir() { return this.pausaMs > 0 ? new Promise((r) => setTimeout(r, this.pausaMs)) : Promise.resolve(); }

  private async integracao(tenantId: string) {
    return (await comTenant(this.db, tenantId, (tx) => tx.select().from(integracaoAutentique).where(eq(integracaoAutentique.tenantId, tenantId)).limit(1)))[0] ?? null;
  }
  private async exigirIntegracao(tenantId: string) {
    const i = await this.integracao(tenantId);
    if (!i) throw new BadRequestException('Conecte a Autentique em Configurações › Integrações antes de enviar.');
    return i;
  }

  // ───────────────────────── configuração ─────────────────────────

  async config(tenantId: string) {
    const i = await this.integracao(tenantId);
    return {
      conectado: !!i, contaNome: i?.contaNome ?? null, contaEmail: i?.contaEmail ?? null,
      sandbox: i?.sandbox ?? true, mostrarApp: i?.mostrarApp ?? true, temSegredo: !!i?.webhookSegredo,
      webhookUrl: i ? `${urlApi()}/integracoes/autentique/retorno/${i.webhookToken}` : null,
    };
  }

  /** Conecta/atualiza. Com token novo, valida na Autentique antes de gravar. */
  async salvarConfig(tenantId: string, d: { token?: string | null; sandbox?: boolean; mostrarApp?: boolean; webhookSegredo?: string | null }) {
    const atual = await this.integracao(tenantId);
    const set: Partial<typeof integracaoAutentique.$inferInsert> = { atualizadoEm: new Date() };
    if (d.token?.trim()) {
      const token = d.token.trim();
      let conta;
      try { conta = await (this.fabrica ? this.fabrica(token) : new AutentiqueHttp(token)).conta(); }
      catch (e) { throw new BadRequestException(e instanceof ErroAutentique ? e.message : 'Não consegui validar o token na Autentique.'); }
      set.token = this.cripto.cifrar(token); set.contaNome = conta.nome; set.contaEmail = conta.email;
    } else if (!atual) throw new BadRequestException('Cole o token da API da Autentique.');
    if (d.sandbox !== undefined) set.sandbox = d.sandbox;
    if (d.mostrarApp !== undefined) set.mostrarApp = d.mostrarApp;
    if (d.webhookSegredo !== undefined) set.webhookSegredo = d.webhookSegredo?.trim() ? this.cripto.cifrar(d.webhookSegredo.trim()) : null;
    await comTenant(this.db, tenantId, async (tx) => {
      if (atual) await tx.update(integracaoAutentique).set(set).where(eq(integracaoAutentique.tenantId, tenantId));
      else await tx.insert(integracaoAutentique).values({ tenantId, token: set.token!, contaNome: set.contaNome, contaEmail: set.contaEmail,
        sandbox: set.sandbox ?? true, mostrarApp: set.mostrarApp ?? true, webhookSegredo: set.webhookSegredo ?? null, webhookToken: randomBytes(18).toString('hex') });
    });
    return this.config(tenantId);
  }

  async testar(tenantId: string) {
    const i = await this.exigirIntegracao(tenantId);
    try { return { ok: true, ...(await this.cliente(i.token).conta()) }; }
    catch (e) { return { ok: false, erro: (e as Error).message }; }
  }

  async desconectar(tenantId: string) {
    await comTenant(this.db, tenantId, (tx) => tx.delete(integracaoAutentique).where(eq(integracaoAutentique.tenantId, tenantId)));
    return { desconectado: true };
  }

  // ───────────────────────── painel do mês ─────────────────────────

  private visao(d: Doc) {
    return {
      id: d.id, tipo: d.tipo as Tipo, status: d.status as Status, arquivoNome: d.arquivoNome, arquivoBytes: d.arquivoBytes,
      canal: d.canal, sandbox: d.sandbox, lembrete: d.lembrete, prazo: d.prazo,
      enviadoEm: d.enviadoEm?.toISOString() ?? null, enviadoPor: d.enviadoPor, visualizadoEm: d.visualizadoEm?.toISOString() ?? null,
      assinadoEm: d.assinadoEm?.toISOString() ?? null, recusadoEm: d.recusadoEm?.toISOString() ?? null, motivoRecusa: d.motivoRecusa, erro: d.erro,
      temAssinado: !!d.arquivoAssinado, criadoEm: d.criadoEm.toISOString(),
    };
  }

  private async contatos(tx: Parameters<Parameters<typeof comTenant>[2]>[0], tenantId: string, ids: string[]) {
    if (!ids.length) return new Map<string, { usuarioId: string; email: string | null }>();
    const us = await tx.select({ id: usuario.id, e: usuario.empregadoId, email: usuario.email, ativo: usuario.ativo }).from(usuario)
      .where(and(eq(usuario.tenantId, tenantId), inArray(usuario.empregadoId, ids)));
    return new Map(us.filter((u) => u.ativo && u.e).map((u) => [u.e!, { usuarioId: u.id, email: emailValido(u.email) }]));
  }

  async painel(tenantId: string, comp: string) {
    this.validarComp(comp);
    const fim = ultimoDia(comp);
    const r = await comTenant(this.db, tenantId, async (tx) => {
      const docs = await tx.select().from(assinaturaDocumento).where(and(eq(assinaturaDocumento.tenantId, tenantId), eq(assinaturaDocumento.competencia, comp)));
      const comDoc = new Set(docs.map((d) => d.empregadoId));
      const emps = (await tx.select({ id: empregado.id, nome: empregado.nome, cpf: empregado.cpf, ativo: empregado.ativo, inicio: empregado.dataInicioPonto,
        celular: empregado.celular, email: empregado.emailPessoal, matricula: empregado.matricula }).from(empregado).where(eq(empregado.tenantId, tenantId)))
        .filter((e) => comDoc.has(e.id) || (e.ativo && (!e.inicio || e.inicio <= fim)));
      const fech = (await tx.select({ em: pessoalFechamento.fechadoEm }).from(pessoalFechamento)
        .where(and(eq(pessoalFechamento.tenantId, tenantId), eq(pessoalFechamento.competencia, comp))).limit(1))[0];
      const contas = await this.contatos(tx, tenantId, emps.map((e) => e.id));
      const uploads = await tx.select({ id: assinaturaUpload.id }).from(assinaturaUpload)
        .where(and(eq(assinaturaUpload.tenantId, tenantId), eq(assinaturaUpload.competencia, comp)));
      return { docs, emps, fech, contas, uploads: uploads.length };
    });
    const integ = await this.integracao(tenantId);
    const linhas = r.emps.map((e) => {
      const conta = r.contas.get(e.id);
      const email = emailValido(e.email) ?? conta?.email ?? null;
      const tel = telefoneE164(e.celular);
      const doc = (t: Tipo) => { const d = r.docs.find((x) => x.empregadoId === e.id && x.tipo === t); return d ? this.visao(d) : null; };
      return {
        empregadoId: e.id, nome: e.nome, matricula: e.matricula, email, telefone: tel, temApp: !!conta,
        canal: (email ? 'EMAIL' : tel ? 'WHATSAPP' : 'APP') as 'EMAIL' | 'WHATSAPP' | 'APP',
        espelho: doc('ESPELHO'), contracheque: doc('CONTRACHEQUE'),
      };
    }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const pronto = (l: (typeof linhas)[number]) => !!r.fech && (!l.espelho || ['RASCUNHO', 'ERRO', 'CANCELADO', 'RECUSADO'].includes(l.espelho.status))
      && !!l.contracheque && ['RASCUNHO', 'ERRO', 'RECUSADO'].includes(l.contracheque.status);
    const docs = linhas.flatMap((l) => [l.espelho, l.contracheque]).filter((d): d is NonNullable<typeof d> => !!d);
    return {
      competencia: comp, rotulo: nomeMes(comp), espelhoPronto: !!r.fech, fechadoEm: r.fech?.em.toISOString() ?? null,
      integracao: { conectado: !!integ, sandbox: integ?.sandbox ?? true, mostrarApp: integ?.mostrarApp ?? true },
      uploadsPendentes: r.uploads,
      totais: {
        pessoas: linhas.length,
        prontos: linhas.filter(pronto).length,
        faltaContracheque: linhas.filter((l) => !l.contracheque || l.contracheque.status === 'CANCELADO').length,
        enviados: docs.filter((d) => ['ENVIADO', 'VISUALIZADO', 'ASSINADO', 'RECUSADO'].includes(d.status)).length,
        visualizados: docs.filter((d) => d.status === 'VISUALIZADO').length,
        assinados: docs.filter((d) => d.status === 'ASSINADO').length,
        recusados: docs.filter((d) => d.status === 'RECUSADO').length,
        erros: docs.filter((d) => d.status === 'ERRO').length,
        semEmail: linhas.filter((l) => l.canal !== 'EMAIL').length,
      },
      linhas: linhas.map((l) => ({ ...l, pronto: pronto(l) })),
    };
  }

  // ───────────────────────── contracheque ─────────────────────────

  private lerPdf(base64: string) {
    const b = Buffer.from(base64 ?? '', 'base64');
    if (!b.length) throw new BadRequestException('Arquivo vazio.');
    if (b.length > MAX) throw new BadRequestException('Arquivo maior que 10 MB.');
    if (b.subarray(0, 5).toString('latin1') !== '%PDF-') throw new BadRequestException('Envie o contracheque em PDF.');
    return b;
  }

  /** Grava (ou troca) o contracheque de um funcionário no mês. Já enviado e não assinado: cancela o envio anterior. */
  async salvarContracheque(tenantId: string, d: { competencia: string; empregadoId: string; arquivoBase64?: string; bytes?: Buffer; arquivoNome: string }) {
    this.validarComp(d.competencia);
    const b = d.bytes ?? this.lerPdf(d.arquivoBase64 ?? '');
    const atual = await comTenant(this.db, tenantId, async (tx) => {
      const e = (await tx.select({ id: empregado.id }).from(empregado).where(and(eq(empregado.tenantId, tenantId), eq(empregado.id, d.empregadoId))).limit(1))[0];
      if (!e) throw new NotFoundException('Funcionário não encontrado.');
      return (await tx.select().from(assinaturaDocumento).where(and(eq(assinaturaDocumento.tenantId, tenantId), eq(assinaturaDocumento.empregadoId, d.empregadoId),
        eq(assinaturaDocumento.competencia, d.competencia), eq(assinaturaDocumento.tipo, 'CONTRACHEQUE'))).limit(1))[0];
    });
    if (atual?.status === 'ASSINADO') throw new BadRequestException('O contracheque deste mês já foi assinado. Cancele-o antes de trocar.');
    if (atual?.autentiqueId && PENDENTES.includes(atual.status as Status)) await this.cancelarNaAutentique(tenantId, atual.autentiqueId);
    const novo = {
      status: 'RASCUNHO', arquivo: this.cripto.cifrarBytes(b), arquivoNome: d.arquivoNome.slice(0, 160), arquivoBytes: b.length, hashSha256: sha(b),
      autentiqueId: null, assinaturaPublicId: null, canal: null, enviadoEm: null, enviadoPor: null, visualizadoEm: null, assinadoEm: null,
      recusadoEm: null, motivoRecusa: null, erro: null, arquivoAssinado: null, sincronizadoEm: null, atualizadoEm: new Date(),
    };
    const [r] = await comTenant(this.db, tenantId, (tx) => tx.insert(assinaturaDocumento)
      .values({ tenantId, empregadoId: d.empregadoId, competencia: d.competencia, tipo: 'CONTRACHEQUE', ...novo })
      .onConflictDoUpdate({ target: [assinaturaDocumento.tenantId, assinaturaDocumento.empregadoId, assinaturaDocumento.competencia, assinaturaDocumento.tipo], set: novo })
      .returning());
    return this.visao(r!);
  }

  async removerContracheque(tenantId: string, id: string) {
    const d = await this.doc(tenantId, id);
    if (d.tipo !== 'CONTRACHEQUE' || !['RASCUNHO', 'ERRO', 'CANCELADO'].includes(d.status)) throw new BadRequestException('Só dá para remover contracheque ainda não enviado.');
    await comTenant(this.db, tenantId, (tx) => tx.delete(assinaturaDocumento).where(eq(assinaturaDocumento.id, id)));
    return { removido: true };
  }

  // ───────────────────────── lote ─────────────────────────

  /**
   * Recebe um PDF ou um ZIP de contracheques, guarda cada PDF como "pendente"
   * e sugere de quem é (CPF/nome no arquivo ou dentro do PDF). Nada vai para
   * o funcionário até o RH confirmar.
   */
  async subirLote(tenantId: string, d: { competencia: string; arquivoNome: string; arquivoBase64: string }) {
    this.validarComp(d.competencia);
    const b = Buffer.from(d.arquivoBase64 ?? '', 'base64');
    if (!b.length) throw new BadRequestException('Arquivo vazio.');
    if (b.length > MAX) throw new BadRequestException('Arquivo maior que 10 MB. Mande o ZIP em partes.');
    const pdfs: { nome: string; dados: Buffer }[] = [];
    if (b.subarray(0, 2).toString('latin1') === 'PK') {
      const zip = await JSZip.loadAsync(b).catch(() => { throw new BadRequestException('Não consegui abrir o ZIP.'); });
      for (const f of Object.values(zip.files)) {
        if (f.dir || !/\.pdf$/i.test(f.name) || /(^|\/)(__MACOSX|\.)/.test(f.name)) continue;
        const dados = await f.async('nodebuffer');
        if (dados.subarray(0, 5).toString('latin1') === '%PDF-' && dados.length <= MAX) pdfs.push({ nome: f.name.split('/').pop()!, dados });
      }
      if (!pdfs.length) throw new BadRequestException('O ZIP não tem nenhum PDF.');
    } else pdfs.push({ nome: d.arquivoNome, dados: this.lerPdf(d.arquivoBase64) });

    const emps = await comTenant(this.db, tenantId, (tx) => tx.select({ id: empregado.id, nome: empregado.nome, cpf: empregado.cpf }).from(empregado).where(eq(empregado.tenantId, tenantId)));
    const saida = [];
    for (const p of pdfs) {
      let texto = '';
      try { texto = (await textosDoPdf(p.dados, 2, 6000)).map((t) => t.str).join(' '); } catch { texto = ''; }
      const id = identificarContracheque(p.nome, texto, emps);
      const [r] = await comTenant(this.db, tenantId, (tx) => tx.insert(assinaturaUpload).values({
        tenantId, competencia: d.competencia, arquivo: this.cripto.cifrarBytes(p.dados), arquivoNome: p.nome.slice(0, 160), arquivoBytes: p.dados.length,
        sugestaoEmpregadoId: id?.empregadoId ?? null, como: id?.como ?? null,
      }).returning({ id: assinaturaUpload.id }));
      saida.push({ id: r!.id, arquivoNome: p.nome, arquivoBytes: p.dados.length, empregadoId: id?.empregadoId ?? null, como: id?.como ?? null });
    }
    return saida;
  }

  async uploadsPendentes(tenantId: string, comp: string) {
    this.validarComp(comp);
    const rows = await comTenant(this.db, tenantId, (tx) => tx.select({ id: assinaturaUpload.id, arquivoNome: assinaturaUpload.arquivoNome, arquivoBytes: assinaturaUpload.arquivoBytes,
      empregadoId: assinaturaUpload.sugestaoEmpregadoId, como: assinaturaUpload.como }).from(assinaturaUpload)
      .where(and(eq(assinaturaUpload.tenantId, tenantId), eq(assinaturaUpload.competencia, comp))).orderBy(assinaturaUpload.criadoEm));
    return rows;
  }

  /** Confirma o lote: cada item com funcionário vira o contracheque dele; os demais são descartados. */
  async confirmarLote(tenantId: string, comp: string, itens: { uploadId: string; empregadoId: string | null }[]) {
    this.validarComp(comp);
    const ups = await comTenant(this.db, tenantId, (tx) => tx.select().from(assinaturaUpload)
      .where(and(eq(assinaturaUpload.tenantId, tenantId), eq(assinaturaUpload.competencia, comp))));
    const escolhidos = itens.filter((i) => i.empregadoId);
    const repetido = escolhidos.find((i, k) => escolhidos.findIndex((x) => x.empregadoId === i.empregadoId) !== k);
    if (repetido) throw new BadRequestException('Dois arquivos para o mesmo funcionário. Deixe só um.');
    let salvos = 0;
    for (const i of escolhidos) {
      const u = ups.find((x) => x.id === i.uploadId);
      if (!u) continue;
      await this.salvarContracheque(tenantId, { competencia: comp, empregadoId: i.empregadoId!, bytes: this.cripto.decifrarBytes(u.arquivo), arquivoNome: u.arquivoNome });
      salvos++;
    }
    await comTenant(this.db, tenantId, (tx) => tx.delete(assinaturaUpload).where(and(eq(assinaturaUpload.tenantId, tenantId), eq(assinaturaUpload.competencia, comp))));
    return { salvos, descartados: ups.length - salvos };
  }

  async descartarLote(tenantId: string, comp: string) {
    await comTenant(this.db, tenantId, (tx) => tx.delete(assinaturaUpload).where(and(eq(assinaturaUpload.tenantId, tenantId), eq(assinaturaUpload.competencia, comp))));
    return { descartado: true };
  }

  // ───────────────────────── enviar ─────────────────────────

  /**
   * Manda para assinar: espelho (gerado agora, com o mês fechado) e
   * contracheque (o que foi subido). Já enviado e ainda válido não é
   * reenviado. Um a um, respeitando o limite da API.
   */
  async enviar(tenantId: string, d: {
    competencia: string; empregadoIds: string[]; canal?: 'AUTO' | 'APP'; mensagem?: string | null; lembrete?: 'DAILY' | 'WEEKLY' | null; prazo?: string | null;
  }, autor: string) {
    this.validarComp(d.competencia);
    if (!d.empregadoIds?.length) throw new BadRequestException('Escolha os funcionários.');
    if (d.prazo && !/^\d{4}-\d{2}-\d{2}$/.test(d.prazo)) throw new BadRequestException('Prazo inválido.');
    const integ = await this.exigirIntegracao(tenantId);
    const api = this.cliente(integ.token);
    const p = await this.painel(tenantId, d.competencia);
    const [a, m] = d.competencia.split('-');
    const inicio = `${a}-${m}-01`, fim = ultimoDia(d.competencia);
    const res = { enviados: 0, pulados: 0, erros: [] as { nome: string; tipo: Tipo; erro: string }[] };
    const avisar = new Map<string, string>();

    for (const empId of [...new Set(d.empregadoIds)]) {
      const l = p.linhas.find((x) => x.empregadoId === empId);
      if (!l) continue;
      const sig: SignatarioAutentique = d.canal === 'APP' || l.canal === 'APP'
        ? { nome: l.nome, canal: 'APP' } : l.canal === 'EMAIL' ? { nome: l.nome, canal: 'EMAIL', email: l.email } : { nome: l.nome, canal: 'WHATSAPP', telefone: l.telefone };
      const reenviavel = (s?: Status) => !s || ['RASCUNHO', 'ERRO', 'CANCELADO', 'RECUSADO'].includes(s);

      // Espelho: só com o mês fechado; gerado agora (é o retrato que a pessoa assina).
      if (p.espelhoPronto && reenviavel(l.espelho?.status)) {
        try {
          const pdf = await this.trat.gerarEspelhoPdf(tenantId, empId, inicio, fim);
          const doc = await this.gravarEspelho(tenantId, empId, d.competencia, pdf.buffer, pdf.nomeArquivo);
          await this.mandar(tenantId, api, doc, `Espelho de ponto · ${nomeMes(d.competencia)} · ${l.nome}`, pdf.buffer, sig, integ.sandbox, d, autor);
          res.enviados++; if (l.temApp) avisar.set(empId, l.nome);
        } catch (e) { res.erros.push({ nome: l.nome, tipo: 'ESPELHO', erro: (e as Error).message }); }
        await this.dormir();
      } else if (!p.espelhoPronto || l.espelho) res.pulados++;

      if (l.contracheque && reenviavel(l.contracheque.status) && l.contracheque.status !== 'CANCELADO') {
        try {
          const doc = await this.doc(tenantId, l.contracheque.id);
          const bytes = this.cripto.decifrarBytes(doc.arquivo);
          await this.mandar(tenantId, api, doc, `Contracheque · ${nomeMes(d.competencia)} · ${l.nome}`, bytes, sig, integ.sandbox, d, autor);
          res.enviados++; if (l.temApp) avisar.set(empId, l.nome);
        } catch (e) { res.erros.push({ nome: l.nome, tipo: 'CONTRACHEQUE', erro: (e as Error).message }); }
        await this.dormir();
      } else res.pulados++;
    }
    if (integ.mostrarApp) {
      const contas = await comTenant(this.db, tenantId, (tx) => this.contatos(tx, tenantId, [...avisar.keys()]));
      for (const [empId] of avisar) {
        const c = contas.get(empId);
        if (!c) continue;
        await this.push.enviarParaUsuario(tenantId, c.usuarioId, {
          titulo: 'Documentos para assinar', corpo: `Seu espelho de ponto e contracheque de ${nomeMes(d.competencia)} chegaram. Toque para assinar.`,
          url: '/documentos', tag: `assinar-${d.competencia}`,
        }).catch(() => 0);
      }
    }
    return res;
  }

  private async gravarEspelho(tenantId: string, empId: string, comp: string, pdf: Buffer, nome: string): Promise<Doc> {
    const v = { status: 'RASCUNHO', arquivo: this.cripto.cifrarBytes(pdf), arquivoNome: nome.slice(0, 160), arquivoBytes: pdf.length, hashSha256: sha(pdf),
      autentiqueId: null, assinaturaPublicId: null, enviadoEm: null, visualizadoEm: null, assinadoEm: null, recusadoEm: null, motivoRecusa: null, erro: null,
      arquivoAssinado: null, atualizadoEm: new Date() };
    const [r] = await comTenant(this.db, tenantId, (tx) => tx.insert(assinaturaDocumento)
      .values({ tenantId, empregadoId: empId, competencia: comp, tipo: 'ESPELHO', ...v })
      .onConflictDoUpdate({ target: [assinaturaDocumento.tenantId, assinaturaDocumento.empregadoId, assinaturaDocumento.competencia, assinaturaDocumento.tipo], set: v })
      .returning());
    return r!;
  }

  private async mandar(tenantId: string, api: AutentiqueApi, doc: Doc, nome: string, bytes: Buffer, sig: SignatarioAutentique, sandbox: boolean,
    o: { mensagem?: string | null; lembrete?: 'DAILY' | 'WEEKLY' | null; prazo?: string | null }, autor: string) {
    try {
      const r = await api.criarDocumento({
        nome, mensagem: o.mensagem ?? null, lembrete: sig.canal === 'APP' ? null : o.lembrete ?? null, prazo: o.prazo ?? null, sandbox, signatario: sig,
        arquivo: bytes, arquivoNome: `${nome.replace(/[^\w\s.-]+/g, '').replace(/\s+/g, '_').slice(0, 80)}.pdf`,
      });
      await comTenant(this.db, tenantId, (tx) => tx.update(assinaturaDocumento).set({
        status: 'ENVIADO', autentiqueId: r.id, assinaturaPublicId: r.publicId, canal: sig.canal, sandbox, lembrete: o.lembrete ?? null, prazo: o.prazo ?? null,
        enviadoEm: new Date(), enviadoPor: autor, erro: null, atualizadoEm: new Date(),
      }).where(eq(assinaturaDocumento.id, doc.id)));
    } catch (e) {
      await comTenant(this.db, tenantId, (tx) => tx.update(assinaturaDocumento).set({ status: 'ERRO', erro: (e as Error).message.slice(0, 500), atualizadoEm: new Date() })
        .where(eq(assinaturaDocumento.id, doc.id)));
      throw e;
    }
  }

  // ───────────────────────── acompanhar ─────────────────────────

  private async doc(tenantId: string, id: string): Promise<Doc> {
    const d = (await comTenant(this.db, tenantId, (tx) => tx.select().from(assinaturaDocumento)
      .where(and(eq(assinaturaDocumento.tenantId, tenantId), eq(assinaturaDocumento.id, id))).limit(1)))[0];
    if (!d) throw new NotFoundException('Documento não encontrado.');
    return d;
  }

  /** Atualiza o status pelos dados da Autentique (e baixa o assinado). */
  async sincronizar(tenantId: string, ids?: string[]) {
    const integ = await this.integracao(tenantId);
    if (!integ) return { atualizados: 0 };
    const api = this.cliente(integ.token);
    const docs = await comTenant(this.db, tenantId, (tx) => tx.select().from(assinaturaDocumento).where(and(
      eq(assinaturaDocumento.tenantId, tenantId), inArray(assinaturaDocumento.status, PENDENTES),
      ...(ids?.length ? [inArray(assinaturaDocumento.id, ids)] : []))).limit(60));
    let atualizados = 0;
    for (const d of docs) {
      if (!d.autentiqueId) continue;
      try {
        const s = await api.situacao(d.autentiqueId);
        const set: Partial<typeof assinaturaDocumento.$inferInsert> = { sincronizadoEm: new Date() };
        if (!s) { set.status = 'CANCELADO'; set.erro = 'Documento não existe mais na Autentique.'; }
        else if (s.recusadoEm) { set.status = 'RECUSADO'; set.recusadoEm = new Date(s.recusadoEm); set.motivoRecusa = s.motivoRecusa; }
        else if (s.assinadoEm) {
          set.status = 'ASSINADO'; set.assinadoEm = new Date(s.assinadoEm);
          if (s.visualizadoEm) set.visualizadoEm = new Date(s.visualizadoEm);
          if (s.arquivoAssinadoUrl) {
            try { set.arquivoAssinado = this.cripto.cifrarBytes(await api.baixar(s.arquivoAssinadoUrl)); }
            catch (e) { this.log.warn(`Assinado sem arquivo (${d.id}): ${(e as Error).message}`); }
          }
        } else if (s.visualizadoEm) { set.status = 'VISUALIZADO'; set.visualizadoEm = new Date(s.visualizadoEm); }
        if (set.status && set.status !== d.status) atualizados++;
        set.atualizadoEm = new Date();
        await comTenant(this.db, tenantId, (tx) => tx.update(assinaturaDocumento).set(set).where(eq(assinaturaDocumento.id, d.id)));
      } catch (e) { this.log.warn(`Sincronizar ${d.id}: ${(e as Error).message}`); }
      await this.dormir();
    }
    return { atualizados, conferidos: docs.length };
  }

  /** Webhook da Autentique: identifica a empresa pelo token da URL e confere os documentos citados. */
  async webhook(token: string, corpoBruto: Buffer | string, assinatura?: string) {
    const integ = (await comoMaster(this.db, (tx) => tx.select().from(integracaoAutentique).where(eq(integracaoAutentique.webhookToken, token)).limit(1)))[0];
    if (!integ) throw new NotFoundException();
    const bruto = Buffer.isBuffer(corpoBruto) ? corpoBruto : Buffer.from(corpoBruto ?? '');
    if (integ.webhookSegredo) {
      const esperado = createHmac('sha256', this.cripto.decifrar(integ.webhookSegredo)).update(bruto).digest('hex');
      const veio = (assinatura ?? '').replace(/^sha256=/, '');
      const ok = veio.length === esperado.length && timingSafeEqual(Buffer.from(veio), Buffer.from(esperado));
      if (!ok) throw new ForbiddenException('Assinatura do webhook inválida.');
    }
    let payload: unknown = null;
    try { payload = JSON.parse(bruto.toString('utf8')); } catch { return { ok: true, ignorado: 'corpo não é JSON' }; }
    const ids = idsDeDocumento(payload);
    if (!ids.length) return { ok: true, ignorado: 'sem documento' };
    const docs = await comTenant(this.db, integ.tenantId, (tx) => tx.select({ id: assinaturaDocumento.id }).from(assinaturaDocumento)
      .where(and(eq(assinaturaDocumento.tenantId, integ.tenantId), inArray(assinaturaDocumento.autentiqueId, ids))));
    if (!docs.length) return { ok: true, ignorado: 'documento de outro sistema' };
    const r = await this.sincronizar(integ.tenantId, docs.map((d) => d.id));
    return { ok: true, ...r };
  }

  /** Conferência periódica (se algum webhook se perder): pendentes não conferidos há 25 min. */
  async rotina() {
    const integs = await comoMaster(this.db, (tx) => tx.select({ t: integracaoAutentique.tenantId }).from(integracaoAutentique));
    const limite = new Date(Date.now() - 25 * 60_000);
    for (const { t } of integs) {
      const ids = (await comTenant(this.db, t, (tx) => tx.select({ id: assinaturaDocumento.id }).from(assinaturaDocumento).where(and(
        eq(assinaturaDocumento.tenantId, t), inArray(assinaturaDocumento.status, PENDENTES),
        or(isNull(assinaturaDocumento.sincronizadoEm), lt(assinaturaDocumento.sincronizadoEm, limite)))).limit(40))).map((x) => x.id);
      if (ids.length) await this.sincronizar(t, ids).catch((e) => this.log.warn(`Rotina ${t}: ${(e as Error).message}`));
    }
  }

  async lembrar(tenantId: string, ids: string[]) {
    const integ = await this.exigirIntegracao(tenantId);
    const docs = await comTenant(this.db, tenantId, (tx) => tx.select().from(assinaturaDocumento)
      .where(and(eq(assinaturaDocumento.tenantId, tenantId), inArray(assinaturaDocumento.id, ids), inArray(assinaturaDocumento.status, PENDENTES))));
    const pubs = docs.filter((d) => d.assinaturaPublicId && d.canal !== 'APP').map((d) => d.assinaturaPublicId!);
    if (!pubs.length) throw new BadRequestException('Nada para lembrar: os documentos já foram assinados ou vão só pelo app.');
    try { await this.cliente(integ.token).reenviar(pubs); }
    catch (e) { throw new BadRequestException((e as Error).message); }
    return { lembrados: pubs.length };
  }

  private async cancelarNaAutentique(tenantId: string, autentiqueId: string) {
    const integ = await this.integracao(tenantId);
    if (!integ) return;
    try { await this.cliente(integ.token).cancelar(autentiqueId); }
    catch (e) { this.log.warn(`Cancelar na Autentique falhou (${autentiqueId}): ${(e as Error).message}`); }
  }

  /** Cancela um envio (o documento sai da Autentique). Assinado não cancela. */
  async cancelar(tenantId: string, id: string) {
    const d = await this.doc(tenantId, id);
    if (d.status === 'ASSINADO') throw new BadRequestException('Documento já assinado não pode ser cancelado.');
    if (d.autentiqueId) await this.cancelarNaAutentique(tenantId, d.autentiqueId);
    await comTenant(this.db, tenantId, (tx) => tx.update(assinaturaDocumento).set({ status: d.tipo === 'CONTRACHEQUE' ? 'RASCUNHO' : 'CANCELADO',
      autentiqueId: null, assinaturaPublicId: null, enviadoEm: null, visualizadoEm: null, recusadoEm: null, motivoRecusa: null, erro: null, atualizadoEm: new Date() })
      .where(eq(assinaturaDocumento.id, id)));
    return { cancelado: true };
  }

  async arquivo(tenantId: string, id: string, assinado = false) {
    const d = await this.doc(tenantId, id);
    const blob = assinado && d.arquivoAssinado ? d.arquivoAssinado : d.arquivo;
    const nome = assinado && d.arquivoAssinado ? d.arquivoNome.replace(/(\.pdf)?$/i, '_assinado.pdf') : d.arquivoNome;
    return { buffer: this.cripto.decifrarBytes(blob), nome, mime: 'application/pdf' };
  }

  // ───────────────────────── funcionário (app) ─────────────────────────

  private async empregadoDe(tenantId: string, usuarioId: string) {
    const u = (await comTenant(this.db, tenantId, (tx) => tx.select({ e: usuario.empregadoId }).from(usuario).where(eq(usuario.id, usuarioId)).limit(1)))[0];
    if (!u?.e) throw new ForbiddenException('Este acesso não está ligado a um funcionário.');
    return u.e;
  }

  async meus(tenantId: string, usuarioId: string) {
    const emp = await this.empregadoDe(tenantId, usuarioId);
    const integ = await this.integracao(tenantId);
    if (integ && !integ.mostrarApp) return { documentos: [], pendentes: 0 };
    const docs = await comTenant(this.db, tenantId, (tx) => tx.select().from(assinaturaDocumento).where(and(
      eq(assinaturaDocumento.tenantId, tenantId), eq(assinaturaDocumento.empregadoId, emp),
      inArray(assinaturaDocumento.status, ['ENVIADO', 'VISUALIZADO', 'ASSINADO', 'RECUSADO']))).orderBy(desc(assinaturaDocumento.competencia), assinaturaDocumento.tipo));
    const documentos = docs.map((d) => ({ ...this.visao(d), competencia: d.competencia, rotulo: nomeMes(d.competencia) }));
    return { documentos, pendentes: documentos.filter((d) => PENDENTES.includes(d.status)).length };
  }

  /** Link de assinatura para o próprio funcionário (abre a Autentique). */
  async linkMeu(tenantId: string, usuarioId: string, id: string) {
    const emp = await this.empregadoDe(tenantId, usuarioId);
    const d = await this.doc(tenantId, id);
    if (d.empregadoId !== emp) throw new ForbiddenException();
    if (!PENDENTES.includes(d.status as Status) || !d.assinaturaPublicId) throw new BadRequestException('Este documento não está esperando assinatura.');
    const integ = await this.exigirIntegracao(tenantId);
    try { return { link: await this.cliente(integ.token).linkAssinatura(d.assinaturaPublicId) }; }
    catch (e) { throw new BadRequestException((e as Error).message); }
  }

  async arquivoMeu(tenantId: string, usuarioId: string, id: string) {
    const emp = await this.empregadoDe(tenantId, usuarioId);
    const d = await this.doc(tenantId, id);
    if (d.empregadoId !== emp || d.status === 'RASCUNHO' || d.status === 'CANCELADO') throw new ForbiddenException();
    return this.arquivo(tenantId, id, d.status === 'ASSINADO');
  }

  /** O funcionário acabou de assinar pelo link: confere na hora (sem esperar o webhook). */
  async conferirMeu(tenantId: string, usuarioId: string, id: string) {
    const emp = await this.empregadoDe(tenantId, usuarioId);
    const d = await this.doc(tenantId, id);
    if (d.empregadoId !== emp) throw new ForbiddenException();
    await this.sincronizar(tenantId, [id]);
    return this.visao(await this.doc(tenantId, id));
  }
}
