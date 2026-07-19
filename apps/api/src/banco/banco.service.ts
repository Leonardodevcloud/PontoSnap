import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, isNotNull, lte } from 'drizzle-orm';
import { pontoBancoMov, pontoAusencia, pontoHorarioContratual, tenant, empregado, comTenant, type Db } from '@ponto/db';
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
      const totalMin = novos.reduce((s, n) => s + n.minutos, 0);
      return { competencia, lancados: novos.length, totalMin };
    });
  }

  /**
   * Lança uma competência para TODOS os funcionários ativos de uma vez.
   * Reaproveita o lançamento individual (idempotente), então relançar o mês
   * substitui só o que veio da apuração — pagamentos e ajustes ficam intactos.
   */
  async lancarCompetenciaLote(tenantId: string, competencia: string) {
    const cfg = await this.obterConfig(tenantId);
    if (!cfg.ativo) throw new BadRequestException('Esta empresa não tem acordo de banco de horas');
    if (!/^\d{4}-\d{2}$/.test(competencia)) throw new BadRequestException('Competência deve ser YYYY-MM');

    const ativos = await comTenant(this.db, tenantId, (tx) =>
      tx.select({ id: empregado.id, nome: empregado.nome }).from(empregado)
        .where(and(eq(empregado.tenantId, tenantId), eq(empregado.ativo, true)))
        .orderBy(asc(empregado.nome)));

    const porFuncionario: { empregadoId: string; nome: string; minutos: number }[] = [];
    for (const e of ativos) {
      const r = await this.lancarCompetencia(tenantId, e.id, competencia);
      porFuncionario.push({ empregadoId: e.id, nome: e.nome, minutos: r.totalMin });
    }
    const totalMin = porFuncionario.reduce((s, f) => s + f.minutos, 0);
    return { competencia, funcionarios: ativos.length, totalMin, porFuncionario };
  }

  /**
   * Histórico de competências já lançadas, derivado do extrato (a coluna
   * `competencia` marca cada movimento que veio de um lançamento). Agrupa por
   * competência com total, nº de funcionários, data do lançamento e detalhe.
   */
  async historicoCompetencias(tenantId: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const movs = await tx.select({
        competencia: pontoBancoMov.competencia,
        empregadoId: pontoBancoMov.empregadoId,
        minutos: pontoBancoMov.minutos,
        criadoEm: pontoBancoMov.criadoEm,
      }).from(pontoBancoMov).where(and(
        eq(pontoBancoMov.tenantId, tenantId),
        isNotNull(pontoBancoMov.competencia),
      ));

      const nomes = new Map((await tx.select({ id: empregado.id, nome: empregado.nome })
        .from(empregado).where(eq(empregado.tenantId, tenantId))).map((e) => [e.id, e.nome] as const));

      const porComp = new Map<string, { lancadoEm: Date; func: Map<string, number> }>();
      for (const m of movs) {
        const comp = m.competencia!;
        const g = porComp.get(comp) ?? { lancadoEm: m.criadoEm, func: new Map<string, number>() };
        g.func.set(m.empregadoId, (g.func.get(m.empregadoId) ?? 0) + m.minutos);
        if (m.criadoEm > g.lancadoEm) g.lancadoEm = m.criadoEm;
        porComp.set(comp, g);
      }

      return [...porComp.entries()]
        .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // competência mais recente primeiro
        .map(([competencia, g]) => {
          const porFuncionario = [...g.func.entries()]
            .map(([id, minutos]) => ({ nome: nomes.get(id) ?? '—', minutos }))
            .sort((a, b) => b.minutos - a.minutos);
          return {
            competencia,
            funcionarios: g.func.size,
            totalMin: porFuncionario.reduce((s, f) => s + f.minutos, 0),
            lancadoEm: g.lancadoEm,
            porFuncionario,
          };
        });
    });
  }

  /**
   * Registra uma folga compensatória: o funcionário usa o saldo do banco para
   * um dia de descanso. Faz duas coisas de uma vez:
   *  - marca o dia como folga compensatória (ausência tipo 4), pra apuração NÃO
   *    contar como falta;
   *  - lança um débito no banco no valor da jornada daquele dia.
   * Sem os dois, ou o dia viraria falta, ou o saldo nunca baixaria.
   */
  async registrarFolga(tenantId: string, empregadoId: string, data: string, minutosManual?: number | null) {
    const cfg = await this.obterConfig(tenantId);
    if (!cfg.ativo) throw new BadRequestException('Esta empresa não tem acordo de banco de horas');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new BadRequestException('Data inválida (use AAAA-MM-DD)');

    return comTenant(this.db, tenantId, async (tx) => {
      const emp = (await tx.select({ horarioId: empregado.horarioContratualId }).from(empregado)
        .where(and(eq(empregado.id, empregadoId), eq(empregado.tenantId, tenantId))).limit(1))[0];
      if (!emp) throw new NotFoundException('Empregado não encontrado');

      let minutos = minutosManual ?? null;
      if (minutos == null) {
        const h = emp.horarioId
          ? (await tx.select({ dur: pontoHorarioContratual.durJornadaMin }).from(pontoHorarioContratual)
              .where(eq(pontoHorarioContratual.id, emp.horarioId)).limit(1))[0]
          : undefined;
        minutos = h?.dur ?? 0;
      }
      if (minutos <= 0) {
        throw new BadRequestException('Informe as horas da folga — este funcionário não tem jornada configurada.');
      }

      // Não duplica: se já há folga nesse dia, não cria de novo.
      const jaTem = (await tx.select({ id: pontoAusencia.id }).from(pontoAusencia).where(and(
        eq(pontoAusencia.tenantId, tenantId), eq(pontoAusencia.empregadoId, empregadoId),
        eq(pontoAusencia.data, data), eq(pontoAusencia.tipo, 4))).limit(1))[0];
      if (jaTem) throw new BadRequestException('Já existe uma folga compensatória registrada nesse dia.');

      await tx.insert(pontoAusencia).values({ tenantId, empregadoId, tipo: 4, data, qtMinutos: minutos });
      const [mov] = await tx.insert(pontoBancoMov).values({
        tenantId, empregadoId, data, minutos: -minutos, tipo: 'DEBITO',
        descricao: 'Folga compensatória',
      }).returning();
      return { data, minutos, movimento: mov };
    });
  }
}
