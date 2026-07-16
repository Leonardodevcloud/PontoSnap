import { boolean, integer, numeric, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

/** Cliente = empregador. É a raiz do tenant. Gerenciado pelo MASTER. */
export const tenant = pgTable('tenant', {
  id: uuid('id').primaryKey().defaultRandom(),
  cnpj: varchar('cnpj', { length: 14 }).notNull().unique(),
  razaoSocial: varchar('razao_social', { length: 150 }).notNull(),
  localPrestacao: varchar('local_prestacao', { length: 200 }),
  // Local do estabelecimento: define quando pedir observação na batida.
  // Nunca bloqueia marcação — restringir marcação é vedado pela Portaria 671.
  latitude: numeric('latitude', { precision: 10, scale: 7 }),
  longitude: numeric('longitude', { precision: 10, scale: 7 }),
  raioMetros: integer('raio_metros'),
  // Banco de horas. NENHUM = extra é paga na folha, e a aba nem aparece pro
  // funcionário. O prazo vem do acordo: 6 meses (individual escrito) ou
  // 12 (coletivo) — mas fica editável porque acordo coletivo pode dispor outro.
  bancoTipoAcordo: varchar('banco_tipo_acordo', { length: 12 }).notNull().default('NENHUM'),
  bancoPrazoMeses: integer('banco_prazo_meses'),
  ativo: boolean('ativo').notNull().default(true),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});
