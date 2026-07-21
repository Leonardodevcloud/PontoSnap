import {pgTable, uuid, varchar, boolean, timestamp, unique, numeric } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';

export const empregado = pgTable('empregado', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  cpf: varchar('cpf', { length: 11 }).notNull(),
  nome: varchar('nome', { length: 52 }).notNull(),
  pis: varchar('pis', { length: 11 }),
  matricula: varchar('matricula', { length: 30 }),        // identificador do quiosque
  pinHash: varchar('pin_hash', { length: 120 }),          // PIN do quiosque (hash)
  horarioContratualId: uuid('horario_contratual_id'),
  cctId: uuid('cct_id'),
  convencaoId: uuid('convencao_id'),
  regraExtraId: uuid('regra_extra_id'),
  regraToleranciaId: uuid('regra_tolerancia_id'),
  regraNoturnoId: uuid('regra_noturno_id'),
  regraJornadaId: uuid('regra_jornada_id'),
  regraBancoId: uuid('regra_banco_id'),
  regraDestinacaoId: uuid('regra_destinacao_id'),
  matriculaEsocial: varchar('matricula_esocial', { length: 30 }),
  ativo: boolean('ativo').notNull().default(true),
  salarioMensal: numeric('salario_mensal', { precision: 12, scale: 2 }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('uq_empregado_cpf').on(t.tenantId, t.cpf),
  unique('uq_empregado_matricula').on(t.tenantId, t.matricula),
]);
