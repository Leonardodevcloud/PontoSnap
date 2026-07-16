import { pgTable, uuid, varchar, integer, date, timestamp, index } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';
import { empregado } from './empregado';

/**
 * Extrato do banco de horas. Cada linha é um movimento; o saldo é o resultado
 * de percorrer o extrato (ver calcularBanco no @ponto/apuracao-clt).
 *
 * Não guardamos saldo consolidado de propósito: saldo derivado do extrato é
 * sempre auditável, e o funcionário pode conferir de onde veio cada minuto.
 */
export const pontoBancoMov = pgTable('ponto_banco_mov', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  empregadoId: uuid('empregado_id').notNull().references(() => empregado.id),
  data: date('data').notNull(),
  /** > 0 credita (hora extra) · < 0 debita (folga, pagamento, ajuste). */
  minutos: integer('minutos').notNull(),
  /** CREDITO | DEBITO | PAGAMENTO | AJUSTE */
  tipo: varchar('tipo', { length: 12 }).notNull(),
  descricao: varchar('descricao', { length: 160 }),
  /** Competência que originou o lançamento (YYYY-MM). Null = movimento avulso. */
  competencia: varchar('competencia', { length: 7 }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  porEmpregado: index('idx_banco_mov_empregado').on(t.tenantId, t.empregadoId, t.data),
}));
