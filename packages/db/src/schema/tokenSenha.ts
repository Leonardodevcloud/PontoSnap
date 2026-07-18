import { pgTable, uuid, varchar, timestamp, index } from 'drizzle-orm/pg-core';
import { usuario } from './usuario';

/**
 * Token de redefinição de senha, de uso único e vida curta.
 *
 * Guardamos só o HASH do token (SHA-256), nunca o valor cru — se o banco
 * vazar, ninguém redefine senha com o que está aqui. O token cru só existe no
 * link que vai por e-mail. Sem tenant: a recuperação é anterior ao contexto de
 * tenant, igual ao login.
 */
export const tokenSenha = pgTable('token_senha', {
  id: uuid('id').primaryKey().defaultRandom(),
  usuarioId: uuid('usuario_id').notNull().references(() => usuario.id),
  /** SHA-256 do token em hex. O cru vai no e-mail e não é recuperável. */
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
  /** Marcado quando o token é usado — impede reuso. */
  usadoEm: timestamp('usado_em', { withTimezone: true }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  porHash: index('idx_token_senha_hash').on(t.tokenHash),
}));
