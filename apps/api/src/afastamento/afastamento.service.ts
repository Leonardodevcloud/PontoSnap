import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, lte, ne } from 'drizzle-orm';
import { pontoAfastamento, empregado, comTenant, type Db } from '@ponto/db';
import { DB } from '../database/database.module';

export const TIPOS = ['FERIAS', 'INSS', 'MATERNIDADE', 'PATERNIDADE', 'SUSPENSAO', 'OUTRO'] as const;
export type TipoAfastamento = (typeof TIPOS)[number];

export const ROTULO: Record<TipoAfastamento, string> = {
  FERIAS: 'Férias',
  INSS: 'Afastamento pelo INSS',
  MATERNIDADE: 'Licença-maternidade',
  PATERNIDADE: 'Licença-paternidade',
  SUSPENSAO: 'Suspensão',
  OUTRO: 'Outro afastamento',
};

@Injectable()
export class AfastamentoService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async criar(tenantId: string, usuarioId: string, p: {
    empregadoId: string; tipo: TipoAfastamento;
    dataInicio: string; dataFim: string; observacao?: string;
  }) {
    if (p.dataFim < p.dataInicio) throw new BadRequestException('A data final não pode ser antes da inicial');

    return comTenant(this.db, tenantId, async (tx) => {
      const e = (await tx.select().from(empregado).where(and(
        eq(empregado.id, p.empregadoId), eq(empregado.tenantId, tenantId))).limit(1))[0];
      if (!e) throw new NotFoundException('Empregado não encontrado');

      // Dois afastamentos sobrepostos no mesmo empregado seria contradição:
      // o dia não pode ser férias e INSS ao mesmo tempo.
      const choque = (await tx.select({ id: pontoAfastamento.id, tipo: pontoAfastamento.tipo })
        .from(pontoAfastamento).where(and(
          eq(pontoAfastamento.tenantId, tenantId),
          eq(pontoAfastamento.empregadoId, p.empregadoId),
          lte(pontoAfastamento.dataInicio, p.dataFim),
          gte(pontoAfastamento.dataFim, p.dataInicio),
        )).limit(1))[0];
      if (choque) {
        throw new BadRequestException(
          `Já existe um afastamento (${ROTULO[choque.tipo as TipoAfastamento] ?? choque.tipo}) nesse período`);
      }

      const [a] = await tx.insert(pontoAfastamento).values({
        tenantId, empregadoId: p.empregadoId, tipo: p.tipo,
        dataInicio: p.dataInicio, dataFim: p.dataFim,
        observacao: p.observacao?.trim() || null,
        criadoPor: usuarioId,
      }).returning();
      return a;
    });
  }

  async listar(tenantId: string, empregadoId?: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const conds = [eq(pontoAfastamento.tenantId, tenantId)];
      if (empregadoId) conds.push(eq(pontoAfastamento.empregadoId, empregadoId));
      return tx.select({
        id: pontoAfastamento.id, empregadoId: pontoAfastamento.empregadoId,
        tipo: pontoAfastamento.tipo, dataInicio: pontoAfastamento.dataInicio,
        dataFim: pontoAfastamento.dataFim, observacao: pontoAfastamento.observacao,
        nome: empregado.nome,
      }).from(pontoAfastamento)
        .innerJoin(empregado, eq(empregado.id, pontoAfastamento.empregadoId))
        .where(and(...conds))
        .orderBy(asc(pontoAfastamento.dataInicio));
    });
  }

  /**
   * Afastamento não é registro fiscal: é declaração do RH sobre o contrato.
   * Se foi lançado errado, apagar é o certo — a marcação é que é imutável.
   */
  async remover(tenantId: string, id: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const [a] = await tx.delete(pontoAfastamento).where(and(
        eq(pontoAfastamento.id, id), eq(pontoAfastamento.tenantId, tenantId))).returning();
      if (!a) throw new NotFoundException('Afastamento não encontrado');
      return { removido: true };
    });
  }
}
