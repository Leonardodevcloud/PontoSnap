import { boolean, integer, pgTable, text, timestamp, uuid, varchar, unique } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';
import { usuario } from './usuario';
import { empregado } from './empregado';

/** Subscription push de um dispositivo (navegador) de um usuário. */
export const pushSubscription = pgTable('push_subscription', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  usuarioId: uuid('usuario_id').notNull().references(() => usuario.id),
  endpoint: text('endpoint').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  dispositivo: varchar('dispositivo', { length: 200 }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  /** Saúde do aparelho (migration 0054): última entrega aceita e último erro. */
  ultimoSucessoEm: timestamp('ultimo_sucesso_em', { withTimezone: true }),
  ultimoErro: varchar('ultimo_erro', { length: 200 }),
  ultimoErroEm: timestamp('ultimo_erro_em', { withTimezone: true }),
}, (t) => [unique().on(t.usuarioId, t.endpoint)]);

/** Preferências de notificação de um empregado. */
export const notificacaoPreferencia = pgTable('notificacao_preferencia', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  empregadoId: uuid('empregado_id').notNull().references(() => empregado.id),
  lembreteAntes: boolean('lembrete_antes').notNull().default(true),
  lembreteMinutos: integer('lembrete_minutos').notNull().default(10),
  esqueceuEntrada: boolean('esqueceu_entrada').notNull().default(true),
  esqueceuAlmoco: boolean('esqueceu_almoco').notNull().default(true),
  esqueceuSaida: boolean('esqueceu_saida').notNull().default(true),
  ajusteRespondido: boolean('ajuste_respondido').notNull().default(true),
  atestadoAnalisado: boolean('atestado_analisado').notNull().default(true),
  espelhoDisponivel: boolean('espelho_disponivel').notNull().default(true),
  resumoSemanal: boolean('resumo_semanal').notNull().default(false),
  bancoVencendo: boolean('banco_vencendo').notNull().default(true),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.empregadoId)]);

/**
 * Notificação enviada (migration 0054). A chave é única por usuário: o mesmo
 * lembrete não sai duas vezes, mesmo com o cron rodando em mais de uma instância.
 */
export const notificacaoEnvio = pgTable('notificacao_envio', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  usuarioId: uuid('usuario_id').notNull().references(() => usuario.id),
  empregadoId: uuid('empregado_id').references(() => empregado.id),
  tipo: varchar('tipo', { length: 30 }).notNull(),
  chave: varchar('chave', { length: 160 }).notNull(),
  titulo: varchar('titulo', { length: 160 }).notNull(),
  dispositivos: integer('dispositivos').notNull().default(0),
  entregues: integer('entregues').notNull().default(0),
  erro: varchar('erro', { length: 200 }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('uq_notificacao_envio').on(t.usuarioId, t.chave)]);
