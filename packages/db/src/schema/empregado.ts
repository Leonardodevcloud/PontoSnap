import {pgTable, uuid, varchar, boolean, timestamp, unique, numeric, date, index } from 'drizzle-orm/pg-core';
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
  /** Perfil de regra escolhido (1 clique). Nulo = usa CLT padrão. */
  perfilRegraId: uuid('perfil_regra_id'),
  matriculaEsocial: varchar('matricula_esocial', { length: 30 }),
  ativo: boolean('ativo').notNull().default(true),
  /** A apuração ignora dias anteriores a esta data (migração / admissão). Nulo = sem corte. */
  dataInicioPonto: date('data_inicio_ponto'),
  /** Admissão real (pode ser anterior ao uso do ponto). Base da carência da cesta. */
  dataAdmissao: date('data_admissao'),
  /** Gestão de pessoal: cliente (loja/empresa atendida) a que o CLT pertence. Texto livre. */
  cliente: varchar('cliente', { length: 120 }),
  salarioMensal: numeric('salario_mensal', { precision: 12, scale: 2 }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('uq_empregado_cpf').on(t.tenantId, t.cpf),
  unique('uq_empregado_matricula').on(t.tenantId, t.matricula),
]);

/**
 * Histórico de salário com vigência (migration 0041). A apuração usa, em cada
 * dia, o salário vigente naquele dia. empregado.salario_mensal = o mais recente.
 */
export const empregadoSalario = pgTable('empregado_salario', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  empregadoId: uuid('empregado_id').notNull().references(() => empregado.id),
  vigenteDesde: date('vigente_desde').notNull(),
  salarioMensal: numeric('salario_mensal', { precision: 12, scale: 2 }).notNull(),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('uq_empregado_salario').on(t.tenantId, t.empregadoId, t.vigenteDesde),
  index('idx_empregado_salario_emp').on(t.tenantId, t.empregadoId),
]);
