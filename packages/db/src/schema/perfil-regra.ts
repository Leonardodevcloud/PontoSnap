import { pgTable, uuid, varchar, jsonb, boolean, text, timestamp } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';

/**
 * Perfil de regra: um pacote com os 6 itens de cálculo dentro (extra,
 * tolerância, noturno, jornada, banco, destinação). O RH cria uma vez e, no
 * funcionário, escolhe com um clique. A convenção (CCT/PDF do sindicato) é um
 * anexo opcional do próprio perfil.
 */
export const pontoPerfilRegra = pgTable('ponto_perfil_regra', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  nome: varchar('nome', { length: 120 }).notNull(),
  /** { extra?, tolerancia?, noturno?, jornada?, banco?, destinacao? } — nulo em um item = CLT. */
  config: jsonb('config').notNull().default({}),
  padrao: boolean('padrao').notNull().default(false),
  // convenção coletiva opcional
  cctSindicato: varchar('cct_sindicato', { length: 140 }),
  cctVigencia: varchar('cct_vigencia', { length: 60 }),
  cctRegistroMte: varchar('cct_registro_mte', { length: 60 }),
  cctPdfNome: varchar('cct_pdf_nome', { length: 200 }),
  cctPdfBase64: text('cct_pdf_base64'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});
