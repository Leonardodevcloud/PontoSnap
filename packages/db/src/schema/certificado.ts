import { pgTable, uuid, text, varchar, boolean, timestamp, unique } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';

/** Certificado ICP-Brasil (A1) do tenant, cifrado em repouso (AES-256-GCM). */
export const certificado = pgTable('certificado', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  pfxCifrado: text('pfx_cifrado').notNull(),
  senhaCifrada: text('senha_cifrada').notNull(),
  cn: varchar('cn', { length: 200 }),
  validade: timestamp('validade', { withTimezone: true }),
  ativo: boolean('ativo').notNull().default(true),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('uq_certificado_tenant').on(t.tenantId)]);
