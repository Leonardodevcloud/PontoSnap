import { and, eq } from 'drizzle-orm';
import { pontoPerfilRegra } from '@ponto/db';
import type { ItensResolvidos } from './montar-regras';

/**
 * Resolve os 6 itens de cálculo a partir do PERFIL escolhido pelo funcionário.
 *
 * Ordem: perfil do funcionário → perfil padrão da empresa → CLT (tudo nulo).
 * O motor de apuração continua recebendo os mesmos 6 configs de sempre — só a
 * origem mudou (antes eram 6 catálogos soltos; agora um perfil os agrupa).
 *
 * Função pura sobre o tx (os testes instanciam os services direto).
 */
export async function resolverItens(
  tx: { select: () => { from: (t: typeof pontoPerfilRegra) => { where: (c: unknown) => Promise<(typeof pontoPerfilRegra.$inferSelect)[]> } } },
  tenantId: string,
  perfilRegraId?: string | null,
): Promise<ItensResolvidos> {
  const perfis = await tx.select().from(pontoPerfilRegra).where(eq(pontoPerfilRegra.tenantId, tenantId));
  const escolhido = perfilRegraId ? perfis.find((p) => p.id === perfilRegraId) : undefined;
  const padrao = perfis.find((p) => p.padrao);
  const perfil = escolhido ?? padrao;

  const cfg = (perfil?.config ?? {}) as Partial<ItensResolvidos>;
  return {
    extra: cfg.extra ?? null,
    tolerancia: cfg.tolerancia ?? null,
    noturno: cfg.noturno ?? null,
    jornada: cfg.jornada ?? null,
    banco: cfg.banco ?? null,
    destinacao: cfg.destinacao ?? null,
  };
}

/** Busca só o id do perfil de um empregado (usado pela apuração). */
export async function perfilDoEmpregado(
  tx: { select: (c: unknown) => { from: (t: unknown) => { where: (c: unknown) => { limit: (n: number) => Promise<{ perfilRegraId: string | null }[]> } } } },
  empregadoTabela: unknown,
  cond: unknown,
): Promise<string | null> {
  const r = await tx.select({ perfilRegraId: (empregadoTabela as { perfilRegraId: unknown }).perfilRegraId }).from(empregadoTabela).where(cond).limit(1);
  return r[0]?.perfilRegraId ?? null;
}
