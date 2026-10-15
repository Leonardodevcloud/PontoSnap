import { boolean, customType, index, integer, jsonb, pgTable, primaryKey, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/** Um bloco do comunicado, na ordem em que o RH montou. */
export type BlocoComunicado =
  | { tipo: 'TEXTO'; texto: string }
  | { tipo: 'FOTOS'; midias: string[] }
  | { tipo: 'AUDIO'; midiaId: string; duracaoSeg: number; picos: number[] }
  | { tipo: 'VIDEO'; url: string; provedor: 'YOUTUBE' | 'VIMEO' | 'DRIVE'; videoId: string; titulo: string | null }
  | { tipo: 'ARQUIVO'; midiaId: string; nome: string; bytes: number }
  | BlocoEnquete;

/**
 * Enquete (no máximo uma por comunicado). Depois de publicada, pergunta e
 * opções não mudam (os votos apontam para os ids das opções).
 */
export interface BlocoEnquete {
  tipo: 'ENQUETE';
  pergunta: string;
  opcoes: { id: string; texto: string }[];
  /** Pode marcar mais de uma opção. */
  multipla: boolean;
  /** O funcionário vê o resultado parcial depois de votar. */
  mostrarResultado: boolean;
  /** O RH vê só os totais, não quem votou em quê. */
  anonima: boolean;
  /** Fim da votação (ISO). Nulo = sem prazo, até o RH encerrar. */
  encerraEm: string | null;
}

/**
 * Para quem vai: todos, por cliente/loja, por escala ou pessoas escolhidas.
 * grupo (só com TODOS): CLT, PRESTADORES ou TODOS. Sem grupo = CLT (comunicados
 * de antes do portal do prestador). Cliente e escala são só de CLT.
 */
export interface PublicoComunicado { tipo: 'TODOS' | 'CLIENTE' | 'ESCALA' | 'PESSOAS'; valores: string[]; grupo?: 'CLT' | 'PRESTADORES' | 'TODOS' }

/** Comunicação interna (migration 0055). */
export const comunicado = pgTable('comunicado', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  titulo: varchar('titulo', { length: 160 }).notNull(),
  blocos: jsonb('blocos').$type<BlocoComunicado[]>().notNull().default([]),
  publico: jsonb('publico').$type<PublicoComunicado>().notNull().default({ tipo: 'TODOS', valores: [] }),
  pedirCiencia: boolean('pedir_ciencia').notNull().default(false),
  fixado: boolean('fixado').notNull().default(false),
  notificar: boolean('notificar').notNull().default(true),
  lembrar: boolean('lembrar').notNull().default(true),
  reacoes: boolean('reacoes').notNull().default(true),
  /** RASCUNHO | AGENDADO | PUBLICADO | ARQUIVADO */
  status: varchar('status', { length: 10 }).notNull().default('RASCUNHO'),
  agendadoPara: timestamp('agendado_para', { withTimezone: true }),
  publicadoEm: timestamp('publicado_em', { withTimezone: true }),
  /** Quando saiu o lembrete automático de 24h (nulo = ainda não saiu). */
  lembreteEm: timestamp('lembrete_em', { withTimezone: true }),
  /** Quantas pessoas receberam a notificação no celular na publicação. */
  notificados: integer('notificados').notNull().default(0),
  autorId: uuid('autor_id'),
  autorNome: varchar('autor_nome', { length: 160 }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('idx_comunicado_tenant').on(t.tenantId, t.status, t.publicadoEm)]);

/** Quem recebeu e o que fez com o comunicado (comprovante de ciência). */
export const comunicadoDestinatario = pgTable('comunicado_destinatario', {
  comunicadoId: uuid('comunicado_id').notNull().references(() => comunicado.id, { onDelete: 'cascade' }),
  /** Pessoa: funcionário (empregado.id) ou prestador (pessoal_prestador.id) — migration 0057. */
  empregadoId: uuid('empregado_id').notNull(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  abertoEm: timestamp('aberto_em', { withTimezone: true }),
  midiaEm: timestamp('midia_em', { withTimezone: true }),
  cienteEm: timestamp('ciente_em', { withTimezone: true }),
  reacao: varchar('reacao', { length: 8 }),
}, (t) => [
  primaryKey({ columns: [t.comunicadoId, t.empregadoId] }),
  index('idx_comunicado_dest_emp').on(t.tenantId, t.empregadoId),
]);

/** Foto, áudio ou PDF de um comunicado. Vídeo é sempre por link. */
export const comunicadoMidia = pgTable('comunicado_midia', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  /** Nulo enquanto o comunicado ainda não foi salvo pela primeira vez. */
  comunicadoId: uuid('comunicado_id').references(() => comunicado.id, { onDelete: 'cascade' }),
  /** FOTO | AUDIO | ARQUIVO */
  tipo: varchar('tipo', { length: 10 }).notNull(),
  mime: varchar('mime', { length: 80 }).notNull(),
  nome: varchar('nome', { length: 160 }),
  bytes: integer('bytes').notNull(),
  dados: bytea('dados').notNull(),
  miniatura: bytea('miniatura'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('idx_comunicado_midia_com').on(t.comunicadoId)]);

/** Voto na enquete do comunicado (migration 0056). Fica só o último; dá para mudar até encerrar. */
export const comunicadoVoto = pgTable('comunicado_voto', {
  comunicadoId: uuid('comunicado_id').notNull().references(() => comunicado.id, { onDelete: 'cascade' }),
  /** Pessoa: funcionário (empregado.id) ou prestador (pessoal_prestador.id) — migration 0057. */
  empregadoId: uuid('empregado_id').notNull(),
  tenantId: uuid('tenant_id').notNull().references(() => tenant.id),
  opcoes: jsonb('opcoes').$type<string[]>().notNull().default([]),
  votadoEm: timestamp('votado_em', { withTimezone: true }).notNull().defaultNow(),
  alteradoEm: timestamp('alterado_em', { withTimezone: true }).notNull().defaultNow(),
  alteracoes: integer('alteracoes').notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.comunicadoId, t.empregadoId] }),
  index('idx_comunicado_voto_tenant').on(t.tenantId, t.comunicadoId),
]);
