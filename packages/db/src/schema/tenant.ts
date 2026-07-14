import { pgTable, uuid, varchar, boolean, timestamp } from 'drizzle-orm/pg-core';

/** Cliente = empregador. É a raiz do tenant. Gerenciado pelo MASTER. */
export const tenant = pgTable('tenant', {
  id: uuid('id').primaryKey().defaultRandom(),
  cnpj: varchar('cnpj', { length: 14 }).notNull().unique(),
  razaoSocial: varchar('razao_social', { length: 150 }).notNull(),
  localPrestacao: varchar('local_prestacao', { length: 200 }),
  ativo: boolean('ativo').notNull().default(true),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});
