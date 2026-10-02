import { pgTable, uuid, varchar, integer, date, timestamp, index, unique } from 'drizzle-orm/pg-core';
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

/**
 * Registro de que uma competência (YYYY-MM) já foi FECHADA no banco de horas
 * de um funcionário — isto é, o saldo apurado de cada dia daquele mês já virou
 * movimento em ponto_banco_mov.
 *
 * Existe porque um mês pode fechar com zero movimentos (funcionário certinho),
 * e sem esta marca o sistema não teria como saber se "zero" é "não fechou"
 * ou "fechou e não tinha nada". É esta tabela que permite o fechamento
 * automático: todo mês encerrado sem linha aqui é fechado na próxima
 * consulta de saldo (ou pelo cron). Apagar a linha = "refaça este mês".
 */
export const pontoBancoFechamento = pgTable('ponto_banco_fechamento', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  empregadoId: uuid('empregado_id').notNull().references(() => empregado.id),
  competencia: varchar('competencia', { length: 7 }).notNull(),
  /** Soma dos movimentos lançados por este fechamento (pode ser 0). */
  totalMin: integer('total_min').notNull().default(0),
  /** Quantos movimentos o fechamento gerou. */
  lancamentos: integer('lancamentos').notNull().default(0),
  /** AUTO (sincronização/cron) | MANUAL (RH mandou refazer). */
  origem: varchar('origem', { length: 8 }).notNull().default('AUTO'),
  fechadoEm: timestamp('fechado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  umPorCompetencia: unique('uq_banco_fechamento').on(t.tenantId, t.empregadoId, t.competencia),
  porEmpregado: index('idx_banco_fechamento_empregado').on(t.tenantId, t.empregadoId),
}));
