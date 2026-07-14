import { pgTable, uuid, varchar, jsonb, text, timestamp } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';

/** Fila de jobs assíncronos (relatórios pesados etc.) processada em segundo plano. */
export const pontoJob = pgTable('ponto_job', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  tipo: varchar('tipo', { length: 40 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pendente'), // pendente|processando|concluido|erro
  params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
  resultado: jsonb('resultado'),
  erro: text('erro'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});
