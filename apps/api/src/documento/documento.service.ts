import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { pontoDocumento, empregado, usuario, comTenant, type Db } from '@ponto/db';
import { DB } from '../database/database.module';
import { CriptoService } from '../common/cripto.service';

/** 5 MB depois de comprimido no aparelho já é foto de atestado com folga. */
const LIMITE_BYTES = 5 * 1024 * 1024;
const MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export type TipoDocumento = 'ATESTADO' | 'COMPARECIMENTO';
export type StatusDocumento = 'EM_ANALISE' | 'ABONADO' | 'RECUSADO';

/** Campos sem o arquivo — nunca traga o bytea numa listagem. */
const CAMPOS = {
  id: pontoDocumento.id, empregadoId: pontoDocumento.empregadoId,
  tipo: pontoDocumento.tipo, dataInicio: pontoDocumento.dataInicio, dataFim: pontoDocumento.dataFim,
  minutos: pontoDocumento.minutos, status: pontoDocumento.status,
  motivoRecusa: pontoDocumento.motivoRecusa, arquivoNome: pontoDocumento.arquivoNome,
  arquivoMime: pontoDocumento.arquivoMime, arquivoBytes: pontoDocumento.arquivoBytes,
  enviadoEm: pontoDocumento.enviadoEm, analisadoEm: pontoDocumento.analisadoEm,
};

@Injectable()
export class DocumentoService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly cripto: CriptoService,
  ) {}

  async empregadoDoUsuario(usuarioId: string, tenantId: string): Promise<string> {
    return comTenant(this.db, tenantId, async (tx) => {
      const u = (await tx.select().from(usuario).where(eq(usuario.id, usuarioId)).limit(1))[0];
      if (!u?.empregadoId) throw new BadRequestException('Usuário não vinculado a um empregado');
      return u.empregadoId;
    });
  }

  /** Funcionário envia. O arquivo é cifrado antes de encostar no disco. */
  async enviar(tenantId: string, empregadoId: string, p: {
    tipo: TipoDocumento; dataInicio: string; dataFim: string; minutos?: number | null;
    arquivoBase64: string; arquivoNome: string; arquivoMime: string;
  }) {
    if (!MIMES.includes(p.arquivoMime)) {
      throw new BadRequestException('Envie uma foto (JPG, PNG, WebP) ou um PDF');
    }
    if (p.dataFim < p.dataInicio) throw new BadRequestException('A data final não pode ser antes da inicial');

    const bruto = Buffer.from(p.arquivoBase64, 'base64');
    if (bruto.length === 0) throw new BadRequestException('Arquivo vazio');
    if (bruto.length > LIMITE_BYTES) {
      throw new BadRequestException('Arquivo maior que 5 MB. Tire a foto de novo, mais leve.');
    }
    if (p.minutos != null && (p.minutos < 1 || p.minutos > 24 * 60)) {
      throw new BadRequestException('Minutos abonados fora do intervalo de um dia');
    }

    return comTenant(this.db, tenantId, async (tx) => {
      const [doc] = await tx.insert(pontoDocumento).values({
        tenantId, empregadoId, tipo: p.tipo,
        dataInicio: p.dataInicio, dataFim: p.dataFim,
        minutos: p.minutos ?? null,
        arquivo: this.cripto.cifrarBytes(bruto),
        arquivoNome: p.arquivoNome.slice(0, 120),
        arquivoMime: p.arquivoMime,
        arquivoBytes: bruto.length,
      }).returning(CAMPOS);
      return doc;
    });
  }

  /** Do próprio funcionário. */
  async meus(tenantId: string, empregadoId: string) {
    return comTenant(this.db, tenantId, (tx) =>
      tx.select(CAMPOS).from(pontoDocumento).where(and(
        eq(pontoDocumento.tenantId, tenantId), eq(pontoDocumento.empregadoId, empregadoId),
      )).orderBy(desc(pontoDocumento.enviadoEm)));
  }

  /** Do RH: tudo, ou só o que espera análise. */
  async listar(tenantId: string, status?: StatusDocumento) {
    return comTenant(this.db, tenantId, async (tx) => {
      const conds = [eq(pontoDocumento.tenantId, tenantId)];
      if (status) conds.push(eq(pontoDocumento.status, status));
      const docs = await tx.select({ ...CAMPOS, nome: empregado.nome, matricula: empregado.matricula })
        .from(pontoDocumento)
        .innerJoin(empregado, eq(empregado.id, pontoDocumento.empregadoId))
        .where(and(...conds))
        .orderBy(desc(pontoDocumento.enviadoEm));
      return docs;
    });
  }

  /**
   * Baixa o arquivo. Só o RH do cliente e o dono do documento — é dado de saúde,
   * e o resto da empresa não tem o que fazer aqui.
   */
  async baixar(tenantId: string, id: string, restringirAoEmpregado?: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const d = (await tx.select().from(pontoDocumento).where(and(
        eq(pontoDocumento.id, id), eq(pontoDocumento.tenantId, tenantId))).limit(1))[0];
      if (!d) throw new NotFoundException('Documento não encontrado');
      if (restringirAoEmpregado && d.empregadoId !== restringirAoEmpregado) {
        throw new ForbiddenException('Este documento não é seu');
      }
      return {
        bytes: this.cripto.decifrarBytes(d.arquivo),
        nome: d.arquivoNome, mime: d.arquivoMime,
      };
    });
  }

  /**
   * RH abona. Não grava nada no AEJ: o registro 07 não tem código para atestado,
   * e abonar no arquivo fiscal é justamente NÃO lançar falta. O efeito aparece na
   * apuração, que lê os documentos abonados e abate a jornada do dia.
   */
  async decidir(tenantId: string, id: string, usuarioId: string, p: {
    status: 'ABONADO' | 'RECUSADO'; motivoRecusa?: string;
  }) {
    if (p.status === 'RECUSADO' && !p.motivoRecusa?.trim()) {
      throw new BadRequestException('Recusa precisa de motivo — o funcionário tem que saber o que corrigir');
    }
    return comTenant(this.db, tenantId, async (tx) => {
      const atual = (await tx.select({ status: pontoDocumento.status }).from(pontoDocumento)
        .where(and(eq(pontoDocumento.id, id), eq(pontoDocumento.tenantId, tenantId))).limit(1))[0];
      if (!atual) throw new NotFoundException('Documento não encontrado');

      const [doc] = await tx.update(pontoDocumento).set({
        status: p.status,
        motivoRecusa: p.status === 'RECUSADO' ? p.motivoRecusa!.trim() : null,
        analisadoEm: new Date(), analisadoPor: usuarioId,
      }).where(eq(pontoDocumento.id, id)).returning(CAMPOS);
      return doc;
    });
  }
}
