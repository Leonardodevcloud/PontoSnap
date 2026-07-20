import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, count } from 'drizzle-orm';
import { pontoCct, empregado, comTenant, type Db } from '@ponto/db';
import { DB } from '../database/database.module';

const CAMPOS = {
  id: pontoCct.id, nome: pontoCct.nome, uf: pontoCct.uf, vigencia: pontoCct.vigencia,
  extraDiaUtilPct: pontoCct.extraDiaUtilPct, extraDomingoFeriadoPct: pontoCct.extraDomingoFeriadoPct,
  extraLimiteDiarioMin: pontoCct.extraLimiteDiarioMin,
  toleranciaDiariaMin: pontoCct.toleranciaDiariaMin, toleranciaPorMarcacaoMin: pontoCct.toleranciaPorMarcacaoMin,
  noturnoAdicionalPct: pontoCct.noturnoAdicionalPct, noturnoReduzida: pontoCct.noturnoReduzida,
  noturnoInicioMin: pontoCct.noturnoInicioMin, noturnoFimMin: pontoCct.noturnoFimMin,
  jornadaSemanalMin: pontoCct.jornadaSemanalMin, interjornadaMinimaMin: pontoCct.interjornadaMinimaMin,
  intervaloMaior6hMin: pontoCct.intervaloMaior6hMin, bancoPrazoMeses: pontoCct.bancoPrazoMeses,
};

type Dados = Omit<typeof pontoCct.$inferInsert, 'id' | 'tenantId' | 'criadoEm'>;

@Injectable()
export class CctService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Lista as convenções da empresa, com quantos funcionários em cada. */
  async listar(tenantId: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const ccts = await tx.select(CAMPOS).from(pontoCct)
        .where(eq(pontoCct.tenantId, tenantId)).orderBy(asc(pontoCct.nome));
      const contagem = await tx.select({ cctId: empregado.cctId, n: count() }).from(empregado)
        .where(and(eq(empregado.tenantId, tenantId), eq(empregado.ativo, true)))
        .groupBy(empregado.cctId);
      const porCct = new Map(contagem.map((c) => [c.cctId, Number(c.n)]));
      return ccts.map((c) => ({ ...c, funcionarios: porCct.get(c.id) ?? 0 }));
    });
  }

  async criar(tenantId: string, dados: Dados) {
    if (!dados.nome?.trim()) throw new BadRequestException('Dê um nome à convenção');
    return comTenant(this.db, tenantId, async (tx) => {
      const [c] = await tx.insert(pontoCct).values({ ...dados, tenantId }).returning(CAMPOS);
      return c;
    });
  }

  async atualizar(tenantId: string, id: string, dados: Dados) {
    return comTenant(this.db, tenantId, async (tx) => {
      const [c] = await tx.update(pontoCct).set(dados)
        .where(and(eq(pontoCct.id, id), eq(pontoCct.tenantId, tenantId))).returning(CAMPOS);
      if (!c) throw new NotFoundException('Convenção não encontrada');
      return c;
    });
  }

  /** Só remove se nenhum funcionário estiver vinculado. */
  async remover(tenantId: string, id: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const usados = (await tx.select({ n: count() }).from(empregado)
        .where(and(eq(empregado.tenantId, tenantId), eq(empregado.cctId, id))))[0]?.n ?? 0;
      if (Number(usados) > 0) {
        throw new BadRequestException('Há funcionários usando esta convenção. Troque-os antes de remover.');
      }
      await tx.delete(pontoCct).where(and(eq(pontoCct.id, id), eq(pontoCct.tenantId, tenantId)));
      return { removido: true };
    });
  }
}
