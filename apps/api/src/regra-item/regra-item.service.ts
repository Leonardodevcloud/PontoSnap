import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, eq, ne } from 'drizzle-orm';
import { pontoRegraItem, empregado, comTenant, type Db, type TipoRegraItem } from '@ponto/db';
import { DB } from '../database/database.module';
import type { ItensResolvidos } from '../tratamento/montar-regras';

const TIPOS: TipoRegraItem[] = ['EXTRA', 'TOLERANCIA', 'NOTURNO', 'JORNADA', 'BANCO', 'DESTINACAO'];

// mapeia tipo -> coluna de atribuição no empregado
const COLUNA = {
  EXTRA: empregado.regraExtraId, TOLERANCIA: empregado.regraToleranciaId, NOTURNO: empregado.regraNoturnoId,
  JORNADA: empregado.regraJornadaId, BANCO: empregado.regraBancoId, DESTINACAO: empregado.regraDestinacaoId,
} as const;

@Injectable()
export class RegraItemService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Lista as opções, com quantos funcionários usam cada uma. */
  async listar(tenantId: string, tipo?: TipoRegraItem) {
    return comTenant(this.db, tenantId, async (tx) => {
      const base = tipo
        ? tx.select().from(pontoRegraItem).where(and(eq(pontoRegraItem.tenantId, tenantId), eq(pontoRegraItem.tipo, tipo)))
        : tx.select().from(pontoRegraItem).where(eq(pontoRegraItem.tenantId, tenantId));
      const itens = await base.orderBy(asc(pontoRegraItem.tipo), asc(pontoRegraItem.nome));
      return itens;
    });
  }

  async criar(tenantId: string, tipo: TipoRegraItem, nome: string, config: unknown, padrao: boolean) {
    if (!TIPOS.includes(tipo)) throw new BadRequestException('Tipo inválido');
    if (!nome?.trim()) throw new BadRequestException('Dê um nome à opção');
    return comTenant(this.db, tenantId, async (tx) => {
      if (padrao) await this.limparPadrao(tx, tenantId, tipo);
      const [c] = await tx.insert(pontoRegraItem).values({ tenantId, tipo, nome, config: config as object, padrao }).returning();
      return c;
    });
  }

  async atualizar(tenantId: string, id: string, nome: string, config: unknown, padrao: boolean) {
    return comTenant(this.db, tenantId, async (tx) => {
      const atual = (await tx.select({ tipo: pontoRegraItem.tipo }).from(pontoRegraItem)
        .where(and(eq(pontoRegraItem.id, id), eq(pontoRegraItem.tenantId, tenantId))).limit(1))[0];
      if (!atual) throw new NotFoundException('Opção não encontrada');
      if (padrao) await this.limparPadrao(tx, tenantId, atual.tipo, id);
      const [c] = await tx.update(pontoRegraItem).set({ nome, config: config as object, padrao })
        .where(and(eq(pontoRegraItem.id, id), eq(pontoRegraItem.tenantId, tenantId))).returning();
      return c;
    });
  }

  async remover(tenantId: string, id: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const item = (await tx.select({ tipo: pontoRegraItem.tipo }).from(pontoRegraItem)
        .where(and(eq(pontoRegraItem.id, id), eq(pontoRegraItem.tenantId, tenantId))).limit(1))[0];
      if (!item) throw new NotFoundException('Opção não encontrada');
      const usados = (await tx.select({ n: count() }).from(empregado)
        .where(and(eq(empregado.tenantId, tenantId), eq(COLUNA[item.tipo], id))))[0]?.n ?? 0;
      if (Number(usados) > 0) throw new BadRequestException('Há funcionários usando esta opção. Troque-os antes de remover.');
      await tx.delete(pontoRegraItem).where(and(eq(pontoRegraItem.id, id), eq(pontoRegraItem.tenantId, tenantId)));
      return { removido: true };
    });
  }

  private async limparPadrao(tx: Parameters<Parameters<typeof comTenant>[2]>[0], tenantId: string, tipo: TipoRegraItem, exceto?: string) {
    const cond = exceto
      ? and(eq(pontoRegraItem.tenantId, tenantId), eq(pontoRegraItem.tipo, tipo), eq(pontoRegraItem.padrao, true), ne(pontoRegraItem.id, exceto))
      : and(eq(pontoRegraItem.tenantId, tenantId), eq(pontoRegraItem.tipo, tipo), eq(pontoRegraItem.padrao, true));
    await tx.update(pontoRegraItem).set({ padrao: false }).where(cond);
  }

  /** Resolve os 6 itens do funcionário: escolha dele → padrão do tipo → CLT (nulo). */
  async resolverParaEmpregado(tenantId: string, empregadoId: string): Promise<ItensResolvidos> {
    return comTenant(this.db, tenantId, async (tx) => {
      const emp = (await tx.select({
        EXTRA: empregado.regraExtraId, TOLERANCIA: empregado.regraToleranciaId, NOTURNO: empregado.regraNoturnoId,
        JORNADA: empregado.regraJornadaId, BANCO: empregado.regraBancoId, DESTINACAO: empregado.regraDestinacaoId,
      }).from(empregado).where(and(eq(empregado.id, empregadoId), eq(empregado.tenantId, tenantId))).limit(1))[0];
      if (!emp) return {};
      const todos = await tx.select().from(pontoRegraItem).where(eq(pontoRegraItem.tenantId, tenantId));
      const porId = new Map(todos.map((r) => [r.id, r]));
      const padraoPorTipo = new Map(todos.filter((r) => r.padrao).map((r) => [r.tipo, r]));
      const pick = (tipo: TipoRegraItem) => {
        const id = emp[tipo];
        const item = id ? porId.get(id) : padraoPorTipo.get(tipo);
        return (item?.config ?? null) as never;
      };
      return {
        extra: pick('EXTRA'), tolerancia: pick('TOLERANCIA'), noturno: pick('NOTURNO'),
        jornada: pick('JORNADA'), banco: pick('BANCO'), destinacao: pick('DESTINACAO'),
      };
    });
  }
}
