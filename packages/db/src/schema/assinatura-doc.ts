import { pgTable, uuid, varchar, integer, boolean, date, text, timestamp, unique, index, customType } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';
import { empregado } from './empregado';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/** Integração com a Autentique (assinatura eletrônica), uma por empresa (migration 0060). */
export const integracaoAutentique = pgTable('integracao_autentique', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenant.id),
  /** Token da API, cifrado (CriptoService). */
  token: text('token').notNull(),
  contaNome: varchar('conta_nome', { length: 160 }),
  contaEmail: varchar('conta_email', { length: 160 }),
  /** Modo de teste: documentos sem validade e sem gastar crédito. */
  sandbox: boolean('sandbox').notNull().default(true),
  mostrarApp: boolean('mostrar_app').notNull().default(true),
  /** Parte secreta da URL do webhook (identifica a empresa). */
  webhookToken: varchar('webhook_token', { length: 48 }).notNull().unique(),
  /** Segredo HMAC do webhook (cifrado), se configurado no painel da Autentique. */
  webhookSegredo: text('webhook_segredo'),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

export type StatusAssinatura = 'RASCUNHO' | 'ENVIADO' | 'VISUALIZADO' | 'ASSINADO' | 'RECUSADO' | 'CANCELADO' | 'ERRO';

/** Documento (espelho ou contracheque) de um funcionário no mês, enviado para assinar. */
export const assinaturaDocumento = pgTable('assinatura_documento', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  empregadoId: uuid('empregado_id').notNull().references(() => empregado.id),
  competencia: varchar('competencia', { length: 7 }).notNull(),
  /** ESPELHO | CONTRACHEQUE */
  tipo: varchar('tipo', { length: 14 }).notNull(),
  status: varchar('status', { length: 12 }).notNull().default('RASCUNHO'),
  arquivo: bytea('arquivo').notNull(),
  arquivoNome: varchar('arquivo_nome', { length: 160 }).notNull(),
  arquivoBytes: integer('arquivo_bytes').notNull(),
  hashSha256: varchar('hash_sha256', { length: 64 }).notNull(),
  autentiqueId: varchar('autentique_id', { length: 80 }),
  assinaturaPublicId: varchar('assinatura_public_id', { length: 80 }),
  /** EMAIL | WHATSAPP | APP */
  canal: varchar('canal', { length: 10 }),
  sandbox: boolean('sandbox').notNull().default(false),
  lembrete: varchar('lembrete', { length: 8 }),
  prazo: date('prazo', { mode: 'string' }),
  enviadoEm: timestamp('enviado_em', { withTimezone: true }),
  enviadoPor: varchar('enviado_por', { length: 160 }),
  visualizadoEm: timestamp('visualizado_em', { withTimezone: true }),
  assinadoEm: timestamp('assinado_em', { withTimezone: true }),
  recusadoEm: timestamp('recusado_em', { withTimezone: true }),
  motivoRecusa: text('motivo_recusa'),
  erro: text('erro'),
  arquivoAssinado: bytea('arquivo_assinado'),
  sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('uq_assinatura_documento').on(t.tenantId, t.empregadoId, t.competencia, t.tipo),
  index('idx_assinatura_documento_comp').on(t.tenantId, t.competencia),
]);

/** Contracheque subido em lote, aguardando o RH confirmar de quem é. */
export const assinaturaUpload = pgTable('assinatura_upload', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  competencia: varchar('competencia', { length: 7 }).notNull(),
  arquivo: bytea('arquivo').notNull(),
  arquivoNome: varchar('arquivo_nome', { length: 160 }).notNull(),
  arquivoBytes: integer('arquivo_bytes').notNull(),
  sugestaoEmpregadoId: uuid('sugestao_empregado_id'),
  /** CPF | NOME | CPF_PDF | NOME_PDF */
  como: varchar('como', { length: 10 }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});
