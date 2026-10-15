import { pgTable, uuid, varchar, boolean, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';

export const perfilEnum = pgEnum('perfil', ['MASTER', 'ADMIN_CLIENTE', 'RH', 'COLABORADOR', 'PRESTADOR']);

/** Conta de acesso. MASTER tem tenant_id nulo (opera a plataforma). */
export const usuario = pgTable('usuario', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenant.id),
  email: varchar('email', { length: 180 }).notNull().unique(),
  senhaHash: varchar('senha_hash', { length: 120 }).notNull(),
  perfil: perfilEnum('perfil').notNull(),
  empregadoId: uuid('empregado_id'),
  /** Portal do prestador (migration 0057): o prestador (MEI/motorista) desta conta. */
  prestadorId: uuid('prestador_id'),
  /** CPF/CNPJ só com dígitos — login do prestador (que nem sempre tem e-mail). */
  documento: varchar('documento', { length: 14 }),
  ativo: boolean('ativo').notNull().default(true),
  deveTrocarSenha: boolean('deve_trocar_senha').notNull().default(false),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});
