import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { pontoBancoMov, tenant, empregado, comTenant, type Db } from '@ponto/db';
import { calcularBanco, type MovimentoBanco, type TipoMovBanco } from '@ponto/apuracao-clt';
import { DB } from '../database/database.module';
import { TratamentoService } from '../tratamento/tratamento.service';

/** Prazos-base da CLT. Acordo coletivo pode dispor outro — por isso é editável. */
const PRAZO_PADRAO: Record<string, number> = { INDIVIDUAL: 6, COLETIVO: 12 };

export type TipoAcordo = 'NENHUM' | 'INDIVIDUAL' | 'COLETIVO';

@Injectable()
export class BancoService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tratamento: TratamentoService,
  ) {}

  /** Configuração do acordo. Sem acordo, não existe banco de horas. */
  async obterConfig(tenantId: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const t = (await tx.select().from(tenant).where(eq(tenant.id, tenantId)).limit(1))[0];
      if (!t) throw new NotFoundException('Cliente não encontrado');
      const tipo = (t.bancoTipoAcordo ?? 'NENHUM') as TipoAcordo;
      return {
        tipoAcordo: tipo,
        prazoMeses: t.bancoPrazoMeses ?? PRAZO_PADRAO[tipo] ?? null,
        ativo: tipo !== 'NENHUM',
      };
    });
  }

  async definirConfig(tenantId: string, p: { tipoAcordo: TipoAcordo; prazoMeses?: number | null }) {
    if (!['NENHUM', 'INDIVIDUAL', 'COLETIVO'].includes(p.tipoAcordo)) {
      throw new BadRequestException('Tipo de acordo inválido');
    }
    // Prazo maior que 12 meses não encontra amparo nem no acordo coletivo.
    const prazo = p.prazoMeses ?? PRAZO_PADRAO[p.tipoAcordo] ?? null;
    if (p.tipoAcordo !== 'NENHUM' && (prazo == null || prazo < 1 || prazo > 12)) {
      throw new BadRequestException('Prazo de compensação deve ficar entre 1 e 12 meses');
    }
    return comTenant(this.db, tenantId, async (tx) => {
      const [t] = await tx.update(tenant)
        .set({ bancoTipoAcordo: p.tipoAcordo, bancoPrazoMeses: p.tipoAcordo === 'NENHUM' ? null : prazo })
        .where(eq(tenant.id, tenantId)).returning();
      if (!t) throw new NotFoundException('Cliente não encontrado');
      const tipo = t.bancoTipoAcordo as TipoAcordo;
      return { tipoAcordo: tipo, prazoMeses: t.bancoPrazoMeses, ativo: tipo !== 'NENHUM' };
    });
  }

  /** Extrato cru, para auditoria e para o cálculo. */
  private async extrato(tenantId: string, empregadoId: string): Promise<MovimentoBanco[]> {
    return comTenant(this.db, tenantId, async (tx) => {
      const linhas = await tx.select().from(pontoBancoMov).where(and(
        eq(pontoBancoMov.tenantId, tenantId), eq(pontoBancoMov.empregadoId, empregadoId),
      )).orderBy(asc(pontoBancoMov.data));
      return linhas.map((l) => ({
        data: l.data, minutos: l.minutos,
        tipo: l.tipo as TipoMovBanco, descricao: l.descricao ?? undefined,
      }));
    });
  }

  /** Saldo fechado + extrato, do jeito que a tela precisa. */
  async saldo(tenantId: string, empregadoId: string, hoje: string) {
    const cfg = await this.obterConfig(tenantId);
    if (!cfg.ativo || cfg.prazoMeses == null) {
      return { ativo: false as const, tipoAcordo: cfg.tipoAcordo, prazoMeses: null, saldo: null, extrato: [] };
    }
    const movs = await this.extrato(tenantId, empregadoId);
    return {
      ativo: true as const,
      tipoAcordo: cfg.tipoAcordo,
      prazoMeses: cfg.prazoMeses,
      saldo: calcularBanco(movs, cfg.prazoMeses, hoje),
      extrato: [...movs].reverse(), // o mais recente primeiro, como extrato de banco
    };
  }

  /** Movimento avulso do RH: pagamento de saldo vencido, ajuste justificado. */
  async lancarMovimento(tenantId: string, p: {
    empregadoId: string; data: string; minutos: number;
    tipo: TipoMovBanco; descricao?: string;
  }) {
    const cfg = await this.obterConfig(tenantId);
    if (!cfg.ativo) throw new BadRequestException('Esta empresa não tem acordo de banco de horas');
    if (p.minutos === 0) throw new BadRequestException('Movimento de zero minuto não faz sentido');
    if (p.tipo === 'AJUSTE' && !p.descricao?.trim()) {
      throw new BadRequestException('Ajuste manual precisa de justificativa');
    }
    return comTenant(this.db, tenantId, async (tx) => {
      const e = (await tx.select().from(empregado).where(and(
        eq(empregado.id, p.empregadoId), eq(empregado.tenantId, tenantId))).limit(1))[0];
      if (!e) throw new NotFoundException('Empregado não encontrado');
      const [mov] = await tx.insert(pontoBancoMov).values({
        tenantId, empregadoId: p.empregadoId, data: p.data,
        minutos: p.minutos, tipo: p.tipo, descricao: p.descricao?.trim() || null,
      }).returning();
      return mov;
    });
  }

  /**
   * Lança no banco o saldo de cada dia de uma competência já apurada.
   *
   * Idempotente: relançar a mesma competência apaga o que foi lançado por ela
   * antes. Só mexe no que veio da apuração — pagamento e ajuste do RH não são
   * tocados, porque não pertencem à competência.
   */
  async lancarCompetencia(tenantId: string, empregadoId: string, competencia: string) {
    const cfg = await this.obterConfig(tenantId);
    if (!cfg.ativo) throw new BadRequestException('Esta empresa não tem acordo de banco de horas');
    if (!/^\d{4}-\d{2}$/.test(competencia)) throw new BadRequestException('Competência deve ser YYYY-MM');

    const [a, m] = competencia.split('-').map(Number);
    const ultimo = new Date(Date.UTC(a!, m!, 0)).getUTCDate();
    const inicio = `${competencia}-01`;
    const fim = `${competencia}-${String(ultimo).padStart(2, '0')}`;

    const feriados = await this.tratamento.listarFeriados(tenantId, inicio, fim);
    const ap = await this.tratamento.apurarPeriodoCLT(
      tenantId, empregadoId, inicio, fim, feriados.map((f) => f.data));

    const novos = ap.resultado.dias
      .filter((d) => d.saldoMin !== 0 && !d.paresIncompletos)
      .map((d) => ({
        tenantId, empregadoId, data: d.data, minutos: d.saldoMin,
        tipo: d.saldoMin > 0 ? 'CREDITO' : 'DEBITO',
        descricao: d.saldoMin > 0 ? 'Hora extra' : 'Saída antecipada ou atraso',
        competencia,
      }));

    return comTenant(this.db, tenantId, async (tx) => {
      await tx.delete(pontoBancoMov).where(and(
        eq(pontoBancoMov.tenantId, tenantId),
        eq(pontoBancoMov.empregadoId, empregadoId),
        eq(pontoBancoMov.competencia, competencia),
      ));
      if (novos.length > 0) await tx.insert(pontoBancoMov).values(novos);
      return { competencia, lancados: novos.length };
    });
  }
}
