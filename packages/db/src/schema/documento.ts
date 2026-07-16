import { pgTable, uuid, varchar, integer, date, timestamp, customType, index } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';
import { empregado } from './empregado';
import { usuario } from './usuario';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/**
 * Atestados e declarações que o funcionário envia para justificar ausência.
 *
 * NÃO entra no AEJ: o registro tipo 07 só aceita DSR, falta não justificada,
 * banco de horas e folga compensatória de feriado — não existe código para
 * atestado. Abonar, no arquivo fiscal, é simplesmente NÃO gravar falta.
 *
 * Atestado com CID é dado pessoal SENSÍVEL (saúde) na LGPD. Por isso:
 *  - o arquivo é cifrado em repouso (AES-256-GCM, ver CriptoService);
 *  - a RLS isola por tenant, como em todo o resto;
 *  - só o RH do próprio cliente e o dono do documento conseguem baixar.
 */
export const pontoDocumento = pgTable('ponto_documento', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  empregadoId: uuid('empregado_id').notNull().references(() => empregado.id),
  /** ATESTADO | COMPARECIMENTO */
  tipo: varchar('tipo', { length: 16 }).notNull(),
  dataInicio: date('data_inicio').notNull(),
  dataFim: date('data_fim').notNull(),
  /** null = dia inteiro (abona a jornada do dia). N = abono parcial, em minutos. */
  minutos: integer('minutos'),
  /** EM_ANALISE | ABONADO | RECUSADO */
  status: varchar('status', { length: 12 }).notNull().default('EM_ANALISE'),
  motivoRecusa: varchar('motivo_recusa', { length: 200 }),
  arquivo: bytea('arquivo').notNull(),
  arquivoNome: varchar('arquivo_nome', { length: 120 }).notNull(),
  arquivoMime: varchar('arquivo_mime', { length: 60 }).notNull(),
  /** Tamanho original, antes de cifrar — para mostrar na tela. */
  arquivoBytes: integer('arquivo_bytes').notNull(),
  enviadoEm: timestamp('enviado_em', { withTimezone: true }).notNull().defaultNow(),
  analisadoEm: timestamp('analisado_em', { withTimezone: true }),
  analisadoPor: uuid('analisado_por').references(() => usuario.id),
}, (t) => ({
  porEmpregado: index('idx_documento_empregado').on(t.tenantId, t.empregadoId, t.dataInicio),
}));
