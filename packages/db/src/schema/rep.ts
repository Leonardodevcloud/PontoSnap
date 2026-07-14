import { pgTable, uuid, varchar, smallint, bigint, boolean, timestamp, unique } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';

/** Config do REP-P por tenant. Guarda o ponteiro da cadeia (ultimo_nsr/hash). */
export const pontoRep = pgTable('ponto_rep', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  tipoIdEmpregador: smallint('tipo_id_empregador').notNull(),
  documentoEmpregador: varchar('documento_empregador', { length: 14 }).notNull(),
  cnoCaepf: varchar('cno_caepf', { length: 14 }),
  razaoSocial: varchar('razao_social', { length: 150 }).notNull(),
  numeroInpi: varchar('numero_inpi', { length: 17 }).notNull(),
  tipoIdDesenvolvedor: smallint('tipo_id_desenvolvedor').notNull(),
  documentoDesenvolvedor: varchar('documento_desenvolvedor', { length: 14 }).notNull(),
  ultimoNsr: bigint('ultimo_nsr', { mode: 'number' }).notNull().default(0),
  ultimoHash: varchar('ultimo_hash', { length: 64 }),
  ativo: boolean('ativo').notNull().default(true),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('uq_rep_tenant').on(t.tenantId)]);
