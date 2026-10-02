import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, eq, min, sql } from 'drizzle-orm';
import {
  pontoBancoMov, pontoBancoFechamento, pontoAusencia, pontoHorarioContratual, pontoMarcacao,
  tenant, empregado, pontoPerfilRegra, comTenant, comoMaster, type Db,
} from '@ponto/db';
import { calcularBanco, type MovimentoBanco, type TipoMovBanco, type SaldoBanco } from '@ponto/apuracao-clt';
import { movimentosBancoDoDia, type DestinoFalta, type DestinoAtraso } from '../tratamento/destinacao';
import { resolverItens } from '../tratamento/resolver-itens';
import type { ItensResolvidos } from '../tratamento/montar-regras';
import { DB } from '../database/database.module';
import { TratamentoService } from '../tratamento/tratamento.service';
import { competenciaDe, reabrirCompetencia } from './fechamento';

/** Prazos-base da CLT. Acordo coletivo pode dispor outro — por isso é editável. */
const PRAZO_PADRAO: Record<string, number> = { INDIVIDUAL: 6, COLETIVO: 12 };

/** Quantos meses pra trás a sincronização automática vai, no máximo. */
const LIMITE_MESES_SINCRONIZACAO = 36;

export type TipoAcordo = 'NENHUM' | 'INDIVIDUAL' | 'COLETIVO';
export type FormaCalculo = 'BANCO_HORAS' | 'INTRA_MES';

export interface MesCorrente {
  competencia: string;
  /** Saldo do mês em andamento, calculado agora, do jeito que o fechamento vai lançar. */
  estimadoMin: number;
}

export interface SaldoResp {
  ativo: boolean;
  tipoAcordo: TipoAcordo;
  prazoMeses: number | null;
  formaCalculo: FormaCalculo;
  saldo: SaldoBanco | null;
  extrato: (MovimentoBanco & { id: string; competencia?: string | null })[];
  /** Mês em andamento (ainda não fechado). Null quando o banco está inativo. */
  mesCorrente: MesCorrente | null;
  /** Saldo oficial + mês em andamento: o número que a pessoa quer ver. */
  saldoProjetadoMin: number | null;
  /** Competências fechadas pra este funcionário (mais recente primeiro). */
  fechamentos: { competencia: string; totalMin: number; fechadoEm: Date; origem: string }[];
}

/** Soma meses a uma competência YYYY-MM. */
function somarMesesComp(comp: string, n: number): string {
  const [a, m] = comp.split('-').map(Number);
  const d = new Date(Date.UTC(a!, m! - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Último dia (YYYY-MM-DD) de uma competência. */
function ultimoDiaDe(comp: string): string {
  const [a, m] = comp.split('-').map(Number);
  return `${comp}-${String(new Date(Date.UTC(a!, m!, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** Data local YYYY-MM-DD de um instante, num fuso "-0300". */
function diaLocal(instante: Date, fuso: string): string {
  const off = Number(fuso) / 100;
  return new Date(instante.getTime() + off * 3600_000).toISOString().slice(0, 10);
}

@Injectable()
export class BancoService {
  private readonly log = new Logger(BancoService.name);

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
  private async extrato(tenantId: string, empregadoId: string): Promise<(MovimentoBanco & { id: string; competencia: string | null })[]> {
    return comTenant(this.db, tenantId, async (tx) => {
      const linhas = await tx.select().from(pontoBancoMov).where(and(
        eq(pontoBancoMov.tenantId, tenantId), eq(pontoBancoMov.empregadoId, empregadoId),
      )).orderBy(asc(pontoBancoMov.data), asc(pontoBancoMov.criadoEm));
      return linhas.map((l) => ({
        id: l.id, competencia: l.competencia,
        data: l.data, minutos: l.minutos,
        tipo: l.tipo as TipoMovBanco, descricao: l.descricao ?? undefined,
      }));
    });
  }

  /**
   * Remove um lançamento manual do banco (folga, ajuste, saldo de abertura).
   * Se for uma folga compensatória, remove também a ausência (tipo 4) daquele
   * dia — os dois foram criados juntos — e reabre a competência, porque sem a
   * folga aquele dia volta a ser apurado como falta.
   * Lançamentos de fechamento não saem por aqui (são refeitos ao refazer o mês).
   */
  async removerMovimento(tenantId: string, movimentoId: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const mov = (await tx.select().from(pontoBancoMov)
        .where(and(eq(pontoBancoMov.id, movimentoId), eq(pontoBancoMov.tenantId, tenantId))).limit(1))[0];
      if (!mov) throw new NotFoundException('Lançamento não encontrado');
      if (mov.competencia) {
        throw new BadRequestException('Este lançamento veio do fechamento de um mês. Para desfazer, refaça a competência.');
      }
      if (mov.descricao === 'Folga compensatória') {
        await tx.delete(pontoAusencia).where(and(
          eq(pontoAusencia.tenantId, tenantId), eq(pontoAusencia.empregadoId, mov.empregadoId),
          eq(pontoAusencia.data, mov.data), eq(pontoAusencia.tipo, 4)));
        await reabrirCompetencia(tx as never, tenantId, mov.empregadoId, competenciaDe(mov.data));
      }
      await tx.delete(pontoBancoMov).where(and(eq(pontoBancoMov.id, movimentoId), eq(pontoBancoMov.tenantId, tenantId)));
      return { removido: true };
    });
  }

  /**
   * Saldo fechado + extrato + mês em andamento, do jeito que a tela precisa.
   * Antes de calcular, sincroniza: todo mês já encerrado e ainda não fechado
   * é fechado aqui — é isso que dispensa qualquer ação manual do RH.
   */
  async saldo(tenantId: string, empregadoId: string, hoje: string): Promise<SaldoResp> {
    const cfg = await this.configBanco(tenantId, empregadoId);
    if (!cfg.ativo || cfg.prazoMeses == null) {
      return {
        ativo: false, tipoAcordo: cfg.tipoAcordo, prazoMeses: null, formaCalculo: cfg.formaCalculo,
        saldo: null, extrato: [], mesCorrente: null, saldoProjetadoMin: null, fechamentos: [],
      };
    }

    await this.sincronizar(tenantId, empregadoId, hoje, cfg);

    let movs = await this.extrato(tenantId, empregadoId);
    const compAtual = competenciaDe(hoje);
    // Intra-mês: compensa só dentro do mês corrente — não carrega saldo entre meses.
    if (cfg.formaCalculo === 'INTRA_MES') {
      movs = movs.filter((m) => competenciaDe(m.data) === compAtual);
    }
    const saldo = calcularBanco(movs, cfg.prazoMeses, hoje);

    // Mês em andamento: o que a apuração de hoje lançaria, descontando o que
    // por acaso já foi lançado pra esta competência (refazer manual, p.ex.).
    const estimadoBruto = await this.saldoApuradoDaCompetencia(tenantId, empregadoId, compAtual, cfg);
    const jaLancado = movs.filter((m) => m.competencia === compAtual).reduce((s, m) => s + m.minutos, 0);
    const mesCorrente: MesCorrente = { competencia: compAtual, estimadoMin: estimadoBruto - jaLancado };

    const fechamentos = await comTenant(this.db, tenantId, (tx) =>
      tx.select({
        competencia: pontoBancoFechamento.competencia, totalMin: pontoBancoFechamento.totalMin,
        fechadoEm: pontoBancoFechamento.fechadoEm, origem: pontoBancoFechamento.origem,
      }).from(pontoBancoFechamento).where(and(
        eq(pontoBancoFechamento.tenantId, tenantId), eq(pontoBancoFechamento.empregadoId, empregadoId),
      )).orderBy(sql`${pontoBancoFechamento.competencia} desc`));

    return {
      ativo: true,
      tipoAcordo: cfg.tipoAcordo,
      prazoMeses: cfg.formaCalculo === 'INTRA_MES' ? 1 : cfg.prazoMeses,
      formaCalculo: cfg.formaCalculo,
      saldo,
      extrato: [...movs].reverse(), // o mais recente primeiro, como extrato de banco
      mesCorrente,
      saldoProjetadoMin: saldo.saldoMin + mesCorrente.estimadoMin,
      fechamentos,
    };
  }

  /**
   * Saldo do banco em uma data de corte (fim de um mês, p.ex.), pra tela de
   * apuração mostrar "saldo anterior + mês = acumulado". Sincroniza até lá.
   * Devolve null se o funcionário não tem banco.
   */
  async saldoAte(tenantId: string, empregadoId: string, dataCorte: string, hoje: string): Promise<number | null> {
    const cfg = await this.configBanco(tenantId, empregadoId);
    if (!cfg.ativo || cfg.prazoMeses == null) return null;
    if (cfg.formaCalculo === 'INTRA_MES') return 0; // não carrega nada entre meses
    await this.sincronizar(tenantId, empregadoId, hoje, cfg);
    const movs = (await this.extrato(tenantId, empregadoId)).filter((m) => m.data <= dataCorte);
    return calcularBanco(movs, cfg.prazoMeses, dataCorte).saldoMin;
  }

  /**
   * Config de banco QUE VALE pro funcionário, montada a partir dos itens (BANCO
   * e DESTINACAO). Se o item de banco herda (ou não há), usa a empresa.
   */
  async configBanco(tenantId: string, empregadoId: string): Promise<{ ativo: boolean; tipoAcordo: TipoAcordo; prazoMeses: number | null; destinacaoFaltas: DestinoFalta; destinacaoAtrasos: DestinoAtraso; formaCalculo: FormaCalculo }> {
    const empresa = await this.obterConfig(tenantId);
    const itens = await comTenant(this.db, tenantId, async (tx) => {
      const emp = (await tx.select({ perfilRegraId: empregado.perfilRegraId })
        .from(empregado).where(and(eq(empregado.id, empregadoId), eq(empregado.tenantId, tenantId))).limit(1))[0];
      return emp ? resolverItens(tx as never, tenantId, emp.perfilRegraId) : ({} as ItensResolvidos);
    });
    const banco = itens.banco;
    const destinacaoFaltas = itens.destinacao?.destinacaoFaltas ?? 'DESCONTA';
    const destinacaoAtrasos = itens.destinacao?.destinacaoAtrasos ?? 'BANCO';
    const formaCalculo = banco?.formaCalculo ?? 'BANCO_HORAS';
    if (banco && banco.bancoModo !== 'HERDA') {
      const ativo = banco.bancoModo === 'ATIVO';
      const tipo = (banco.bancoTipoAcordo as TipoAcordo) ?? (empresa.tipoAcordo === 'NENHUM' ? 'INDIVIDUAL' : empresa.tipoAcordo);
      return {
        ativo,
        tipoAcordo: ativo ? tipo : 'NENHUM',
        prazoMeses: ativo ? (banco.bancoPrazoMeses ?? empresa.prazoMeses ?? PRAZO_PADRAO[tipo] ?? null) : null,
        destinacaoFaltas, destinacaoAtrasos, formaCalculo,
      };
    }
    return { ...empresa, destinacaoFaltas, destinacaoAtrasos, formaCalculo }; // HERDA
  }

  /**
   * Quantos funcionários seguem o padrão da empresa e quantos têm regra própria
   * de banco. A tela precisa disso pra não passar a ideia de que o acordo da
   * empresa vale pra todo mundo.
   */
  async cobertura(tenantId: string) {
    const empresa = await this.obterConfig(tenantId);
    return comTenant(this.db, tenantId, async (tx) => {
      const emps = await tx.select({ id: empregado.id, perfilRegraId: empregado.perfilRegraId })
        .from(empregado).where(and(eq(empregado.tenantId, tenantId), eq(empregado.ativo, true)));
      const perfis = await tx.select().from(pontoPerfilRegra).where(eq(pontoPerfilRegra.tenantId, tenantId));
      const porId = new Map(perfis.map((p) => [p.id, p]));
      const padrao = perfis.find((p) => p.padrao);

      let comPerfil = 0, seguindoEmpresa = 0, comBanco = 0, semBanco = 0;
      for (const e of emps) {
        const perfil = e.perfilRegraId ? porId.get(e.perfilRegraId) : padrao;
        const banco = (perfil?.config as { banco?: { bancoModo?: string } } | undefined)?.banco;
        const modo = banco?.bancoModo ?? 'HERDA';
        if (e.perfilRegraId) comPerfil++;
        if (modo === 'HERDA') seguindoEmpresa++;
        const ativo = modo === 'ATIVO' ? true : modo === 'INATIVO' ? false : empresa.ativo;
        if (ativo) comBanco++; else semBanco++;
      }
      return { total: emps.length, comPerfil, seguindoEmpresa, comBanco, semBanco, opcoesPerfil: perfis.length };
    });
  }

  /** Movimento avulso do RH: pagamento de saldo vencido, ajuste justificado. */
  async lancarMovimento(tenantId: string, p: {
    empregadoId: string; data: string; minutos: number;
    tipo: TipoMovBanco; descricao?: string;
  }) {
    const cfg = await this.configBanco(tenantId, p.empregadoId);
    if (!cfg.ativo) throw new BadRequestException('Este funcionário não tem banco de horas ativo');
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

  /** Movimentos que a apuração de uma competência geraria, segundo a regra do funcionário. */
  private async movimentosDaCompetencia(
    tenantId: string, empregadoId: string, competencia: string,
    cfg: { destinacaoFaltas: DestinoFalta; destinacaoAtrasos: DestinoAtraso },
  ) {
    const inicio = `${competencia}-01`;
    const fim = ultimoDiaDe(competencia);
    const feriados = await this.tratamento.listarFeriados(tenantId, inicio, fim);
    const ap = await this.tratamento.apurarPeriodoCLT(
      tenantId, empregadoId, inicio, fim, feriados.map((f) => f.data));
    const opc = { destinacaoFaltas: cfg.destinacaoFaltas, destinacaoAtrasos: cfg.destinacaoAtrasos, bancoAtivo: true };
    return ap.resultado.dias.flatMap((d) =>
      movimentosBancoDoDia(d, opc).map((mv) => ({
        tenantId, empregadoId, data: d.data, minutos: mv.minutos,
        tipo: mv.tipo as 'CREDITO' | 'DEBITO', descricao: mv.descricao, competencia,
      })));
  }

  /** Soma do que a competência lançaria hoje (pra estimativa do mês corrente). */
  private async saldoApuradoDaCompetencia(
    tenantId: string, empregadoId: string, competencia: string,
    cfg: { destinacaoFaltas: DestinoFalta; destinacaoAtrasos: DestinoAtraso },
  ): Promise<number> {
    try {
      const movs = await this.movimentosDaCompetencia(tenantId, empregadoId, competencia, cfg);
      return movs.reduce((s, m) => s + m.minutos, 0);
    } catch (e) {
      // Sem REP/horário configurado a apuração falha; a estimativa é opcional.
      this.log.warn(`Estimativa do mês ${competencia} falhou: ${(e as Error).message}`);
      return 0;
    }
  }

  /**
   * Lança no banco o saldo de cada dia de uma competência já apurada e marca
   * a competência como fechada.
   *
   * Idempotente: relançar a mesma competência apaga o que foi lançado por ela
   * antes. Só mexe no que veio da apuração — pagamento e ajuste do RH não são
   * tocados, porque não pertencem à competência.
   */
  async lancarCompetencia(
    tenantId: string, empregadoId: string, competencia: string, origem: 'AUTO' | 'MANUAL' = 'MANUAL',
  ) {
    const cfg = await this.configBanco(tenantId, empregadoId);
    if (!cfg.ativo) throw new BadRequestException('Este funcionário não tem banco de horas ativo');
    if (!/^\d{4}-\d{2}$/.test(competencia)) throw new BadRequestException('Competência deve ser YYYY-MM');

    const novos = await this.movimentosDaCompetencia(tenantId, empregadoId, competencia, cfg);

    return comTenant(this.db, tenantId, async (tx) => {
      await tx.delete(pontoBancoMov).where(and(
        eq(pontoBancoMov.tenantId, tenantId),
        eq(pontoBancoMov.empregadoId, empregadoId),
        eq(pontoBancoMov.competencia, competencia),
      ));
      if (novos.length > 0) await tx.insert(pontoBancoMov).values(novos);
      const totalMin = novos.reduce((s, n) => s + n.minutos, 0);
      await tx.insert(pontoBancoFechamento).values({
        tenantId, empregadoId, competencia, totalMin, lancamentos: novos.length, origem,
      }).onConflictDoUpdate({
        target: [pontoBancoFechamento.tenantId, pontoBancoFechamento.empregadoId, pontoBancoFechamento.competencia],
        set: { totalMin, lancamentos: novos.length, origem, fechadoEm: new Date() },
      });
      return { competencia, lancados: novos.length, totalMin };
    });
  }

  /**
   * Primeira competência que faz sentido fechar pro funcionário: o mês da
   * data de início do ponto, ou da primeira batida, o que vier primeiro.
   * Null = não tem nada pra fechar ainda.
   */
  private async primeiraCompetencia(tenantId: string, empregadoId: string): Promise<string | null> {
    return comTenant(this.db, tenantId, async (tx) => {
      const emp = (await tx.select({ cpf: empregado.cpf, dataInicioPonto: empregado.dataInicioPonto })
        .from(empregado).where(and(eq(empregado.id, empregadoId), eq(empregado.tenantId, tenantId))).limit(1))[0];
      if (!emp) return null;
      const t = (await tx.select({ fuso: tenant.fuso }).from(tenant).where(eq(tenant.id, tenantId)).limit(1))[0];
      const fuso = t?.fuso ?? '-0300';
      const primeira = (await tx.select({ dt: min(pontoMarcacao.dtMarcacao) }).from(pontoMarcacao)
        .where(and(eq(pontoMarcacao.tenantId, tenantId), eq(pontoMarcacao.cpf, emp.cpf))))[0]?.dt;
      const candidatos: string[] = [];
      if (primeira) candidatos.push(diaLocal(primeira, fuso));
      if (emp.dataInicioPonto) candidatos.push(emp.dataInicioPonto);
      if (candidatos.length === 0) return null;
      // Data de início do ponto manda: antes dela a apuração ignora os dias.
      const inicio = emp.dataInicioPonto && (!primeira || emp.dataInicioPonto >= diaLocal(primeira, fuso))
        ? emp.dataInicioPonto
        : candidatos.sort()[0]!;
      return competenciaDe(inicio);
    });
  }

  /**
   * Fecha automaticamente toda competência já encerrada (anterior ao mês de
   * `hoje`) que ainda não tem fechamento. É chamada em toda consulta de saldo
   * e pelo cron — por isso precisa ser barata quando não há nada a fazer:
   * uma consulta na tabela de fechamentos e pronto.
   */
  async sincronizar(
    tenantId: string, empregadoId: string, hoje: string,
    cfgPronta?: { ativo: boolean; destinacaoFaltas: DestinoFalta; destinacaoAtrasos: DestinoAtraso },
  ): Promise<{ fechadas: string[] }> {
    const cfg = cfgPronta ?? await this.configBanco(tenantId, empregadoId);
    if (!cfg.ativo) return { fechadas: [] };

    const primeira = await this.primeiraCompetencia(tenantId, empregadoId);
    if (!primeira) return { fechadas: [] };

    const compAtual = competenciaDe(hoje);
    const ultimaFechavel = somarMesesComp(compAtual, -1);
    if (primeira > ultimaFechavel) return { fechadas: [] };

    const jaFechadas = new Set((await comTenant(this.db, tenantId, (tx) =>
      tx.select({ competencia: pontoBancoFechamento.competencia }).from(pontoBancoFechamento).where(and(
        eq(pontoBancoFechamento.tenantId, tenantId), eq(pontoBancoFechamento.empregadoId, empregadoId),
      )))).map((f) => f.competencia));

    const pendentes: string[] = [];
    let comp = primeira > somarMesesComp(ultimaFechavel, -LIMITE_MESES_SINCRONIZACAO)
      ? primeira : somarMesesComp(ultimaFechavel, -LIMITE_MESES_SINCRONIZACAO);
    while (comp <= ultimaFechavel) {
      if (!jaFechadas.has(comp)) pendentes.push(comp);
      comp = somarMesesComp(comp, 1);
    }

    const fechadas: string[] = [];
    for (const c of pendentes) {
      try {
        await this.lancarCompetencia(tenantId, empregadoId, c, 'AUTO');
        fechadas.push(c);
      } catch (e) {
        // Um mês que não dá pra apurar (sem REP, p.ex.) não pode travar os outros.
        this.log.warn(`Fechamento automático ${c} do empregado ${empregadoId} falhou: ${(e as Error).message}`);
      }
    }
    return { fechadas };
  }

  /**
   * Visão de todos os funcionários ativos: saldo oficial, mês em andamento,
   * projetado, vencimentos e devedor de cada um. Sincroniza no caminho (cada
   * saldo() já fecha o que estiver pendente). Quem não tem banco vem com
   * ativo=false, pra tela listar e explicar.
   */
  async resumoFuncionarios(tenantId: string, hoje: string) {
    const ativos = await comTenant(this.db, tenantId, (tx) =>
      tx.select({ id: empregado.id, nome: empregado.nome, matricula: empregado.matricula, dataInicioPonto: empregado.dataInicioPonto })
        .from(empregado)
        .where(and(eq(empregado.tenantId, tenantId), eq(empregado.ativo, true)))
        .orderBy(asc(empregado.nome)));
    const linhas = [];
    for (const e of ativos) {
      const r = await this.saldo(tenantId, e.id, hoje);
      if (!r.ativo || !r.saldo) {
        linhas.push({ empregadoId: e.id, nome: e.nome, matricula: e.matricula, ativo: false as const, tipoAcordo: r.tipoAcordo, formaCalculo: r.formaCalculo });
        continue;
      }
      const ultimo = r.extrato[0];
      linhas.push({
        empregadoId: e.id, nome: e.nome, matricula: e.matricula, ativo: true as const,
        tipoAcordo: r.tipoAcordo, formaCalculo: r.formaCalculo, prazoMeses: r.prazoMeses,
        saldoMin: r.saldo.saldoMin, mesCorrenteMin: r.mesCorrente?.estimadoMin ?? 0, projetadoMin: r.saldoProjetadoMin ?? r.saldo.saldoMin,
        creditadoMin: r.saldo.creditadoMin, compensadoMin: r.saldo.compensadoMin, pagoMin: r.saldo.pagoMin,
        devedorMin: r.saldo.devedorMin, vencidoMin: r.saldo.vencidoMin, aVencerMin: r.saldo.aVencerMin, proximoVencimento: r.saldo.proximoVencimento,
        ultimoMovimento: ultimo ? { data: ultimo.data, minutos: ultimo.minutos, descricao: ultimo.descricao ?? ultimo.tipo } : null,
        fechamentos: r.fechamentos.length,
        ultimoFechamento: r.fechamentos[0]?.competencia ?? null,
      });
    }
    const comBanco = linhas.filter((l) => l.ativo);
    const soma = (f: (l: (typeof comBanco)[number] & { ativo: true }) => number) =>
      comBanco.reduce((s, l) => s + f(l as never), 0);
    return {
      hoje, competencia: competenciaDe(hoje), linhas,
      totais: {
        funcionarios: linhas.length, comBanco: comBanco.length,
        saldoMin: soma((l) => l.saldoMin), mesCorrenteMin: soma((l) => l.mesCorrenteMin), projetadoMin: soma((l) => l.projetadoMin),
        vencidoMin: soma((l) => l.vencidoMin), aVencerMin: soma((l) => l.aVencerMin), devedorMin: soma((l) => l.devedorMin),
        comVencido: comBanco.filter((l) => (l as { vencidoMin?: number }).vencidoMin! > 0).length,
        comAVencer: comBanco.filter((l) => (l as { aVencerMin?: number }).aVencerMin! > 0).length,
        devendo: comBanco.filter((l) => (l as { projetadoMin?: number }).projetadoMin! < 0).length,
      },
    };
  }

  /** Sincroniza todos os funcionários ativos com banco de um tenant (cron). */
  async sincronizarTenant(tenantId: string, hoje: string): Promise<{ funcionarios: number; fechadas: number }> {
    const ativos = await comTenant(this.db, tenantId, (tx) =>
      tx.select({ id: empregado.id }).from(empregado)
        .where(and(eq(empregado.tenantId, tenantId), eq(empregado.ativo, true))));
    let funcionarios = 0, fechadas = 0;
    for (const e of ativos) {
      const cfg = await this.configBanco(tenantId, e.id);
      if (!cfg.ativo) continue;
      funcionarios++;
      fechadas += (await this.sincronizar(tenantId, e.id, hoje, cfg)).fechadas.length;
    }
    return { funcionarios, fechadas };
  }

  /** Sincroniza todos os tenants (cron). Cada um no seu fuso. */
  async sincronizarTodos(): Promise<void> {
    const tenants = await comoMaster(this.db, (tx) =>
      tx.select({ id: tenant.id, fuso: tenant.fuso, tipo: tenant.bancoTipoAcordo }).from(tenant));
    for (const t of tenants) {
      const hoje = diaLocal(new Date(), t.fuso ?? '-0300');
      try {
        const r = await this.sincronizarTenant(t.id, hoje);
        if (r.fechadas > 0) this.log.log(`Tenant ${t.id}: ${r.fechadas} competência(s) fechada(s) automaticamente`);
      } catch (e) {
        this.log.error(`Sincronização do tenant ${t.id} falhou: ${(e as Error).message}`);
      }
    }
  }

  /**
   * Refaz uma competência para TODOS os funcionários ativos de uma vez.
   * Reaproveita o lançamento individual (idempotente), então refazer o mês
   * substitui só o que veio da apuração — pagamentos e ajustes ficam intactos.
   */
  async lancarCompetenciaLote(tenantId: string, competencia: string) {
    if (!/^\d{4}-\d{2}$/.test(competencia)) throw new BadRequestException('Competência deve ser YYYY-MM');

    const ativos = await comTenant(this.db, tenantId, (tx) =>
      tx.select({ id: empregado.id, nome: empregado.nome }).from(empregado)
        .where(and(eq(empregado.tenantId, tenantId), eq(empregado.ativo, true)))
        .orderBy(asc(empregado.nome)));

    const porFuncionario: { empregadoId: string; nome: string; minutos: number }[] = [];
    let comBanco = 0;
    for (const e of ativos) {
      // Cada funcionário pela SUA regra: só lança pra quem tem banco ativo.
      const cfg = await this.configBanco(tenantId, e.id);
      if (!cfg.ativo) continue;
      comBanco++;
      const r = await this.lancarCompetencia(tenantId, e.id, competencia, 'MANUAL');
      porFuncionario.push({ empregadoId: e.id, nome: e.nome, minutos: r.totalMin });
    }
    if (comBanco === 0) throw new BadRequestException('Nenhum funcionário tem banco de horas ativo nesta empresa');
    const totalMin = porFuncionario.reduce((s, f) => s + f.minutos, 0);
    return { competencia, funcionarios: comBanco, totalMin, porFuncionario };
  }

  /**
   * Histórico de competências fechadas, agrupado por competência com total,
   * nº de funcionários, data do fechamento e detalhe. Antes de listar,
   * sincroniza a empresa inteira — assim a tela do RH já mostra os meses
   * fechados sem ninguém ter pedido.
   */
  async historicoCompetencias(tenantId: string, hoje: string) {
    await this.sincronizarTenant(tenantId, hoje);
    return comTenant(this.db, tenantId, async (tx) => {
      const fechs = await tx.select().from(pontoBancoFechamento)
        .where(eq(pontoBancoFechamento.tenantId, tenantId));

      const nomes = new Map((await tx.select({ id: empregado.id, nome: empregado.nome })
        .from(empregado).where(eq(empregado.tenantId, tenantId))).map((e) => [e.id, e.nome] as const));

      const porComp = new Map<string, { lancadoEm: Date; auto: number; func: Map<string, number> }>();
      for (const f of fechs) {
        const g = porComp.get(f.competencia) ?? { lancadoEm: f.fechadoEm, auto: 0, func: new Map<string, number>() };
        g.func.set(f.empregadoId, f.totalMin);
        if (f.origem === 'AUTO') g.auto++;
        if (f.fechadoEm > g.lancadoEm) g.lancadoEm = f.fechadoEm;
        porComp.set(f.competencia, g);
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
            automatico: g.auto === g.func.size,
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
   * Se o mês da folga já estava fechado, reabre — o dia era falta e deixou de ser.
   */
  async registrarFolga(tenantId: string, empregadoId: string, data: string, minutosManual?: number | null) {
    const cfg = await this.configBanco(tenantId, empregadoId);
    if (!cfg.ativo) throw new BadRequestException('Este funcionário não tem banco de horas ativo');
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
      await reabrirCompetencia(tx as never, tenantId, empregadoId, competenciaDe(data));
      return { data, minutos, movimento: mov };
    });
  }
}
