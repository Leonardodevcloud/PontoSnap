import { pgTable, uuid, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';
import { usuario, perfilEnum } from './usuario';

/**
 * Acesso multi-empresa: quais CNPJs um usuário administra, e com qual papel
 * em cada um. O usuario.tenantId segue como a empresa padrão (onde a sessão
 * começa). Só ADMIN_CLIENTE e RH — colaborador pertence a uma empresa só.
 */
export const usuarioTenant = pgTable('usuario_tenant', {
  id: uuid('id').primaryKey().defaultRandom(),
  usuarioId: uuid('usuario_id').notNull().references(() => usuario.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  perfil: perfilEnum('perfil').notNull(),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uq: uniqueIndex('uq_usuario_tenant').on(t.usuarioId, t.tenantId),
}));
