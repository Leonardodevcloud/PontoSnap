import { pgTable, uuid, varchar, integer, numeric, boolean, date, text, timestamp, jsonb, unique, index, customType } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';
import { empregado } from './empregado';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/**
 * Gestão de Pessoal (migration 0038). CLT vem da tabela empregado; aqui fica
 * só o que o ponto não tem. Prestadores (MEI/motorista) são cadastro próprio.
 */
export const pessoalCltConfig = pgTable('pessoal_clt_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  empregadoId: uuid('empregado_id').notNull().references(() => empregado.id),
  cargo: varchar('cargo', { length: 80 }),
  vrDia: numeric('vr_dia', { precision: 10, scale: 2 }).notNull().default('0'),
  cestaMensal: numeric('cesta_mensal', { precision: 10, scale: 2 }).notNull().default('0'),
  /** NENHUM | DIA | FIXO */
  vtTipo: varchar('vt_tipo', { length: 8 }).notNull().default('NENHUM'),
  vtValor: numeric('vt_valor', { precision: 10, scale: 2 }).notNull().default('0'),
  chavePix: varchar('chave_pix', { length: 120 }),
  /** Competência (mês do benefício) a partir da qual esta linha vale. */
  vigenteDesde: varchar('vigente_desde', { length: 7 }).notNull().default('2000-01'),
  /** true = a partir daqui segue o padrão da empresa (pessoal_padrao). */
  usaPadrao: boolean('usa_padrao').notNull().default(false),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('uq_pessoal_clt_config_vig').on(t.tenantId, t.empregadoId, t.vigenteDesde)]);

/** Valor padrão de benefício da empresa, com vigência (migration 0039). */
export const pessoalPadrao = pgTable('pessoal_padrao', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  vigenteDesde: varchar('vigente_desde', { length: 7 }).notNull(),
  vrDia: numeric('vr_dia', { precision: 10, scale: 2 }).notNull().default('0'),
  cestaMensal: numeric('cesta_mensal', { precision: 10, scale: 2 }).notNull().default('0'),
  vtTipo: varchar('vt_tipo', { length: 8 }).notNull().default('NENHUM'),
  vtValor: numeric('vt_valor', { precision: 10, scale: 2 }).notNull().default('0'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('uq_pessoal_padrao').on(t.tenantId, t.vigenteDesde)]);

export const pessoalPrestador = pgTable('pessoal_prestador', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  /** MEI | MOTORISTA */
  tipo: varchar('tipo', { length: 10 }).notNull(),
  nome: varchar('nome', { length: 80 }).notNull(),
  documento: varchar('documento', { length: 20 }),
  funcao: varchar('funcao', { length: 80 }),
  valorMensal: numeric('valor_mensal', { precision: 12, scale: 2 }).notNull().default('0'),
  /** SEG_SAB | SEG_SEX */
  baseDias: varchar('base_dias', { length: 8 }).notNull().default('SEG_SAB'),
  chavePix: varchar('chave_pix', { length: 120 }),
  competenciaInicio: varchar('competencia_inicio', { length: 7 }).notNull(),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('idx_pessoal_prestador_tenant').on(t.tenantId, t.tipo)]);

export const pessoalExclusao = pgTable('pessoal_exclusao', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  pessoaTipo: varchar('pessoa_tipo', { length: 10 }).notNull(),
  pessoaId: uuid('pessoa_id').notNull(),
  competencia: varchar('competencia', { length: 7 }).notNull(),
  /** MES (só aquele mês) | DIANTE (daquele mês em diante) */
  escopo: varchar('escopo', { length: 8 }).notNull(),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('uq_pessoal_exclusao').on(t.tenantId, t.pessoaTipo, t.pessoaId, t.competencia)]);

export const pessoalLancamento = pgTable('pessoal_lancamento', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  pessoaTipo: varchar('pessoa_tipo', { length: 10 }).notNull(),
  pessoaId: uuid('pessoa_id').notNull(),
  competencia: varchar('competencia', { length: 7 }).notNull(),
  /** MES ou início da semana (YYYY-MM-DD) para motoristas */
  periodo: varchar('periodo', { length: 10 }).notNull().default('MES'),
  heMin: integer('he_min').notNull().default(0),
  faltas: integer('faltas').notNull().default(0),
  feriadosTrab: integer('feriados_trab').notNull().default(0),
  dias: integer('dias'),
  adicional: numeric('adicional', { precision: 12, scale: 2 }).notNull().default('0'),
  meta: numeric('meta', { precision: 12, scale: 2 }).notNull().default('0'),
  metaPaga: boolean('meta_paga').notNull().default(false),
  metaPagaEm: date('meta_paga_em'),
  nfNumero: varchar('nf_numero', { length: 60 }),
  nfData: date('nf_data'),
  pago: boolean('pago').notNull().default(false),
  observacao: text('observacao'),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('uq_pessoal_lancamento').on(t.tenantId, t.pessoaTipo, t.pessoaId, t.competencia, t.periodo),
  index('idx_pessoal_lancamento_comp').on(t.tenantId, t.competencia),
]);

export const pessoalDebito = pgTable('pessoal_debito', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  pessoaTipo: varchar('pessoa_tipo', { length: 10 }).notNull(),
  pessoaId: uuid('pessoa_id').notNull(),
  descricao: varchar('descricao', { length: 120 }).notNull(),
  valorTotal: numeric('valor_total', { precision: 12, scale: 2 }).notNull(),
  parcelas: integer('parcelas').notNull().default(1),
  competenciaInicio: varchar('competencia_inicio', { length: 7 }).notNull(),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('idx_pessoal_debito_tenant').on(t.tenantId)]);

export const pessoalFechamento = pgTable('pessoal_fechamento', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  competencia: varchar('competencia', { length: 7 }).notNull(),
  fechadoEm: timestamp('fechado_em', { withTimezone: true }).notNull().defaultNow(),
  snapshot: jsonb('snapshot').notNull(),
}, (t) => [unique('uq_pessoal_fechamento').on(t.tenantId, t.competencia)]);

/** Valor do contrato do prestador com vigência (migration 0040). */
export const pessoalPrestadorValor = pgTable('pessoal_prestador_valor', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  prestadorId: uuid('prestador_id').notNull().references(() => pessoalPrestador.id),
  vigenteDesde: varchar('vigente_desde', { length: 7 }).notNull(),
  valorMensal: numeric('valor_mensal', { precision: 12, scale: 2 }).notNull(),
  baseDias: varchar('base_dias', { length: 8 }).notNull().default('SEG_SAB'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('uq_pessoal_prestador_valor').on(t.tenantId, t.prestadorId, t.vigenteDesde)]);

/** Mês a partir do qual a cesta básica é paga (carência) — migration 0042. */
export const pessoalCltCesta = pgTable('pessoal_clt_cesta', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  empregadoId: uuid('empregado_id').notNull().references(() => empregado.id),
  cestaDesde: varchar('cesta_desde', { length: 7 }).notNull(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('uq_pessoal_clt_cesta').on(t.tenantId, t.empregadoId)]);

/** Arquivo da NF (cifrado) — migration 0043. Um por pessoa + competência + período. */
export const pessoalNfArquivo = pgTable('pessoal_nf_arquivo', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  pessoaTipo: varchar('pessoa_tipo', { length: 10 }).notNull(),
  pessoaId: uuid('pessoa_id').notNull(),
  competencia: varchar('competencia', { length: 7 }).notNull(),
  periodo: varchar('periodo', { length: 10 }).notNull().default('MES'),
  arquivo: bytea('arquivo').notNull(),
  arquivoNome: varchar('arquivo_nome', { length: 160 }).notNull(),
  arquivoMime: varchar('arquivo_mime', { length: 80 }).notNull(),
  arquivoBytes: integer('arquivo_bytes').notNull(),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('uq_pessoal_nf_arquivo').on(t.tenantId, t.pessoaTipo, t.pessoaId, t.competencia, t.periodo),
  index('idx_pessoal_nf_arquivo_comp').on(t.tenantId, t.competencia),
]);
