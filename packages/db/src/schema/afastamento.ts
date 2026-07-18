import { pgTable, uuid, varchar, date, timestamp, index } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';
import { empregado } from './empregado';
import { usuario } from './usuario';

/**
 * Períodos em que o empregado não deve trabalhar: férias, afastamento pelo INSS,
 * licenças. Declarados pelo RH — diferente do atestado, que o funcionário envia.
 *
 * NÃO entra no AEJ: o registro tipo 07 só tem DSR, falta não justificada,
 * movimento de banco e folga compensatória de feriado. Férias não tem código.
 * O efeito é na apuração: o dia deixa de ser esperado, então não vira falta.
 */
export const pontoAfastamento = pgTable('ponto_afastamento', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  empregadoId: uuid('empregado_id').notNull().references(() => empregado.id),
  /** FERIAS | INSS | MATERNIDADE | PATERNIDADE | SUSPENSAO | OUTRO */
  tipo: varchar('tipo', { length: 16 }).notNull(),
  dataInicio: date('data_inicio').notNull(),
  dataFim: date('data_fim').notNull(),
  observacao: varchar('observacao', { length: 200 }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  criadoPor: uuid('criado_por').references(() => usuario.id),
}, (t) => ({
  porEmpregado: index('idx_afastamento_empregado').on(t.tenantId, t.empregadoId, t.dataInicio),
}));
