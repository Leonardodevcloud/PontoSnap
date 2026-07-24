import { eq } from 'drizzle-orm';
import { pontoRep, pontoEventoRep, tenant } from '@ponto/db';

/** Tipos de evento sensível que valem para REP-P (registro 6 do AFD). */
export const EVENTO_DISPONIVEL = 7;
export const EVENTO_INDISPONIVEL = 8;

export interface DadosEvento {
  tipo: 2 | 5 | 6;
  docResponsavel?: string | null;
  // tipo 2
  tpIdtEmpregador?: number;
  docEmpregador?: string;
  cnoCaepf?: string | null;
  razaoSocial?: string;
  localPrestacao?: string | null;
  // tipo 5
  operacao?: 'I' | 'A' | 'E';
  cpfEmpregado?: string;
  nomeEmpregado?: string;
  // tipo 6
  tipoEvento?: number;
}

type Tx = {
  select: (cols?: unknown) => never;
  insert: (t: unknown) => never;
  update: (t: unknown) => never;
};

/**
 * Grava um registro 2, 5 ou 6 do AFD, consumindo a MESMA sequência de NSR das
 * marcações. O leiaute manda que o NSR seja único e sem lacunas em todo o
 * arquivo — se cada tipo tivesse seu contador, o AFD sairia inválido e não
 * teria conserto depois (registro fiscal é imutável).
 *
 * Trava a linha do REP com FOR UPDATE, igual ao caminho da batida. O
 * `ultimoHash` NÃO é tocado: só o registro tipo 7 tem hash, e a cadeia liga
 * marcação com marcação.
 *
 * Devolve o NSR gravado, ou null quando o tenant ainda não tem REP-P.
 */
export async function registrarEventoRep(
  tx: never, tenantId: string, dados: DadosEvento,
): Promise<number | null> {
  const t = tx as unknown as {
    select: (c?: unknown) => { from: (x: unknown) => { where: (c: unknown) => { for?: (m: string) => { limit: (n: number) => Promise<Record<string, unknown>[]> }; limit: (n: number) => Promise<Record<string, unknown>[]> } } };
    insert: (x: unknown) => { values: (v: unknown) => Promise<unknown> };
    update: (x: unknown) => { set: (v: unknown) => { where: (c: unknown) => Promise<unknown> } };
  };

  const reps = await t.select().from(pontoRep).where(eq(pontoRep.tenantId, tenantId)).for!('update').limit(1);
  const rep = reps[0] as { id: string; ultimoNsr: number } | undefined;
  if (!rep) return null;

  const fusoRow = (await t.select({ fuso: tenant.fuso }).from(tenant).where(eq(tenant.id, tenantId)).limit(1))[0] as { fuso?: string } | undefined;
  const nsr = Number(rep.ultimoNsr ?? 0) + 1;

  await t.insert(pontoEventoRep).values({
    tenantId, repId: rep.id, nsr, tipo: dados.tipo, dtGravacao: new Date(),
    fuso: fusoRow?.fuso ?? '-0300',
    docResponsavel: dados.docResponsavel ?? null,
    tpIdtEmpregador: dados.tpIdtEmpregador ?? null,
    docEmpregador: dados.docEmpregador ?? null,
    cnoCaepf: dados.cnoCaepf ?? null,
    razaoSocial: dados.razaoSocial ?? null,
    localPrestacao: dados.localPrestacao ?? null,
    operacao: dados.operacao ?? null,
    cpfEmpregado: dados.cpfEmpregado ?? null,
    nomeEmpregado: dados.nomeEmpregado ?? null,
    tipoEvento: dados.tipoEvento ?? null,
  });
  await t.update(pontoRep).set({ ultimoNsr: nsr }).where(eq(pontoRep.id, rep.id));
  return nsr;
}
