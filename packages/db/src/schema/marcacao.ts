import {
  pgTable, uuid, varchar, char, smallint, bigint, numeric, timestamp, unique, index,
} from 'drizzle-orm/pg-core';
import { tenant } from './tenant';
import { pontoRep } from './rep';

/**
 * Marcações — APPEND-ONLY, IMUTÁVEL (registro tipo 7 do AFD).
 * A trigger de imutabilidade e as policies RLS são aplicadas via migration SQL.
 */
export const pontoMarcacao = pgTable('ponto_marcacao', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  repId: uuid('rep_id').notNull().references(() => pontoRep.id),
  nsr: bigint('nsr', { mode: 'number' }).notNull(),
  tipoRegistro: char('tipo_registro', { length: 1 }).notNull().default('7'),
  cpf: varchar('cpf', { length: 11 }).notNull(),
  dtMarcacao: timestamp('dt_marcacao', { withTimezone: true }).notNull(),
  dtGravacao: timestamp('dt_gravacao', { withTimezone: true }).notNull().defaultNow(),
  coletor: smallint('coletor').notNull(),
  onlineOffline: smallint('online_offline').notNull().default(0),
  hashRegistro: char('hash_registro', { length: 64 }).notNull(),
  hashAnterior: char('hash_anterior', { length: 64 }),
  ipOrigem: varchar('ip_origem', { length: 45 }),
  latitude: numeric('latitude', { precision: 10, scale: 7 }),
  longitude: numeric('longitude', { precision: 10, scale: 7 }),
  // Escrita só no INSERT — o gatilho de imutabilidade bloqueia UPDATE/DELETE.
  observacao: varchar('observacao', { length: 200 }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('uq_marcacao_nsr').on(t.repId, t.nsr),
  unique('uq_marcacao_hash').on(t.repId, t.hashRegistro),
  index('idx_marcacao_emp').on(t.tenantId, t.cpf, t.dtMarcacao),
]);

/** Eventos sensíveis do REP-P (tipo 6 do AFD): 7=disponibilidade, 8=indisponibilidade. */
export const pontoEvento = pgTable('ponto_evento', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  repId: uuid('rep_id').notNull().references(() => pontoRep.id),
  nsr: bigint('nsr', { mode: 'number' }).notNull(),
  tipoEvento: smallint('tipo_evento').notNull(),
  dtGravacao: timestamp('dt_gravacao', { withTimezone: true }).notNull().defaultNow(),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('uq_evento_nsr').on(t.repId, t.nsr)]);
