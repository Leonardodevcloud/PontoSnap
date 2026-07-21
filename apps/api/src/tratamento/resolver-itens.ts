import { eq } from 'drizzle-orm';
import { pontoRegraItem, type TipoRegraItem } from '@ponto/db';
import type { ItensResolvidos } from './montar-regras';

export interface IdsItens {
  regraExtraId?: string | null;
  regraToleranciaId?: string | null;
  regraNoturnoId?: string | null;
  regraJornadaId?: string | null;
  regraBancoId?: string | null;
  regraDestinacaoId?: string | null;
}

/**
 * Resolve os 6 itens dentro de uma transação já aberta: escolha do funcionário
 * → padrão do tipo → CLT (nulo). Função pura sobre o tx pra não virar dependência
 * de construtor (os testes instanciam os services direto).
 */
export async function resolverItens(
  tx: { select: () => { from: (t: typeof pontoRegraItem) => { where: (c: unknown) => Promise<(typeof pontoRegraItem.$inferSelect)[]> } } },
  tenantId: string,
  ids: IdsItens,
): Promise<ItensResolvidos> {
  const todos = await tx.select().from(pontoRegraItem).where(eq(pontoRegraItem.tenantId, tenantId));
  const porId = new Map(todos.map((r) => [r.id, r]));
  const padraoPorTipo = new Map(todos.filter((r) => r.padrao).map((r) => [r.tipo, r]));
  const pick = (tipo: TipoRegraItem, id?: string | null) => {
    const item = id ? porId.get(id) : padraoPorTipo.get(tipo);
    return (item?.config ?? null) as never;
  };
  return {
    extra: pick('EXTRA', ids.regraExtraId),
    tolerancia: pick('TOLERANCIA', ids.regraToleranciaId),
    noturno: pick('NOTURNO', ids.regraNoturnoId),
    jornada: pick('JORNADA', ids.regraJornadaId),
    banco: pick('BANCO', ids.regraBancoId),
    destinacao: pick('DESTINACAO', ids.regraDestinacaoId),
  };
}
