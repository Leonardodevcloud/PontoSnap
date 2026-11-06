import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { pontoHolerite, empregado, usuario, usuarioTenant, tenant, comTenant, comoMaster, type Db } from '@ponto/db';
import { DB } from '../database/database.module';
import { CriptoService } from '../common/cripto.service';
import { PushService } from '../notificacao/push.service';
import { AssinaturaService } from '../assinatura/assinatura.service';
import { lerHolerites, recortar, normalizarNome } from './holerite-pdf';

/** 11 MB cobre um PDF de centenas de holerites e cabe no limite de body (16mb) já em base64. */
const LIMITE_BYTES = 11 * 1024 * 1024;

export type StatusMatch = 'CPF' | 'NOME' | 'NAO_ENCONTRADO';

export interface BlocoPrevia {
  paginas: number[];
  cpf: string | null;
  nomePdf: string | null;
  liquidoCentavos: number | null;
  brutoCentavos: number | null;
  status: StatusMatch;
  empregadoId?: string;
  tenantId?: string;
  nomeCadastro?: string;
  empresa?: string;
}

/** Campos sem o arquivo — nunca traga o bytea numa listagem. */
const CAMPOS = {
  id: pontoHolerite.id, empregadoId: pontoHolerite.empregadoId, competencia: pontoHolerite.competencia,
  arquivoNome: pontoHolerite.arquivoNome, arquivoBytes: pontoHolerite.arquivoBytes,
  liquidoCentavos: pontoHolerite.liquidoCentavos, brutoCentavos: pontoHolerite.brutoCentavos,
  pagoEm: pontoHolerite.pagoEm, valorPagoCentavos: pontoHolerite.valorPagoCentavos,
  enviadoEm: pontoHolerite.enviadoEm,
};

@Injectable()
export class HoleriteService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly cripto: CriptoService,
    private readonly push: PushService,
    private readonly assinaturas: AssinaturaService,
  ) {}

  async empregadoDoUsuario(usuarioId: string, tenantId: string): Promise<string> {
    return comTenant(this.db, tenantId, async (tx) => {
      const u = (await tx.select().from(usuario).where(eq(usuario.id, usuarioId)).limit(1))[0];
      if (!u?.empregadoId) throw new BadRequestException('Usuário não vinculado a um empregado');
      return u.empregadoId;
    });
  }

  /** Empresas que o usuário acessa (padrão + vínculos multi-empresa). */
  private async tenantsDoUsuario(usuarioId: string, tenantAtual: string): Promise<string[]> {
    const vincs = await comoMaster(this.db, (tx) =>
      tx.select({ t: usuarioTenant.tenantId }).from(usuarioTenant).where(eq(usuarioTenant.usuarioId, usuarioId)));
    return [...new Set([tenantAtual, ...vincs.map((v) => v.t)])];
  }

  private pdfDoBase64(base64: string): Buffer {
    const buf = Buffer.from(base64, 'base64');
    if (buf.length === 0) throw new BadRequestException('Arquivo vazio');
    if (buf.length > LIMITE_BYTES) throw new BadRequestException('PDF maior que 25 MB.');
    if (buf.subarray(0, 4).toString('latin1') !== '%PDF') throw new BadRequestException('Envie um arquivo PDF.');
    return buf;
  }

  /**
   * Lê o PDF da contabilidade, recorta por pessoa e casa cada um com o
   * funcionário (CPF primeiro, nas empresas do grupo; nome como reserva).
   * NÃO salva nada — devolve a prévia para a tela de conferência.
   */
  async importar(tenantAtual: string, usuarioId: string, arquivoBase64: string) {
    const buf = this.pdfDoBase64(arquivoBase64);
    const { competencia, totalPaginas, blocos } = await lerHolerites(buf);

    const tenantIds = await this.tenantsDoUsuario(usuarioId, tenantAtual);
    const todos = await comoMaster(this.db, (tx) =>
      tx.select({ id: empregado.id, tenantId: empregado.tenantId, nome: empregado.nome, cpf: empregado.cpf, razao: tenant.razaoSocial,
        ativo: empregado.ativo, inicio: empregado.dataInicioPonto, saida: empregado.dataSaida })
        .from(empregado).innerJoin(tenant, eq(tenant.id, empregado.tenantId))
        .where(inArray(empregado.tenantId, tenantIds)));
    // Transferência entre CNPJs: o mesmo CPF tem um vínculo em cada empresa.
    // O contracheque vai para o vínculo que cobre a competência dele (o de
    // outubro fica na origem mesmo depois de a pessoa ir para o destino).
    const ini = competencia ? `${competencia}-01` : null;
    const fim = competencia ? `${competencia}-31` : null;
    const cobre = (e: typeof todos[number]) => ini && fim
      ? (!e.inicio || e.inicio <= fim) && (e.ativo ? !e.saida || e.saida > ini : !!e.saida && e.saida > ini)
      : e.ativo;
    const empregados = todos.filter(cobre);
    const porCpf = new Map<string, typeof empregados[number]>();
    for (const e of empregados) {
      const ja = porCpf.get(e.cpf);
      // Dois vínculos no mês (saiu no meio dele): fica o da empresa atual; senão, o de origem.
      if (!ja || e.tenantId === tenantAtual || (ja.tenantId !== tenantAtual && !e.ativo)) porCpf.set(e.cpf, e);
    }
    const usados = new Set<string>();

    const itens: BlocoPrevia[] = blocos.map((b): BlocoPrevia => {
      let alvo: typeof empregados[number] | undefined;
      let status: StatusMatch = 'NAO_ENCONTRADO';
      if (b.cpf && porCpf.has(b.cpf)) { alvo = porCpf.get(b.cpf); status = 'CPF'; }
      else if (b.nome) {
        const n = normalizarNome(b.nome);
        const cand = empregados.filter((e) => {
          const en = normalizarNome(e.nome);
          return en === n || (n.split(' ').length >= 2 && en.split(' ').every((tk) => n.includes(tk)));
        });
        if (cand.length === 1) { alvo = cand[0]; status = 'NOME'; }
      }
      // evita mandar o mesmo holerite pra duas pessoas por engano de nome
      if (alvo && usados.has(alvo.id)) { alvo = undefined; status = 'NAO_ENCONTRADO'; }
      if (alvo) usados.add(alvo.id);
      return {
        paginas: b.paginas, cpf: b.cpf, nomePdf: b.nome, liquidoCentavos: b.liquidoCentavos, brutoCentavos: b.brutoCentavos, status,
        ...(alvo && { empregadoId: alvo.id, tenantId: alvo.tenantId, nomeCadastro: alvo.nome, empresa: alvo.razao }),
      };
    });

    // Quem da empresa atual ficou sem holerite neste arquivo (candidatos à atribuição manual).
    const semHolerite = empregados
      .filter((e) => e.tenantId === tenantAtual && !usados.has(e.id))
      .map((e) => ({ id: e.id, nome: e.nome, tenantId: e.tenantId }));

    return { competencia, totalPaginas, itens, semHolerite };
  }

  /**
   * Salva os holerites confirmados (recorta de novo do PDF original que a tela
   * reenvia) e avisa cada funcionário. Entrega dentro da empresa de cada um.
   */
  async confirmar(tenantAtual: string, usuarioId: string, p: {
    arquivoBase64: string; competencia: string;
    itens: Array<{ paginas: number[]; empregadoId: string; tenantId: string; liquidoCentavos?: number | null; brutoCentavos?: number | null }>;
  }) {
    if (!/^\d{4}-\d{2}$/.test(p.competencia)) throw new BadRequestException('Competência inválida (use AAAA-MM)');
    const buf = this.pdfDoBase64(p.arquivoBase64);
    const permitidos = new Set(await this.tenantsDoUsuario(usuarioId, tenantAtual));

    let enviados = 0;
    for (const item of p.itens) {
      if (!permitidos.has(item.tenantId)) throw new ForbiddenException('Empresa fora do seu acesso');
      if (!item.paginas?.length) continue;
      const bytes = await recortar(buf, item.paginas);
      const cifrado = this.cripto.cifrarBytes(bytes);

      await comoMaster(this.db, (tx) =>
        tx.insert(pontoHolerite).values({
          tenantId: item.tenantId, empregadoId: item.empregadoId, competencia: p.competencia,
          arquivo: cifrado, arquivoNome: `holerite-${p.competencia}.pdf`, arquivoBytes: bytes.length,
          liquidoCentavos: item.liquidoCentavos ?? null, brutoCentavos: item.brutoCentavos ?? null, enviadoPor: usuarioId,
        }).onConflictDoUpdate({
          target: [pontoHolerite.tenantId, pontoHolerite.empregadoId, pontoHolerite.competencia],
          set: {
            arquivo: cifrado, arquivoNome: `holerite-${p.competencia}.pdf`, arquivoBytes: bytes.length,
            liquidoCentavos: item.liquidoCentavos ?? null, brutoCentavos: item.brutoCentavos ?? null,
            // reimportar substitui o arquivo e zera o pagamento anterior (holerite trocou)
            pagoEm: null, pagoPor: null, valorPagoCentavos: null,
            enviadoEm: new Date(), enviadoPor: usuarioId,
          },
        }));
      enviados++;
      void this.avisar(item.tenantId, item.empregadoId, p.competencia);
      // Alimenta as Assinaturas (Autentique): o contracheque vira documento pra
      // assinar, sem subir o PDF de novo lá. Best-effort e sequencial — nunca
      // derruba a importação; pula quem já tem o contracheque assinado.
      await this.alimentarAssinatura(item.tenantId, item.empregadoId, p.competencia, bytes);
    }
    return { enviados };
  }

  /** Cria/atualiza o documento de contracheque nas Assinaturas. Best-effort. */
  private async alimentarAssinatura(tenantId: string, empregadoId: string, competencia: string, bytes: Buffer) {
    try {
      await this.assinaturas.salvarContracheque(tenantId, {
        competencia, empregadoId, bytes, arquivoNome: `contracheque-${competencia}.pdf`,
      });
    } catch {
      // já assinado (não sobrescreve) ou Autentique indisponível: segue a importação
    }
  }

  /**
   * Puxa pras Assinaturas os contracheques já importados na Folha CLT que ainda
   * não viraram documento (ex.: importados antes da integração existir). Só cria
   * os que faltam — nunca mexe num contracheque que já é documento aqui.
   */
  async sincronizarAssinaturas(tenantId: string, competencia: string) {
    if (!/^\d{4}-\d{2}$/.test(competencia)) throw new BadRequestException('Competência inválida (use AAAA-MM)');
    const jaTem = await this.assinaturas.empregadosComContracheque(tenantId, competencia);
    const hols = await comTenant(this.db, tenantId, (tx) =>
      tx.select({ empregadoId: pontoHolerite.empregadoId, arquivo: pontoHolerite.arquivo }).from(pontoHolerite)
        .where(and(eq(pontoHolerite.tenantId, tenantId), eq(pontoHolerite.competencia, competencia))));
    let criados = 0;
    const erros: { empregadoId: string; msg: string }[] = [];
    for (const h of hols) {
      if (jaTem.has(h.empregadoId)) continue;
      try {
        const bytes = this.cripto.decifrarBytes(h.arquivo);
        await this.assinaturas.salvarContracheque(tenantId, { competencia, empregadoId: h.empregadoId, bytes, arquivoNome: `contracheque-${competencia}.pdf` });
        criados++;
      } catch (e) { erros.push({ empregadoId: h.empregadoId, msg: (e as Error).message }); }
    }
    return { criados, jaTinham: hols.length - criados - erros.length, total: hols.length, erros };
  }

  /** Aviso no app (push), best-effort — nunca derruba o envio. */
  private async avisar(tenantId: string, empregadoId: string, competencia: string) {
    try {
      const u = await comoMaster(this.db, (tx) =>
        tx.select({ id: usuario.id }).from(usuario)
          .where(and(eq(usuario.tenantId, tenantId), eq(usuario.empregadoId, empregadoId), eq(usuario.ativo, true))).limit(1));
      const usuarioId = u[0]?.id;
      if (!usuarioId) return;
      const [ano, mes] = competencia.split('-');
      await this.push.enviarParaEmpregado(tenantId, empregadoId, usuarioId, 'sempre', {
        titulo: 'Contracheque disponível',
        corpo: `Seu contracheque de ${mes}/${ano} já está no app.`,
        url: '/holerites', tag: `holerite-${competencia}`,
      });
    } catch { /* push é best-effort */ }
  }

  /** Holerites do próprio funcionário. */
  async meus(tenantId: string, empregadoId: string) {
    return comTenant(this.db, tenantId, (tx) =>
      tx.select(CAMPOS).from(pontoHolerite)
        .where(and(eq(pontoHolerite.tenantId, tenantId), eq(pontoHolerite.empregadoId, empregadoId)))
        .orderBy(desc(pontoHolerite.competencia)));
  }

  /**
   * Mapa dos holerites de um mês (sem arquivo) para a Folha CLT: bruto, líquido
   * e pagamento, por empregado. Só a empresa atual (a folha é por tenant).
   */
  async competencia(tenantId: string, comp: string) {
    if (!/^\d{4}-\d{2}$/.test(comp)) throw new BadRequestException('Competência inválida (use AAAA-MM)');
    return comTenant(this.db, tenantId, (tx) =>
      tx.select({
        id: pontoHolerite.id, empregadoId: pontoHolerite.empregadoId,
        brutoCentavos: pontoHolerite.brutoCentavos, liquidoCentavos: pontoHolerite.liquidoCentavos,
        pagoEm: pontoHolerite.pagoEm, valorPagoCentavos: pontoHolerite.valorPagoCentavos,
      }).from(pontoHolerite)
        .where(and(eq(pontoHolerite.tenantId, tenantId), eq(pontoHolerite.competencia, comp))));
  }

  /** RH marca (ou desfaz) o pagamento do líquido do holerite. */
  async pagar(tenantId: string, id: string, usuarioId: string, pago: boolean, valorPagoCent: number | null) {
    return comTenant(this.db, tenantId, async (tx) => {
      const h = (await tx.select({ id: pontoHolerite.id }).from(pontoHolerite)
        .where(and(eq(pontoHolerite.id, id), eq(pontoHolerite.tenantId, tenantId))).limit(1))[0];
      if (!h) throw new NotFoundException('Holerite não encontrado');
      const dados = pago
        ? { pagoEm: new Date(), pagoPor: usuarioId, valorPagoCentavos: valorPagoCent ?? null }
        : { pagoEm: null, pagoPor: null, valorPagoCentavos: null };
      await tx.update(pontoHolerite).set(dados)
        .where(and(eq(pontoHolerite.id, id), eq(pontoHolerite.tenantId, tenantId)));
      return { pago, pagoEm: dados.pagoEm ? dados.pagoEm.toISOString() : null, valorPagoCentavos: dados.valorPagoCentavos };
    });
  }

  /** Baixa o PDF. Só o RH do cliente e o dono. */
  async baixar(tenantId: string, id: string, restringirAoEmpregado?: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const h = (await tx.select().from(pontoHolerite)
        .where(and(eq(pontoHolerite.id, id), eq(pontoHolerite.tenantId, tenantId))).limit(1))[0];
      if (!h) throw new NotFoundException('Holerite não encontrado');
      if (restringirAoEmpregado && h.empregadoId !== restringirAoEmpregado) {
        throw new ForbiddenException('Este holerite não é seu');
      }
      return { bytes: this.cripto.decifrarBytes(h.arquivo), nome: h.arquivoNome };
    });
  }
}
