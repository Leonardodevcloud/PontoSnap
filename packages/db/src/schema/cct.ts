import { pgTable, uuid, varchar, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';

/** Convenção coletiva (CCT/ACT) de uma empresa, aplicada por funcionário. */
export const pontoCct = pgTable('ponto_cct', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  nome: varchar('nome', { length: 120 }).notNull(),
  uf: varchar('uf', { length: 2 }),
  vigencia: varchar('vigencia', { length: 60 }),
  // Horas extras
  extraDiaUtilPct: integer('extra_dia_util_pct').notNull().default(50),
  extraDomingoFeriadoPct: integer('extra_domingo_feriado_pct').notNull().default(100),
  extraLimiteDiarioMin: integer('extra_limite_diario_min').notNull().default(120),
  // Tolerância
  toleranciaDiariaMin: integer('tolerancia_diaria_min').notNull().default(10),
  toleranciaPorMarcacaoMin: integer('tolerancia_por_marcacao_min').notNull().default(5),
  // Adicional noturno
  noturnoAdicionalPct: integer('noturno_adicional_pct').notNull().default(20),
  noturnoReduzida: boolean('noturno_reduzida').notNull().default(true),
  noturnoInicioMin: integer('noturno_inicio_min').notNull().default(1320),
  noturnoFimMin: integer('noturno_fim_min').notNull().default(300),
  // Jornada
  jornadaSemanalMin: integer('jornada_semanal_min').notNull().default(2640),
  interjornadaMinimaMin: integer('interjornada_minima_min').notNull().default(660),
  intervaloMaior6hMin: integer('intervalo_maior6h_min').notNull().default(60),
  // Banco de horas (prazo do acordo em meses; nulo = usa a config da empresa)
  bancoPrazoMeses: integer('banco_prazo_meses'),
  // HERDA (usa a empresa) | ATIVO (banco ligado) | INATIVO (banco desligado)
  bancoModo: varchar('banco_modo', { length: 8 }).notNull().default('HERDA'),
  bancoTipoAcordo: varchar('banco_tipo_acordo', { length: 12 }),
  ativa: boolean('ativa').notNull().default(true),
  padrao: boolean('padrao').notNull().default(false),
  // Destinação: DESCONTA | BANCO | ABONA (faltas) / DESCONTA | BANCO | TOLERA (atrasos)
  destinacaoFaltas: varchar('destinacao_faltas', { length: 10 }).notNull().default('DESCONTA'),
  destinacaoAtrasos: varchar('destinacao_atrasos', { length: 10 }).notNull().default('BANCO'),
  // BANCO_HORAS (acumula entre meses) | INTRA_MES (compensa no mês)
  formaCalculo: varchar('forma_calculo', { length: 12 }).notNull().default('BANCO_HORAS'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});
