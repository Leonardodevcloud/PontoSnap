import { pgTable, uuid, varchar, boolean, timestamp } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';

/** Tablet-quiosque: autentica como dispositivo do tenant; dentro dele, cada
 *  batida é identificada por matrícula + PIN do empregado. */
export const dispositivo = pgTable('dispositivo', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  nome: varchar('nome', { length: 80 }).notNull(),
  tokenHash: varchar('token_hash', { length: 120 }).notNull(),
  ativo: boolean('ativo').notNull().default(true),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});
