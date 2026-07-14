import {
  pgTable, uuid, varchar, char, smallint, integer, date, jsonb, timestamp,
} from 'drizzle-orm/pg-core';
import { tenant } from './tenant';
import { pontoRep } from './rep';
import { empregado } from './empregado';
import { pontoMarcacao } from './marcacao';

export interface ParEntradaSaida { entrada: string; saida: string; }

/** Horário contratual (registro tipo 04 do AEJ). */
export const pontoHorarioContratual = pgTable('ponto_horario_contratual', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  codigo: varchar('codigo', { length: 30 }).notNull(),
  durJornadaMin: integer('dur_jornada_min').notNull(),
  pares: jsonb('pares').$type<ParEntradaSaida[]>().notNull().default([]),
  diasSemana: jsonb('dias_semana').$type<number[]>().notNull().default([1, 2, 3, 4, 5]),
  regime: varchar('regime', { length: 10 }).notNull().default('normal'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Tratamento de marcações (registro tipo 05 do AEJ).
 * Fica POR CIMA da marcação original (marcacao_id), sem alterá-la.
 */
export const pontoTratamento = pgTable('ponto_tratamento', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  empregadoId: uuid('empregado_id').notNull().references(() => empregado.id),
  marcacaoId: uuid('marcacao_id').references(() => pontoMarcacao.id),
  dtMarcacao: timestamp('dt_marcacao', { withTimezone: true }).notNull(),
  tpMarc: char('tp_marc', { length: 1 }).notNull(),
  seqEntSaida: smallint('seq_ent_saida').notNull(),
  fonteMarc: char('fonte_marc', { length: 1 }).notNull().default('O'),
  codHorContratual: varchar('cod_hor_contratual', { length: 30 }),
  motivo: varchar('motivo', { length: 150 }),
  criadoPor: varchar('criado_por', { length: 14 }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

/** Ausências e banco de horas (registro tipo 07 do AEJ). */
export const pontoAusencia = pgTable('ponto_ausencia', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  empregadoId: uuid('empregado_id').notNull().references(() => empregado.id),
  tipo: smallint('tipo').notNull(),
  data: date('data').notNull(),
  qtMinutos: integer('qt_minutos'),
  tipoMovBh: smallint('tipo_mov_bh'),
  repId: uuid('rep_id').references(() => pontoRep.id),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

/** Calendário de feriados por cliente (nacional/estadual/municipal). */
export const pontoFeriado = pgTable('ponto_feriado', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  data: date('data').notNull(),
  nome: varchar('nome', { length: 120 }).notNull(),
  tipo: varchar('tipo', { length: 20 }).notNull().default('nacional'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

/** Calendário de escala (dias trabalhados) — usado no 12x36 e escalas irregulares. */
export const pontoEscala = pgTable('ponto_escala', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  empregadoId: uuid('empregado_id').notNull().references(() => empregado.id),
  data: date('data').notNull(),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});
