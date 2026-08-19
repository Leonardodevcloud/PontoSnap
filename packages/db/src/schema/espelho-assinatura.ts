import { pgTable, uuid, varchar, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';
import { empregado } from './empregado';

/**
 * Concordância eletrônica do funcionário com o espelho de uma competência.
 * Guarda o HASH do PDF conferido — é o que prova com o quê ele concordou.
 */
export const espelhoAssinatura = pgTable('espelho_assinatura', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  empregadoId: uuid('empregado_id').notNull().references(() => empregado.id),
  competencia: varchar('competencia', { length: 7 }).notNull(),
  hashDocumento: varchar('hash_documento', { length: 64 }).notNull(),
  assinadoEm: timestamp('assinado_em', { withTimezone: true }).notNull().defaultNow(),
  via: varchar('via', { length: 60 }).notNull().default('PIN no app'),
  ip: varchar('ip', { length: 45 }),
  auditoriaRef: varchar('auditoria_ref', { length: 20 }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uq: uniqueIndex('uq_espelho_assinatura').on(t.empregadoId, t.competencia),
}));
