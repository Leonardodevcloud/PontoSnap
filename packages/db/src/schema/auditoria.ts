import { pgTable, uuid, varchar, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';
import { usuario } from './usuario';

/**
 * Trilha de auditoria: quem fez o quê, quando.
 *
 * Num produto de conformidade isto não é opcional. O RH tem poder de tratar
 * marcação, abonar atestado e lançar afastamento — e numa fiscalização ou num
 * processo trabalhista a pergunta "quem alterou isso?" tem que ter resposta.
 *
 * Append-only por convenção: um gatilho impede UPDATE e DELETE, do mesmo jeito
 * que protege as marcações. Trilha que pode ser editada não é trilha.
 */
export const auditoria = pgTable('auditoria', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenant.id),
  /** Quem agiu. Null só para ações do MASTER (que não tem tenant). */
  usuarioId: uuid('usuario_id').references(() => usuario.id),
  usuarioEmail: varchar('usuario_email', { length: 160 }),
  usuarioPerfil: varchar('usuario_perfil', { length: 20 }),
  /** Verbo + recurso, ex.: "POST /afastamentos", "POST /documentos/:id/decidir". */
  acao: varchar('acao', { length: 120 }).notNull(),
  metodo: varchar('metodo', { length: 8 }).notNull(),
  rota: varchar('rota', { length: 200 }).notNull(),
  /** Corpo da requisição, sem campos sensíveis (senha, arquivo, base64). */
  detalhe: jsonb('detalhe'),
  /** Status HTTP da resposta — distingue tentativa de ação efetivada. */
  statusHttp: varchar('status_http', { length: 4 }),
  ip: varchar('ip', { length: 45 }),
  em: timestamp('em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  porTenant: index('idx_auditoria_tenant').on(t.tenantId, t.em),
  porUsuario: index('idx_auditoria_usuario').on(t.usuarioId, t.em),
}));
