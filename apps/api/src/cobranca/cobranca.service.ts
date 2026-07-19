import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import {
  plano, assinatura, cobranca, empregado, tenant, comoMaster, comTenant, type Db,
} from '@ponto/db';
import {
  calcularMensalidade, vencimentoDaCompetencia, resolverBase,
  estaAtrasada, diasDeAtraso, type ModoCobranca,
} from '@ponto/apuracao-clt';
import { DB } from '../database/database.module';

@Injectable()
export class CobrancaService {
  constructor(@Inject(DB) private readonly db: Db) {}

  // ---- Catálogo de planos (MASTER) ----

  listarPlanos() {
    return comoMaster(this.db, (tx) =>
      tx.select().from(plano).where(eq(plano.ativo, 'sim')).orderBy(plano.nome));
  }

  criarPlano(p: { nome: string; modo: ModoCobranca; valor: number; descricao?: string }) {
    return comoMaster(this.db, async (tx) => {
      const rows = await tx.insert(plano).values({
        nome: p.nome, modo: p.modo, valor: String(p.valor), descricao: p.descricao ?? null,
      }).returning();
      return rows[0];
    });
  }

  arquivarPlano(id: string) {
    return comoMaster(this.db, (tx) =>
      tx.update(plano).set({ ativo: 'nao' }).where(eq(plano.id, id)));
  }

  // ---- Assinatura de uma empresa (MASTER define) ----

  /** Cria ou atualiza a assinatura de um tenant. Um tenant, uma assinatura. */
  async definirAssinatura(tenantId: string, p: {
    planoId?: string | null;
    modoOverride?: ModoCobranca | null;
    valorOverride?: number | null;
    diaVencimento: number;
    situacao?: string;
  }) {
    return comoMaster(this.db, async (tx) => {
      const atual = (await tx.select().from(assinatura)
        .where(eq(assinatura.tenantId, tenantId)).limit(1))[0];
      const dados = {
        planoId: p.planoId ?? null,
        modoOverride: p.modoOverride ?? null,
        valorOverride: p.valorOverride != null ? String(p.valorOverride) : null,
        diaVencimento: Math.min(Math.max(p.diaVencimento, 1), 28),
        situacao: p.situacao ?? 'ativa',
      };
      if (atual) {
        const rows = await tx.update(assinatura).set(dados)
          .where(eq(assinatura.id, atual.id)).returning();
        return rows[0];
      }
      const rows = await tx.insert(assinatura).values({ tenantId, ...dados }).returning();
      return rows[0];
    });
  }

  // ---- Geração de cobrança mensal (MASTER) ----

  /**
   * Gera a cobrança de uma competência para um tenant. Idempotente: se já
   * existe cobrança daquela competência, devolve a existente em vez de duplicar.
   * O valor é calculado agora, contando funcionários ativos se o modo pedir.
   */
  async gerarCobranca(tenantId: string, competencia: string) {
    if (!/^\d{4}-\d{2}$/.test(competencia)) {
      throw new BadRequestException('Competência deve ser AAAA-MM');
    }
    return comoMaster(this.db, async (tx) => {
      const existente = (await tx.select().from(cobranca)
        .where(and(eq(cobranca.tenantId, tenantId), eq(cobranca.competencia, competencia)))
        .limit(1))[0];
      if (existente) return existente;

      const ass = (await tx.select().from(assinatura)
        .where(eq(assinatura.tenantId, tenantId)).limit(1))[0];
      if (!ass) throw new NotFoundException('Empresa sem assinatura configurada');

      const pl = ass.planoId
        ? (await tx.select().from(plano).where(eq(plano.id, ass.planoId)).limit(1))[0]
        : null;

      const base = resolverBase(
        pl ? { modo: pl.modo as ModoCobranca, valor: Number(pl.valor) } : null,
        {
          modo: (ass.modoOverride as ModoCobranca) ?? null,
          valor: ass.valorOverride != null ? Number(ass.valorOverride) : null,
        },
      );

      // Conta ativos só quando o modo depende disso.
      let qtd = 0;
      if (base.modo === 'POR_FUNCIONARIO') {
        const ativos = await tx.select().from(empregado)
          .where(and(eq(empregado.tenantId, tenantId), eq(empregado.ativo, true)));
        qtd = ativos.length;
      }
      const valor = calcularMensalidade(base, qtd);
      const vencimento = vencimentoDaCompetencia(competencia, ass.diaVencimento);

      const rows = await tx.insert(cobranca).values({
        tenantId, competencia, valor: String(valor),
        qtdFuncionarios: base.modo === 'POR_FUNCIONARIO' ? qtd : null,
        vencimento, status: 'ABERTA',
      }).returning();
      return rows[0];
    });
  }

  /** Anexa o link do boleto que o MASTER emitiu por fora. */
  anexarBoleto(cobrancaId: string, boletoUrl: string) {
    return comoMaster(this.db, (tx) =>
      tx.update(cobranca).set({ boletoUrl }).where(eq(cobranca.id, cobrancaId)));
  }

  /** MASTER confirma o pagamento (quem confirma é sempre o MASTER). */
  marcarPaga(cobrancaId: string) {
    return comoMaster(this.db, (tx) =>
      tx.update(cobranca).set({ status: 'PAGA', pagoEm: new Date() })
        .where(eq(cobranca.id, cobrancaId)));
  }

  // ---- Visão do MASTER: todos os clientes ----

  async painelMaster() {
    return comoMaster(this.db, async (tx) => {
      const assinaturasRaw = await tx.select().from(assinatura);
      const cobrancasRaw = await tx.select().from(cobranca).orderBy(desc(cobranca.competencia));
      const planos = await tx.select().from(plano);
      // valor vem como string (numeric do Postgres) — coage p/ número aqui,
      // senão o front soma string ("0" + "350.00" = "0350.00") e o BRL quebra.
      const assinaturas = assinaturasRaw.map((a) => ({
        ...a, valorOverride: a.valorOverride != null ? Number(a.valorOverride) : null,
      }));
      const cobrancas = cobrancasRaw.map((c) => ({ ...c, valor: Number(c.valor) }));
      return { assinaturas, cobrancas, planos: planos.map((p) => ({ ...p, valor: Number(p.valor) })) };
    });
  }

  // ---- Visão da empresa: a própria assinatura ----

  async minhaAssinatura(tenantId: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const fuso = (await tx.select({ fuso: tenant.fuso }).from(tenant).where(eq(tenant.id, tenantId)).limit(1))[0]?.fuso ?? '-0300';
      const ass = (await tx.select().from(assinatura)
        .where(eq(assinatura.tenantId, tenantId)).limit(1))[0];
      const cobrancas = await tx.select().from(cobranca)
        .where(eq(cobranca.tenantId, tenantId)).orderBy(desc(cobranca.competencia));

      const comStatus = cobrancas.map((c) => ({
        ...c,
        valor: Number(c.valor),
        atrasada: estaAtrasada(c.vencimento, c.status, new Date(), fuso),
        diasAtraso: c.status === 'PAGA' ? 0 : diasDeAtraso(c.vencimento, new Date(), fuso),
      }));
      const emAberto = comStatus.find((c) => c.status !== 'PAGA' && c.status !== 'CANCELADA');
      return { assinatura: ass ?? null, cobrancas: comStatus, emAberto: emAberto ?? null };
    });
  }

  /** Empresa avisa que pagou. Só sinaliza — não muda o status. */
  avisarPagamento(tenantId: string, cobrancaId: string) {
    return comTenant(this.db, tenantId, (tx) =>
      tx.update(cobranca).set({ avisoPagamentoEm: new Date() })
        .where(and(eq(cobranca.id, cobrancaId), eq(cobranca.tenantId, tenantId))));
  }
}
