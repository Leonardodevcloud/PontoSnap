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
  /** Dias da semana em home office, sem VT ("6" = sábado; vírgula separa). Vazio = todos presenciais. */
  vtSemDias: varchar('vt_sem_dias', { length: 20 }).notNull().default(''),
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
  /** Empresa para quem presta o serviço (texto livre). */
  empresa: varchar('empresa', { length: 120 }),
  /** Data real em que começou a prestar serviço (pode ser antes de usar o sistema). */
  inicioAtividade: date('inicio_atividade'),
  competenciaInicio: varchar('competencia_inicio', { length: 7 }).notNull(),
  /** Variação da caricatura (prestador não tem foto). Nulo = derivada do id. */
  avatarSemente: integer('avatar_semente'),
  /** Contato para o portal (convite por WhatsApp/e-mail) — migration 0057. */
  telefone: varchar('telefone', { length: 20 }),
  email: varchar('email', { length: 180 }),
  /** Tomador da nota. Vazio = razão social e CNPJ da empresa. */
  tomadorNome: varchar('tomador_nome', { length: 160 }),
  tomadorCnpj: varchar('tomador_cnpj', { length: 14 }),
  /** Atualização cadastral feita pelo próprio prestador no app (foto + dados) — migration 0058. */
  cadastroAtualizadoEm: timestamp('cadastro_atualizado_em', { withTimezone: true }),
  contatoEmergencia: varchar('contato_emergencia', { length: 160 }),
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
  /** Quanto foi de fato pago e quando (registrado ao marcar "pago"). */
  valorPago: numeric('valor_pago', { precision: 12, scale: 2 }),
  pagoEm: timestamp('pago_em', { withTimezone: true }),
  /** Motorista: parte dos débitos do mês descontada nesta semana. */
  debitoAplicado: numeric('debito_aplicado', { precision: 12, scale: 2 }).notNull().default('0'),
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
  /** Parcelas pagas antes de lançar (débito retroativo). competenciaInicio = a da parcela seguinte. */
  parcelasPagas: integer('parcelas_pagas').notNull().default(0),
  /** PARCELADO (valor total em N parcelas) | FIXO (valor_total = valor do mês, todo mês até encerrar). */
  tipo: varchar('tipo', { length: 10 }).notNull().default('PARCELADO'),
  /** Último mês com desconto (FIXO encerrado). Nulo = sem fim. */
  competenciaFim: varchar('competencia_fim', { length: 7 }),
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

/**
 * Fechamento de UMA pessoa no mês (migration 0059): ex. desligamento. Congela
 * a linha dela; o fechamento do mês usa esta linha em vez de recalcular.
 */
export const pessoalFechamentoPessoa = pgTable('pessoal_fechamento_pessoa', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  competencia: varchar('competencia', { length: 7 }).notNull(),
  pessoaTipo: varchar('pessoa_tipo', { length: 10 }).notNull(),
  pessoaId: uuid('pessoa_id').notNull(),
  /** DESLIGAMENTO | ANTECIPADO */
  motivo: varchar('motivo', { length: 14 }).notNull(),
  ultimoDia: date('ultimo_dia', { mode: 'string' }),
  proporcional: boolean('proporcional').notNull().default(false),
  debitosFuturos: numeric('debitos_futuros', { precision: 12, scale: 2 }).notNull().default('0'),
  linha: jsonb('linha').notNull(),
  exclusaoId: uuid('exclusao_id'),
  cortarAcesso: boolean('cortar_acesso').notNull().default(false),
  fechadoEm: timestamp('fechado_em', { withTimezone: true }).notNull().defaultNow(),
  fechadoPor: varchar('fechado_por', { length: 160 }),
}, (t) => [unique('uq_pessoal_fechamento_pessoa').on(t.tenantId, t.competencia, t.pessoaTipo, t.pessoaId)]);

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

/** Link de primeiro acesso do prestador (migration 0057). Uso único, vale 7 dias. */
export const prestadorConvite = pgTable('prestador_convite', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  prestadorId: uuid('prestador_id').notNull().references(() => pessoalPrestador.id),
  codigo: varchar('codigo', { length: 16 }).notNull().unique(),
  expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
  usadoEm: timestamp('usado_em', { withTimezone: true }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

/** Linha do "como chegou nesse valor" que o prestador vê. */
export interface LinhaDetalheNota { rotulo: string; valorCent: number; tipo?: 'BASE' | 'MAIS' | 'MENOS' }
/** Conferência automática da nota enviada (o que deu para checar). */
export interface ConferenciaNota {
  arquivo: 'PDF' | 'XML' | 'FOTO';
  /** De onde vieram número/valor: lidos do XML ou do PDF da NFS-e, ou informados pelo prestador. */
  origem: 'XML' | 'PDF' | 'INFORMADO';
  valorBate: boolean | null; numeroRepetido: boolean; competenciaOk: boolean | null;
  tomadorOk: boolean | null; prestadorOk: boolean | null;
  lido?: { numero?: string | null; data?: string | null; valorCent?: number | null; cnpjTomador?: string | null; cnpjPrestador?: string | null; chave?: string | null };
  bate: boolean;
}

/**
 * Valor liberado para o prestador emitir a nota (migration 0057). Retrato do
 * fechamento (MEI: mês; motorista: semana). Situação: AGUARDANDO → ENVIADA →
 * APROVADA, ou RECUSADA (com motivo) → ENVIADA de novo.
 */
export const pessoalNota = pgTable('pessoal_nota', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  pessoaTipo: varchar('pessoa_tipo', { length: 10 }).notNull(),
  pessoaId: uuid('pessoa_id').notNull().references(() => pessoalPrestador.id),
  competencia: varchar('competencia', { length: 7 }).notNull(),
  periodo: varchar('periodo', { length: 10 }).notNull().default('MES'),
  valorCent: integer('valor_cent').notNull(),
  detalhe: jsonb('detalhe').$type<LinhaDetalheNota[]>().notNull().default([]),
  versao: integer('versao').notNull().default(1),
  liberadoEm: timestamp('liberado_em', { withTimezone: true }).notNull().defaultNow(),
  prazo: date('prazo'),
  pedirConfirmacao: boolean('pedir_confirmacao').notNull().default(false),
  /** AGUARDANDO | ENVIADA | APROVADA | RECUSADA */
  status: varchar('status', { length: 12 }).notNull().default('AGUARDANDO'),
  vistoEm: timestamp('visto_em', { withTimezone: true }),
  /** CONFERE | CONTESTOU */
  confirmacao: varchar('confirmacao', { length: 10 }),
  confirmadoEm: timestamp('confirmado_em', { withTimezone: true }),
  contestacao: text('contestacao'),
  resposta: text('resposta'),
  respondidoEm: timestamp('respondido_em', { withTimezone: true }),
  enviadaEm: timestamp('enviada_em', { withTimezone: true }),
  nfValorCent: integer('nf_valor_cent'),
  conferencia: jsonb('conferencia').$type<ConferenciaNota>(),
  conferidaEm: timestamp('conferida_em', { withTimezone: true }),
  conferidaPor: varchar('conferida_por', { length: 160 }),
  motivoRecusa: text('motivo_recusa'),
  lembreteEm: timestamp('lembrete_em', { withTimezone: true }),
  lembretes: integer('lembretes').notNull().default(0),
}, (t) => [
  unique('uq_pessoal_nota').on(t.tenantId, t.pessoaTipo, t.pessoaId, t.competencia, t.periodo),
  index('idx_pessoal_nota_pessoa').on(t.tenantId, t.pessoaId),
]);
