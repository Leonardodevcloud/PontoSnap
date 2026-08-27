import { pgTable, uuid, date, timestamp, index } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';
import { empregado } from './empregado';
import { pontoHorarioContratual } from './tratamento';

/**
 * Histórico de qual escala valia para um funcionário em cada período.
 * data_fim nulo = vigência aberta (escala atual). A apuração escolhe, por dia,
 * a vigência que contém aquela data.
 */
export const empregadoEscalaVigencia = pgTable('empregado_escala_vigencia', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  empregadoId: uuid('empregado_id').notNull().references(() => empregado.id),
  horarioContratualId: uuid('horario_contratual_id').notNull().references(() => pontoHorarioContratual.id),
  dataInicio: date('data_inicio').notNull(),
  dataFim: date('data_fim'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('ix_escala_vig_emp').on(t.empregadoId, t.dataInicio),
]);
