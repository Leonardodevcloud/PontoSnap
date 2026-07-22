import { pgTable, uuid, varchar, char, date, timestamp } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';
import { empregado } from './empregado';
import { pontoMarcacao } from './marcacao';

export type TipoAjuste = 'INCLUSAO' | 'DESCONSIDERAR';
export type StatusAjuste = 'EM_ANALISE' | 'APROVADO' | 'RECUSADO';

/**
 * Pedido de ajuste de ponto. Nunca altera a marcação original — quando
 * aprovado, vira tratamento ('I' incluída / 'D' desconsiderada) no AEJ.
 */
export const pontoAjuste = pgTable('ponto_ajuste', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  empregadoId: uuid('empregado_id').notNull().references(() => empregado.id),
  tipo: varchar('tipo', { length: 14 }).notNull().$type<TipoAjuste>(),
  data: date('data').notNull(),
  /** INCLUSAO: hora pedida. */
  dtMarcacao: timestamp('dt_marcacao', { withTimezone: true }),
  /** INCLUSAO: 'E' entrada ou 'S' saída. */
  tpMarc: char('tp_marc', { length: 1 }),
  /** DESCONSIDERAR: qual marcação original. */
  marcacaoId: uuid('marcacao_id').references(() => pontoMarcacao.id),
  observacao: varchar('observacao', { length: 400 }).notNull(),
  status: varchar('status', { length: 12 }).notNull().default('EM_ANALISE').$type<StatusAjuste>(),
  origem: varchar('origem', { length: 12 }).notNull().default('FUNCIONARIO'),
  motivoDecisao: varchar('motivo_decisao', { length: 200 }),
  decididoPor: varchar('decidido_por', { length: 160 }),
  decididoEm: timestamp('decidido_em', { withTimezone: true }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});
