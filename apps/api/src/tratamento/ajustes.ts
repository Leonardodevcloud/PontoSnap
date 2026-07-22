import { and, eq, gte, lte } from 'drizzle-orm';
import { pontoAjuste } from '@ponto/db';

export interface AjustesDoPeriodo {
  /** ids de marcação original que foram desconsideradas (aprovado). */
  desconsideradas: Map<string, string | null>;
  /** batidas incluídas por aprovação (não existem em ponto_marcacao). */
  inclusoes: { id: string; dtMarcacao: Date; tpMarc: string | null; motivo: string }[];
}

/** Ajustes APROVADOS do período. Pedidos em análise ou recusados não valem. */
export async function ajustesAprovados(
  tx: { select: () => { from: (t: typeof pontoAjuste) => { where: (c: unknown) => Promise<(typeof pontoAjuste.$inferSelect)[]> } } },
  tenantId: string,
  empregadoId: string,
  inicioData: string,
  fimData: string,
): Promise<AjustesDoPeriodo> {
  const linhas = await tx.select().from(pontoAjuste).where(and(
    eq(pontoAjuste.tenantId, tenantId),
    eq(pontoAjuste.empregadoId, empregadoId),
    eq(pontoAjuste.status, 'APROVADO'),
    gte(pontoAjuste.data, inicioData),
    lte(pontoAjuste.data, fimData),
  ));
  const desconsideradas = new Map<string, string | null>();
  const inclusoes: AjustesDoPeriodo['inclusoes'] = [];
  for (const a of linhas) {
    if (a.tipo === 'DESCONSIDERAR' && a.marcacaoId) {
      desconsideradas.set(a.marcacaoId, a.observacao);
    } else if (a.tipo === 'INCLUSAO' && a.dtMarcacao) {
      inclusoes.push({ id: a.id, dtMarcacao: a.dtMarcacao, tpMarc: a.tpMarc, motivo: a.observacao });
    }
  }
  return { desconsideradas, inclusoes };
}

export interface MarcacaoBase { id?: string; dtMarcacao: Date }

/**
 * Lista efetiva de batidas: tira as desconsideradas, soma as incluídas e
 * ordena por hora. É o que a apuração e o espelho devem enxergar — o AFD
 * continua com tudo, intocado.
 */
export function aplicarAjustes<T extends MarcacaoBase>(
  marcs: T[],
  aj: AjustesDoPeriodo,
): { dtMarcacao: Date; origem: 'ORIGINAL' | 'INCLUIDA'; marcacaoId?: string; ajusteId?: string; motivo?: string }[] {
  const efetivas = marcs
    .filter((m) => !(m.id && aj.desconsideradas.has(m.id)))
    .map((m) => ({ dtMarcacao: m.dtMarcacao, origem: 'ORIGINAL' as const, marcacaoId: m.id }));
  for (const i of aj.inclusoes) {
    efetivas.push({ dtMarcacao: i.dtMarcacao, origem: 'INCLUIDA' as never, marcacaoId: undefined, ajusteId: i.id, motivo: i.motivo } as never);
  }
  return efetivas.sort((a, b) => a.dtMarcacao.getTime() - b.dtMarcacao.getTime());
}
