import { and, eq, gte, lte } from 'drizzle-orm';
import { pontoBancoFechamento } from '@ponto/db';

/**
 * Helpers de fechamento do banco de horas que outros módulos (ajuste,
 * atestado, afastamento) chamam SEM depender do BancoService — pra não criar
 * import circular entre módulos. Recebem a transação já aberta com tenant.
 */

type Tx = { delete: (t: typeof pontoBancoFechamento) => { where: (c: unknown) => Promise<unknown> } };

/** Competência YYYY-MM de uma data YYYY-MM-DD. */
export const competenciaDe = (data: string): string => data.slice(0, 7);

/**
 * Marca uma competência pra ser refeita: apaga só a marca de fechamento.
 * Os movimentos daquele mês ficam até a próxima sincronização, que os
 * substitui — assim o saldo nunca "some" no meio do caminho.
 *
 * Chame sempre que algo que muda a apuração de um dia passado for alterado:
 * ajuste de ponto aprovado/revogado, atestado abonado/recusado, afastamento
 * criado/removido, folga compensatória registrada/removida.
 */
export async function reabrirCompetencia(
  tx: Tx, tenantId: string, empregadoId: string, competencia: string,
): Promise<void> {
  await tx.delete(pontoBancoFechamento).where(and(
    eq(pontoBancoFechamento.tenantId, tenantId),
    eq(pontoBancoFechamento.empregadoId, empregadoId),
    eq(pontoBancoFechamento.competencia, competencia),
  ));
}

/** Reabre todas as competências que um intervalo de datas toca. */
export async function reabrirIntervalo(
  tx: Tx, tenantId: string, empregadoId: string, dataInicio: string, dataFim: string,
): Promise<void> {
  await tx.delete(pontoBancoFechamento).where(and(
    eq(pontoBancoFechamento.tenantId, tenantId),
    eq(pontoBancoFechamento.empregadoId, empregadoId),
    gte(pontoBancoFechamento.competencia, competenciaDe(dataInicio)),
    lte(pontoBancoFechamento.competencia, competenciaDe(dataFim)),
  ));
}
