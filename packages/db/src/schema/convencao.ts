import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';

/** Convenção coletiva = o DOCUMENTO (CCT/ACT). O cálculo mora na Regra (pontoCct). */
export const pontoConvencao = pgTable('ponto_convencao', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  nome: varchar('nome', { length: 140 }).notNull(),
  sindicato: varchar('sindicato', { length: 140 }),
  uf: varchar('uf', { length: 2 }),
  vigencia: varchar('vigencia', { length: 60 }),
  numeroRegistroMte: varchar('numero_registro_mte', { length: 60 }),
  categoria: varchar('categoria', { length: 140 }),
  observacoes: text('observacoes'),
  pdfNome: varchar('pdf_nome', { length: 200 }),
  pdfBase64: text('pdf_base64'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});
