import { pgTable, uuid, integer, smallint, varchar, char, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';
import { pontoRep } from './rep';

/**
 * Registros do AFD que não são marcação (tipos 2, 5 e 6 do Anexo V).
 * Compartilham o MESMO contador de NSR das marcações — a sequência do AFD é
 * única para todos os tipos de registro.
 */
export const pontoEventoRep = pgTable('ponto_evento_rep', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  repId: uuid('rep_id').notNull().references(() => pontoRep.id),
  nsr: integer('nsr').notNull(),
  /** 2 = empresa, 5 = empregado, 6 = evento sensível. */
  tipo: smallint('tipo').notNull(),
  dtGravacao: timestamp('dt_gravacao', { withTimezone: true }).notNull(),
  fuso: varchar('fuso', { length: 5 }).notNull().default('-0300'),
  // tipo 2
  docResponsavel: varchar('doc_responsavel', { length: 14 }),
  tpIdtEmpregador: smallint('tp_idt_empregador'),
  docEmpregador: varchar('doc_empregador', { length: 14 }),
  cnoCaepf: varchar('cno_caepf', { length: 14 }),
  razaoSocial: varchar('razao_social', { length: 150 }),
  localPrestacao: varchar('local_prestacao', { length: 100 }),
  // tipo 5
  operacao: char('operacao', { length: 1 }),
  cpfEmpregado: varchar('cpf_empregado', { length: 12 }),
  nomeEmpregado: varchar('nome_empregado', { length: 52 }),
  dadosIdentificacao: varchar('dados_identificacao', { length: 4 }),
  // tipo 6
  tipoEvento: smallint('tipo_evento'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uqNsr: uniqueIndex('uq_evento_rep_nsr').on(t.repId, t.nsr),
}));
