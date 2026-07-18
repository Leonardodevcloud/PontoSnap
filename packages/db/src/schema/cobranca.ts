import { pgTable, uuid, varchar, integer, numeric, timestamp, date, index } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';

/**
 * Cobrança do SaaS: o MASTER cobra as empresas (tenants).
 *
 * Três tabelas:
 *  - plano: catálogo reutilizável (atalho para os casos repetidos)
 *  - assinatura: o vínculo de cada empresa com um plano, PODENDO sobrescrever
 *    valor e vencimento — o plano é sugestão, não jaula
 *  - cobranca: cada mensalidade gerada, com seu status de pagamento (o extrato)
 *
 * Sem gateway: boletos são emitidos por fora e o MASTER anexa o link/registra
 * o pagamento na mão. Nada aqui move dinheiro — só controla quem deve o quê.
 */

/** Como o valor é calculado. */
export const MODO_COBRANCA = ['FIXO', 'POR_FUNCIONARIO'] as const;
export type ModoCobranca = (typeof MODO_COBRANCA)[number];

/** Situação de uma cobrança mensal. */
export const STATUS_COBRANCA = ['ABERTA', 'PAGA', 'ATRASADA', 'CANCELADA'] as const;
export type StatusCobranca = (typeof STATUS_COBRANCA)[number];

/** Catálogo de planos — reutilizável entre empresas. */
export const plano = pgTable('plano', {
  id: uuid('id').primaryKey().defaultRandom(),
  nome: varchar('nome', { length: 80 }).notNull(),
  modo: varchar('modo', { length: 16 }).notNull().default('FIXO'),
  /** FIXO: mensalidade cheia. POR_FUNCIONARIO: preço de cada funcionário ativo. */
  valor: numeric('valor', { precision: 10, scale: 2 }).notNull(),
  /** Só informativo, ajuda o MASTER a escolher (ex.: "até 20 funcionários"). */
  descricao: varchar('descricao', { length: 160 }),
  ativo: varchar('ativo', { length: 3 }).notNull().default('sim'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

/** Assinatura de uma empresa. Um tenant tem no máximo uma assinatura ativa. */
export const assinatura = pgTable('assinatura', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id).unique(),
  /** Plano de base. Pode ser null se o preço é 100% avulso desta empresa. */
  planoId: uuid('plano_id').references(() => plano.id),
  /**
   * Sobrescritas por empresa. Quando null, herda do plano. Assim o plano é um
   * atalho e cada contrato pode ter seu próprio valor negociado.
   */
  modoOverride: varchar('modo_override', { length: 16 }),
  valorOverride: numeric('valor_override', { precision: 10, scale: 2 }),
  /** Dia do mês em que vence (1–28, limitado a 28 p/ existir em todo mês). */
  diaVencimento: integer('dia_vencimento').notNull().default(10),
  /** ativa | suspensa | cancelada. "suspensa" é marcador visual, não corta acesso. */
  situacao: varchar('situacao', { length: 12 }).notNull().default('ativa'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  porTenant: index('idx_assinatura_tenant').on(t.tenantId),
}));

/** Uma mensalidade. Nasce por competência (AAAA-MM) e caminha até PAGA. */
export const cobranca = pgTable('cobranca', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  /** Competência no formato AAAA-MM (o mês a que a cobrança se refere). */
  competencia: varchar('competencia', { length: 7 }).notNull(),
  valor: numeric('valor', { precision: 10, scale: 2 }).notNull(),
  /** Quantos funcionários ativos no momento da geração (auditoria do cálculo). */
  qtdFuncionarios: integer('qtd_funcionarios'),
  vencimento: date('vencimento').notNull(),
  status: varchar('status', { length: 12 }).notNull().default('ABERTA'),
  /** Link do boleto que o MASTER emitiu por fora e anexou. */
  boletoUrl: varchar('boleto_url', { length: 500 }),
  pagoEm: timestamp('pago_em', { withTimezone: true }),
  /** Empresa clicou "já paguei" — sinaliza pro MASTER conferir. Não muda status. */
  avisoPagamentoEm: timestamp('aviso_pagamento_em', { withTimezone: true }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  porTenant: index('idx_cobranca_tenant').on(t.tenantId, t.competencia),
}));
