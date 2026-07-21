import { pgTable, uuid, varchar, jsonb, boolean, timestamp } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';
import { pontoConvencao } from './convencao';

export type TipoRegraItem = 'EXTRA' | 'TOLERANCIA' | 'NOTURNO' | 'JORNADA' | 'BANCO' | 'DESTINACAO';

/** Uma opção de um item de regra (ex.: "Rodoviários 60%" do item EXTRA). */
export const pontoRegraItem = pgTable('ponto_regra_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  tipo: varchar('tipo', { length: 16 }).notNull().$type<TipoRegraItem>(),
  nome: varchar('nome', { length: 120 }).notNull(),
  config: jsonb('config').notNull().default({}),
  padrao: boolean('padrao').notNull().default(false),
  convencaoId: uuid('convencao_id').references(() => pontoConvencao.id),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});
