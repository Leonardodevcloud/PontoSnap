import { pgTable, uuid, varchar, integer, timestamp, customType, index, unique } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';
import { empregado } from './empregado';
import { usuario } from './usuario';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/**
 * Holerite (recibo de pagamento) recortado do PDF único que a contabilidade
 * manda com todo mundo junto, e entregue ao funcionário certo (casado por CPF).
 *
 * É dado financeiro pessoal, então, como os atestados:
 *  - o arquivo é cifrado em repouso (AES-256-GCM, ver CriptoService);
 *  - a RLS isola por tenant;
 *  - só o RH do próprio cliente e o dono do holerite conseguem baixar.
 *
 * Um holerite por (tenant, empregado, competência) — reimportar substitui.
 */
export const pontoHolerite = pgTable('ponto_holerite', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  empregadoId: uuid('empregado_id').notNull().references(() => empregado.id),
  /** Competência AAAA-MM (ex.: 2026-10). */
  competencia: varchar('competencia', { length: 7 }).notNull(),
  arquivo: bytea('arquivo').notNull(),
  arquivoNome: varchar('arquivo_nome', { length: 120 }).notNull(),
  /** Tamanho original, antes de cifrar — para mostrar na tela. */
  arquivoBytes: integer('arquivo_bytes').notNull(),
  /** Líquido a receber lido do holerite, em centavos. Só exibição; nulo se não leu. */
  liquidoCentavos: integer('liquido_centavos'),
  /** Total de Proventos (bruto) lido do holerite, em centavos. Só exibição; nulo se não leu. */
  brutoCentavos: integer('bruto_centavos'),
  enviadoEm: timestamp('enviado_em', { withTimezone: true }).notNull().defaultNow(),
  enviadoPor: uuid('enviado_por').references(() => usuario.id),
  /** Pagamento do líquido via Pix (RH marca pago). Nulo = ainda não pago. */
  pagoEm: timestamp('pago_em', { withTimezone: true }),
  pagoPor: uuid('pago_por').references(() => usuario.id),
  valorPagoCentavos: integer('valor_pago_centavos'),
}, (t) => ({
  uq: unique('uq_holerite_comp').on(t.tenantId, t.empregadoId, t.competencia),
  porEmpregado: index('idx_holerite_empregado').on(t.tenantId, t.empregadoId, t.competencia),
}));
