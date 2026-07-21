import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, eq } from 'drizzle-orm';
import { pontoConvencao, empregado, comTenant, type Db } from '@ponto/db';
import { DB } from '../database/database.module';
import { CctService } from '../cct/cct.service';
import type { ExtracaoCct } from '../cct/extrair-cct';

// Lista/detalhe sem o PDF (que é pesado) — o PDF só é lido sob demanda.
const CAMPOS = {
  id: pontoConvencao.id, nome: pontoConvencao.nome, sindicato: pontoConvencao.sindicato,
  uf: pontoConvencao.uf, vigencia: pontoConvencao.vigencia,
  numeroRegistroMte: pontoConvencao.numeroRegistroMte, categoria: pontoConvencao.categoria,
  observacoes: pontoConvencao.observacoes, pdfNome: pontoConvencao.pdfNome,
};

type Dados = Omit<typeof pontoConvencao.$inferInsert, 'id' | 'tenantId' | 'criadoEm'>;

@Injectable()
export class ConvencaoService {
  constructor(@Inject(DB) private readonly db: Db, private readonly cct: CctService) {}

  async listar(tenantId: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const linhas = await tx.select({ ...CAMPOS, temPdf: pontoConvencao.pdfNome }).from(pontoConvencao)
        .where(eq(pontoConvencao.tenantId, tenantId)).orderBy(asc(pontoConvencao.nome));
      const cont = await tx.select({ id: empregado.convencaoId, n: count() }).from(empregado)
        .where(and(eq(empregado.tenantId, tenantId), eq(empregado.ativo, true)))
        .groupBy(empregado.convencaoId);
      const por = new Map(cont.map((c) => [c.id, Number(c.n)]));
      return linhas.map((c) => ({ ...c, temPdf: !!c.pdfNome, funcionarios: por.get(c.id) ?? 0 }));
    });
  }

  async criar(tenantId: string, dados: Dados) {
    if (!dados.nome?.trim()) throw new BadRequestException('Dê um nome à convenção');
    return comTenant(this.db, tenantId, async (tx) => {
      const [c] = await tx.insert(pontoConvencao).values({ ...dados, tenantId }).returning(CAMPOS);
      return c;
    });
  }

  async atualizar(tenantId: string, id: string, dados: Dados) {
    return comTenant(this.db, tenantId, async (tx) => {
      // Não sobrescreve o PDF com nulo quando o form não reenvia o arquivo.
      const set: Partial<Dados> = { ...dados };
      if (set.pdfBase64 == null) { delete set.pdfBase64; delete set.pdfNome; }
      const [c] = await tx.update(pontoConvencao).set(set)
        .where(and(eq(pontoConvencao.id, id), eq(pontoConvencao.tenantId, tenantId))).returning(CAMPOS);
      if (!c) throw new NotFoundException('Convenção não encontrada');
      return c;
    });
  }

  async remover(tenantId: string, id: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const usados = (await tx.select({ n: count() }).from(empregado)
        .where(and(eq(empregado.tenantId, tenantId), eq(empregado.convencaoId, id))))[0]?.n ?? 0;
      if (Number(usados) > 0) throw new BadRequestException('Há funcionários usando esta convenção. Troque-os antes de remover.');
      await tx.delete(pontoConvencao).where(and(eq(pontoConvencao.id, id), eq(pontoConvencao.tenantId, tenantId)));
      return { removido: true };
    });
  }

  /** Lê o PDF guardado nesta convenção e devolve um rascunho de Regra (IA). */
  async gerarRegra(tenantId: string, id: string): Promise<ExtracaoCct> {
    const pdf = await comTenant(this.db, tenantId, async (tx) =>
      (await tx.select({ pdf: pontoConvencao.pdfBase64 }).from(pontoConvencao)
        .where(and(eq(pontoConvencao.id, id), eq(pontoConvencao.tenantId, tenantId))).limit(1))[0]?.pdf);
    if (!pdf) throw new BadRequestException('Esta convenção não tem PDF anexado.');
    return this.cct.extrairDoPdf(pdf);
  }
}
