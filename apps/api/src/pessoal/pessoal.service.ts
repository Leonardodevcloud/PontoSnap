import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import {
  comTenant, empregado, pessoalCltConfig, pessoalPrestador, pessoalExclusao, pessoalLancamento,
  pessoalDebito, pessoalFechamento, type Db,
} from '@ponto/db';
import { DB } from '../database/database.module';
import { TratamentoService } from '../tratamento/tratamento.service';
import {
  calcularBeneficio, calcularMei, calcularSemanaMotorista, centavos, diasBase, faixaDoMes, parcelaNoMes,
  semanasDoMes, somarMeses, type BaseDias, type MotivoNaoUso, type PessoaTipo, type VtTipo,
} from './calculo';

const COMP_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const reais = (c: number) => (c / 100).toFixed(2);

export interface LinhaClt {
  empregadoId: string; nome: string; matricula: string | null;
  config: { cargo: string | null; vrDiaCent: number; cestaCent: number; vtTipo: VtTipo; vtValorCent: number; chavePix: string | null };
  salarioCent: number | null;
  diasMes: number; valorDiaMesCent: number; valorDia30Cent: number; valorHoraCent: number;
  heMin: number; heNoBancoMin: number; proventosCent: number;
  faltasDias: string[]; descontosCent: number; debitosCent: number;
  beneficios: {
    diasProx: number; diasProxLista: string[]; pagosEstimado: boolean;
    vrProxCent: number; vtProxCent: number;
    naoUsados: { data: string; motivo: MotivoNaoUso }[];
    acertoVrCent: number; acertoVtCent: number; acertoCent: number; cargaCent: number;
  };
  liquidoSalarioCent: number; custoBrutoCent: number; abatimentosCent: number; liquidoPagarCent: number;
  observacao: string | null;
  /** Sem escala/REP: a apuração falhou e os números do ponto ficaram zerados. */
  erro: string | null;
}
export interface LancMei {
  heMin: number; faltas: number; feriadosTrab: number; metaCent: number; metaPaga: boolean; metaPagaEm: string | null;
  nfNumero: string | null; nfData: string | null; pago: boolean; observacao: string | null;
}
export interface LinhaMei {
  id: string; nome: string; documento: string | null; funcao: string | null; valorCent: number; chavePix: string | null;
  baseDias: BaseDias; diasMes: number; lanc: LancMei; debitosCent: number;
  valorDiaCent: number; valorHoraCent: number; heCent: number; feriadosCent: number; faltasCent: number;
  brutoCent: number; metaDescontadaCent: number; abatimentosCent: number; liquidoCent: number;
}
export interface SemanaMot { inicio: string; fim: string; diasAuto: number; dias: number; adicionalCent: number; nfNumero: string | null; pago: boolean; totalCent: number }
export interface LinhaMot {
  id: string; nome: string; documento: string | null; funcao: string | null; valorCent: number; chavePix: string | null;
  baseDias: BaseDias; diasMes: number; diariaCent: number; semanas: SemanaMot[];
  totalCent: number; debitosCent: number; liquidoCent: number; observacao: string | null;
}
export interface LinhaDebito {
  id: string; pessoaTipo: PessoaTipo; pessoaId: string; nome: string; descricao: string;
  valorTotalCent: number; parcelas: number; competenciaInicio: string; parcelaAtual: number; parcelaCent: number;
}
export interface CompetenciaPessoal {
  competencia: string; proxima: string; fechado: boolean; fechadoEm: string | null;
  feriados: string[];
  clt: LinhaClt[]; mei: LinhaMei[]; motoristas: LinhaMot[]; debitos: LinhaDebito[];
  semanas: { inicio: string; fim: string }[];
  foraDoMes: { exclusaoId: string; pessoaTipo: PessoaTipo; pessoaId: string; nome: string; escopo: 'MES' | 'DIANTE'; desde: string }[];
  totais: { pessoas: { clt: number; mei: number; motoristas: number }; brutoCent: number; abatimentosCent: number; liquidoCent: number; beneficiosCent: number };
  pendencias: { nfMei: number; nfMotorista: number; semSalario: number; semPonto: number };
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

@Injectable()
export class PessoalService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly trat: TratamentoService,
  ) {}

  private validarComp(c: string) {
    if (!COMP_RE.test(c ?? '')) throw new BadRequestException('Competência inválida (use YYYY-MM)');
  }

  private async fechamento(tx: Tx, tenantId: string, comp: string) {
    return (await tx.select().from(pessoalFechamento)
      .where(and(eq(pessoalFechamento.tenantId, tenantId), eq(pessoalFechamento.competencia, comp))).limit(1))[0];
  }

  /** Bloqueia escrita numa competência já fechada. */
  private async exigirAberta(tenantId: string, comp: string) {
    const f = await comTenant(this.db, tenantId, (tx) => this.fechamento(tx, tenantId, comp));
    if (f) throw new BadRequestException(`A competência ${comp} está fechada. Reabra para editar.`);
  }

  // ======================= leitura =======================

  async competencia(tenantId: string, comp: string): Promise<CompetenciaPessoal> {
    this.validarComp(comp);
    const fech = await comTenant(this.db, tenantId, (tx) => this.fechamento(tx, tenantId, comp));
    if (fech) return { ...(fech.snapshot as CompetenciaPessoal), fechado: true, fechadoEm: fech.fechadoEm.toISOString() };
    return this.calcular(tenantId, comp);
  }

  private async calcular(tenantId: string, comp: string): Promise<CompetenciaPessoal> {
    const { inicio, fim } = faixaDoMes(comp);
    const prox = somarMeses(comp, 1);
    const fx = faixaDoMes(prox);

    const dados = await comTenant(this.db, tenantId, async (tx) => {
      const emps = await tx.select().from(empregado)
        .where(and(eq(empregado.tenantId, tenantId), eq(empregado.ativo, true))).orderBy(asc(empregado.nome));
      const configs = await tx.select().from(pessoalCltConfig).where(eq(pessoalCltConfig.tenantId, tenantId));
      const prest = await tx.select().from(pessoalPrestador)
        .where(and(eq(pessoalPrestador.tenantId, tenantId), lte(pessoalPrestador.competenciaInicio, comp)))
        .orderBy(asc(pessoalPrestador.nome));
      const excl = await tx.select().from(pessoalExclusao)
        .where(and(eq(pessoalExclusao.tenantId, tenantId), lte(pessoalExclusao.competencia, comp)));
      const lancs = await tx.select().from(pessoalLancamento)
        .where(and(eq(pessoalLancamento.tenantId, tenantId), eq(pessoalLancamento.competencia, comp)));
      const debs = await tx.select().from(pessoalDebito)
        .where(and(eq(pessoalDebito.tenantId, tenantId), lte(pessoalDebito.competenciaInicio, comp)));
      const fechAnt = await this.fechamento(tx, tenantId, somarMeses(comp, -1));
      return { emps, configs, prest, excl, lancs, debs, fechAnt };
    });

    // Quem está fora deste mês: exclusão do próprio mês, ou "daqui em diante" de um mês anterior.
    const exclusaoDe = (tipo: PessoaTipo, id: string) => {
      const doTipo = dados.excl.filter((x) => x.pessoaTipo === tipo && x.pessoaId === id);
      return doTipo.find((x) => x.competencia === comp)
        ?? doTipo.filter((x) => x.escopo === 'DIANTE').sort((a, b) => b.competencia.localeCompare(a.competencia))[0];
    };
    const lancDe = (tipo: PessoaTipo, id: string, periodo = 'MES') =>
      dados.lancs.find((l) => l.pessoaTipo === tipo && l.pessoaId === id && l.periodo === periodo);
    const debitosDe = (tipo: PessoaTipo, id: string) => dados.debs
      .filter((d) => d.pessoaTipo === tipo && d.pessoaId === id)
      .reduce((s, d) => s + (parcelaNoMes({ valorTotalCent: centavos(d.valorTotal), parcelas: d.parcelas, competenciaInicio: d.competenciaInicio }, comp)?.valorCent ?? 0), 0);

    const feriadosLista = (await this.trat.listarFeriados(tenantId, inicio, fim)).map((f) => f.data);
    const feriadosProx = (await this.trat.listarFeriados(tenantId, fx.inicio, fx.fim)).map((f) => f.data);
    const feriados = new Set(feriadosLista);
    const snapAnt = dados.fechAnt?.snapshot as CompetenciaPessoal | undefined;

    const foraDoMes: CompetenciaPessoal['foraDoMes'] = [];

    // ---------- CLT (base do ponto) ----------
    const clt: LinhaClt[] = [];
    for (const e of dados.emps) {
      const ex = exclusaoDe('CLT', e.id);
      if (ex) { foraDoMes.push({ exclusaoId: ex.id, pessoaTipo: 'CLT', pessoaId: e.id, nome: e.nome, escopo: ex.escopo as 'MES' | 'DIANTE', desde: ex.competencia }); continue; }
      if (e.dataInicioPonto && e.dataInicioPonto > fim) continue; // ainda não começou

      const cfg = dados.configs.find((c) => c.empregadoId === e.id);
      const config = {
        cargo: cfg?.cargo ?? null,
        vrDiaCent: centavos(cfg?.vrDia), cestaCent: centavos(cfg?.cestaMensal),
        vtTipo: (cfg?.vtTipo ?? 'NENHUM') as VtTipo, vtValorCent: centavos(cfg?.vtValor), chavePix: cfg?.chavePix ?? null,
      };
      const salarioCent = e.salarioMensal != null ? centavos(e.salarioMensal) : null;

      let erro: string | null = null;
      let diasUteis: string[] = [], diasPrevistos: string[] = [], diasEscala: string[] = [];
      let diasProxLista: string[] = [];
      let heMin = 0, heNoBancoMin = 0, proventosCent = 0, descontosCent = 0;
      let faltasDias: string[] = [];
      try {
        const ap = await this.trat.apurarPeriodoCLT(tenantId, e.id, inicio, fim, feriadosLista);
        diasUteis = ap.diasUteis; diasPrevistos = ap.diasPrevistos; diasEscala = ap.diasEscala;
        heMin = ap.resultado.totalExtrasMin;
        faltasDias = ap.resultado.dias.filter((d) => d.faltaMin > 0 && d.minutosTrabalhados === 0).map((d) => d.data);
        if (ap.valores) {
          heNoBancoMin = ap.valores.extrasNoBancoMin;
          proventosCent = ap.valores.extrasCentavos + ap.valores.adicionalNoturnoCentavos + ap.valores.reflexoDsrCentavos;
          descontosCent = ap.valores.descontoFaltasCentavos + ap.valores.descontoAtrasosCentavos + ap.valores.descontoDsrPerdidoCentavos;
        }
        const apProx = await this.trat.apurarPeriodoCLT(tenantId, e.id, fx.inicio, fx.fim, feriadosProx);
        diasProxLista = apProx.diasPrevistos;
      } catch (err) {
        erro = (err as Error).message || 'Sem escala ou REP configurado';
      }

      // Dias pagos para este mês: o que a carga anterior registrou no fechamento.
      // Sem fechamento anterior (primeiro mês no sistema), estima pelo
      // calendário da escala sem descontar feriado — é o que se fazia à mão.
      const pagosSnap = snapAnt?.clt.find((x) => x.empregadoId === e.id)?.beneficios.diasProxLista;
      const pagos = pagosSnap ?? diasEscala;
      const ben = calcularBeneficio({
        vrDiaCent: config.vrDiaCent, cestaCent: config.cestaCent, vtTipo: config.vtTipo, vtValorCent: config.vtValorCent,
        diasProx: diasProxLista.length, pagos,
        previstosMes: new Set(diasPrevistos), faltas: new Set(faltasDias), feriados,
      });

      const sal = salarioCent ?? 0;
      const diasMes = diasUteis.length;
      const debitosCent = debitosDe('CLT', e.id);
      const liquidoSalarioCent = sal + proventosCent - descontosCent - debitosCent;
      const custoBrutoCent = sal + proventosCent - descontosCent + ben.vrProxCent + ben.vtProxCent;
      const abatimentosCent = debitosCent + ben.acertoCent;
      clt.push({
        empregadoId: e.id, nome: e.nome, matricula: e.matricula, config, salarioCent,
        diasMes,
        valorDiaMesCent: diasMes ? Math.round(sal / diasMes) : 0,
        valorDia30Cent: Math.round(sal / 30),
        valorHoraCent: Math.round(sal / 220),
        heMin, heNoBancoMin, proventosCent, faltasDias, descontosCent, debitosCent,
        beneficios: { ...ben, diasProx: diasProxLista.length, diasProxLista, pagosEstimado: !pagosSnap },
        liquidoSalarioCent, custoBrutoCent, abatimentosCent,
        liquidoPagarCent: liquidoSalarioCent + ben.cargaCent,
        observacao: lancDe('CLT', e.id)?.observacao ?? null,
        erro,
      });
    }

    // ---------- MEI ----------
    const mei: LinhaMei[] = [];
    const motoristas: LinhaMot[] = [];
    const semanas = semanasDoMes(comp);
    for (const p of dados.prest) {
      const tipo = p.tipo as PessoaTipo;
      const ex = exclusaoDe(tipo, p.id);
      if (ex) { foraDoMes.push({ exclusaoId: ex.id, pessoaTipo: tipo, pessoaId: p.id, nome: p.nome, escopo: ex.escopo as 'MES' | 'DIANTE', desde: ex.competencia }); continue; }
      const base = p.baseDias as BaseDias;
      const diasMes = diasBase(comp, base, feriados).length;
      const valorCent = centavos(p.valorMensal);
      const debitosCent = debitosDe(tipo, p.id);

      if (tipo === 'MEI') {
        const l = lancDe('MEI', p.id);
        const lanc: LancMei = {
          heMin: l?.heMin ?? 0, faltas: l?.faltas ?? 0, feriadosTrab: l?.feriadosTrab ?? 0,
          metaCent: centavos(l?.meta), metaPaga: l?.metaPaga ?? false, metaPagaEm: l?.metaPagaEm ?? null,
          nfNumero: l?.nfNumero ?? null, nfData: l?.nfData ?? null, pago: l?.pago ?? false, observacao: l?.observacao ?? null,
        };
        const r = calcularMei({ valorCent, diasMes, heMin: lanc.heMin, faltas: lanc.faltas, feriadosTrab: lanc.feriadosTrab, metaCent: lanc.metaCent, metaPaga: lanc.metaPaga, debitosCent });
        mei.push({ id: p.id, nome: p.nome, documento: p.documento, funcao: p.funcao, valorCent, chavePix: p.chavePix, baseDias: base, diasMes, lanc, debitosCent, ...r });
      } else {
        const sem: SemanaMot[] = semanas.map((s) => {
          const l = lancDe('MOTORISTA', p.id, s.inicio);
          const diasAuto = s.dias.filter((d) => diasBase(comp, base, feriados).includes(d)).length;
          const dias = l?.dias ?? diasAuto;
          const adicionalCent = centavos(l?.adicional);
          const { totalCent } = calcularSemanaMotorista({ mensalCent: valorCent, diasMes, dias, adicionalCent });
          return { inicio: s.inicio, fim: s.fim, diasAuto, dias, adicionalCent, nfNumero: l?.nfNumero ?? null, pago: l?.pago ?? false, totalCent };
        });
        // Arredonda uma vez no mês: dias × (mensal ÷ dias do mês) fecha no mensal exato.
        const totalCent = Math.round((valorCent / Math.max(1, diasMes)) * sem.reduce((a, s) => a + s.dias, 0))
          + sem.reduce((a, s) => a + s.adicionalCent, 0);
        motoristas.push({
          id: p.id, nome: p.nome, documento: p.documento, funcao: p.funcao, valorCent, chavePix: p.chavePix, baseDias: base, diasMes,
          diariaCent: calcularSemanaMotorista({ mensalCent: valorCent, diasMes, dias: 1, adicionalCent: 0 }).diariaCent,
          semanas: sem, totalCent, debitosCent, liquidoCent: totalCent - debitosCent,
          observacao: lancDe('MOTORISTA', p.id)?.observacao ?? null,
        });
      }
    }

    // ---------- débitos do mês ----------
    const nomeDe = (tipo: string, id: string) =>
      (tipo === 'CLT' ? dados.emps.find((e) => e.id === id)?.nome : dados.prest.find((p) => p.id === id)?.nome) ?? '—';
    const ativos = new Set([...clt.map((c) => `CLT:${c.empregadoId}`), ...mei.map((m) => `MEI:${m.id}`), ...motoristas.map((m) => `MOTORISTA:${m.id}`)]);
    const debitos: LinhaDebito[] = dados.debs.flatMap((d) => {
      const pc = parcelaNoMes({ valorTotalCent: centavos(d.valorTotal), parcelas: d.parcelas, competenciaInicio: d.competenciaInicio }, comp);
      if (!pc || !ativos.has(`${d.pessoaTipo}:${d.pessoaId}`)) return [];
      return [{
        id: d.id, pessoaTipo: d.pessoaTipo as PessoaTipo, pessoaId: d.pessoaId, nome: nomeDe(d.pessoaTipo, d.pessoaId), descricao: d.descricao,
        valorTotalCent: centavos(d.valorTotal), parcelas: d.parcelas, competenciaInicio: d.competenciaInicio,
        parcelaAtual: pc.numero, parcelaCent: pc.valorCent,
      }];
    });

    const soma = <T>(l: T[], f: (x: T) => number) => l.reduce((s, x) => s + f(x), 0);
    const totais = {
      pessoas: { clt: clt.length, mei: mei.length, motoristas: motoristas.length },
      brutoCent: soma(clt, (c) => c.custoBrutoCent) + soma(mei, (m) => m.brutoCent) + soma(motoristas, (m) => m.totalCent),
      abatimentosCent: soma(clt, (c) => c.abatimentosCent) + soma(mei, (m) => m.abatimentosCent) + soma(motoristas, (m) => m.debitosCent),
      liquidoCent: soma(clt, (c) => c.liquidoPagarCent) + soma(mei, (m) => m.liquidoCent) + soma(motoristas, (m) => m.liquidoCent),
      beneficiosCent: soma(clt, (c) => c.beneficios.cargaCent),
    };
    return {
      competencia: comp, proxima: prox, fechado: false, fechadoEm: null,
      feriados: feriadosLista, clt, mei, motoristas, debitos,
      semanas: semanas.map((s) => ({ inicio: s.inicio, fim: s.fim })),
      foraDoMes, totais,
      pendencias: {
        nfMei: mei.filter((m) => !m.lanc.nfNumero).length,
        nfMotorista: motoristas.reduce((a, m) => a + m.semanas.filter((s) => s.dias > 0 && !s.nfNumero).length, 0),
        semSalario: clt.filter((c) => c.salarioCent == null).length,
        semPonto: clt.filter((c) => c.erro).length,
      },
    };
  }

  // ======================= escrita =======================

  async salvarConfigClt(tenantId: string, empregadoId: string, d: {
    cargo?: string | null; vrDia: number; cestaMensal: number; vtTipo: VtTipo; vtValor: number; chavePix?: string | null;
  }) {
    return comTenant(this.db, tenantId, async (tx) => {
      const e = (await tx.select({ id: empregado.id }).from(empregado)
        .where(and(eq(empregado.id, empregadoId), eq(empregado.tenantId, tenantId))).limit(1))[0];
      if (!e) throw new NotFoundException('Funcionário não encontrado');
      const v = {
        cargo: d.cargo?.trim() || null, vrDia: reais(centavos(d.vrDia)), cestaMensal: reais(centavos(d.cestaMensal)),
        vtTipo: d.vtTipo, vtValor: reais(centavos(d.vtValor)), chavePix: d.chavePix?.trim() || null, atualizadoEm: new Date(),
      };
      const [r] = await tx.insert(pessoalCltConfig).values({ tenantId, empregadoId, ...v })
        .onConflictDoUpdate({ target: [pessoalCltConfig.tenantId, pessoalCltConfig.empregadoId], set: v }).returning();
      return r;
    });
  }

  async criarPrestador(tenantId: string, d: {
    tipo: 'MEI' | 'MOTORISTA'; nome: string; documento?: string | null; funcao?: string | null;
    valorMensal: number; baseDias: BaseDias; chavePix?: string | null; competenciaInicio: string;
  }) {
    this.validarComp(d.competenciaInicio);
    return comTenant(this.db, tenantId, async (tx) => {
      const [r] = await tx.insert(pessoalPrestador).values({
        tenantId, tipo: d.tipo, nome: d.nome.trim(), documento: d.documento?.trim() || null, funcao: d.funcao?.trim() || null,
        valorMensal: reais(centavos(d.valorMensal)), baseDias: d.baseDias, chavePix: d.chavePix?.trim() || null,
        competenciaInicio: d.competenciaInicio,
      }).returning();
      return r;
    });
  }

  async editarPrestador(tenantId: string, id: string, d: Partial<{
    nome: string; documento: string | null; funcao: string | null; valorMensal: number; baseDias: BaseDias; chavePix: string | null;
  }>) {
    return comTenant(this.db, tenantId, async (tx) => {
      const set: Record<string, unknown> = {};
      if (d.nome !== undefined) set.nome = d.nome.trim();
      if (d.documento !== undefined) set.documento = d.documento?.trim() || null;
      if (d.funcao !== undefined) set.funcao = d.funcao?.trim() || null;
      if (d.valorMensal !== undefined) set.valorMensal = reais(centavos(d.valorMensal));
      if (d.baseDias !== undefined) set.baseDias = d.baseDias;
      if (d.chavePix !== undefined) set.chavePix = d.chavePix?.trim() || null;
      const rows = await tx.update(pessoalPrestador).set(set)
        .where(and(eq(pessoalPrestador.id, id), eq(pessoalPrestador.tenantId, tenantId))).returning();
      if (!rows[0]) throw new NotFoundException('Prestador não encontrado');
      return rows[0];
    });
  }

  /** Lançamento do mês (MEI, observação de qualquer um) ou da semana (motorista). */
  async salvarLancamento(tenantId: string, d: {
    pessoaTipo: PessoaTipo; pessoaId: string; competencia: string; periodo?: string;
    heMin?: number; faltas?: number; feriadosTrab?: number; dias?: number | null; adicional?: number;
    meta?: number; metaPaga?: boolean; metaPagaEm?: string | null; nfNumero?: string | null; nfData?: string | null;
    pago?: boolean; observacao?: string | null;
  }) {
    this.validarComp(d.competencia);
    await this.exigirAberta(tenantId, d.competencia);
    const periodo = d.periodo ?? 'MES';
    const set: Record<string, unknown> = { atualizadoEm: new Date() };
    for (const k of ['heMin', 'faltas', 'feriadosTrab', 'dias', 'metaPaga', 'pago'] as const) if (d[k] !== undefined) set[k] = d[k];
    if (d.adicional !== undefined) set.adicional = reais(centavos(d.adicional));
    if (d.meta !== undefined) set.meta = reais(centavos(d.meta));
    for (const k of ['metaPagaEm', 'nfNumero', 'nfData', 'observacao'] as const) {
      if (d[k] !== undefined) set[k] = (typeof d[k] === 'string' ? (d[k] as string).trim() : d[k]) || null;
    }
    if (d.metaPaga === false) set.metaPagaEm = null;
    return comTenant(this.db, tenantId, async (tx) => {
      const [r] = await tx.insert(pessoalLancamento).values({
        tenantId, pessoaTipo: d.pessoaTipo, pessoaId: d.pessoaId, competencia: d.competencia, periodo, ...set,
      }).onConflictDoUpdate({
        target: [pessoalLancamento.tenantId, pessoalLancamento.pessoaTipo, pessoalLancamento.pessoaId, pessoalLancamento.competencia, pessoalLancamento.periodo],
        set,
      }).returning();
      return r;
    });
  }

  /** Tira a pessoa do mês (ou daquele mês em diante). Nunca apaga histórico. */
  async excluir(tenantId: string, d: { pessoaTipo: PessoaTipo; pessoaId: string; competencia: string; escopo: 'MES' | 'DIANTE' }) {
    this.validarComp(d.competencia);
    await this.exigirAberta(tenantId, d.competencia);
    return comTenant(this.db, tenantId, async (tx) => {
      const [r] = await tx.insert(pessoalExclusao).values({ tenantId, ...d })
        .onConflictDoUpdate({
          target: [pessoalExclusao.tenantId, pessoalExclusao.pessoaTipo, pessoalExclusao.pessoaId, pessoalExclusao.competencia],
          set: { escopo: d.escopo },
        }).returning();
      return r;
    });
  }

  /** Desfaz uma exclusão (volta a pessoa a partir da competência da exclusão). */
  async desfazerExclusao(tenantId: string, id: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const ex = (await tx.select().from(pessoalExclusao)
        .where(and(eq(pessoalExclusao.id, id), eq(pessoalExclusao.tenantId, tenantId))).limit(1))[0];
      if (!ex) throw new NotFoundException('Exclusão não encontrada');
      if (await this.fechamento(tx, tenantId, ex.competencia)) {
        throw new BadRequestException(`A competência ${ex.competencia} está fechada. Reabra para editar.`);
      }
      await tx.delete(pessoalExclusao).where(eq(pessoalExclusao.id, id));
      return { removido: true };
    });
  }

  async criarDebito(tenantId: string, d: {
    pessoaTipo: PessoaTipo; pessoaId: string; descricao: string; valorTotal: number; parcelas: number; competenciaInicio: string;
  }) {
    this.validarComp(d.competenciaInicio);
    await this.exigirAberta(tenantId, d.competenciaInicio);
    if (d.valorTotal <= 0) throw new BadRequestException('Informe um valor maior que zero');
    return comTenant(this.db, tenantId, async (tx) => {
      const [r] = await tx.insert(pessoalDebito).values({
        tenantId, pessoaTipo: d.pessoaTipo, pessoaId: d.pessoaId, descricao: d.descricao.trim(),
        valorTotal: reais(centavos(d.valorTotal)), parcelas: d.parcelas, competenciaInicio: d.competenciaInicio,
      }).returning();
      return r;
    });
  }

  async removerDebito(tenantId: string, id: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const d = (await tx.select().from(pessoalDebito)
        .where(and(eq(pessoalDebito.id, id), eq(pessoalDebito.tenantId, tenantId))).limit(1))[0];
      if (!d) throw new NotFoundException('Débito não encontrado');
      // Débito que já caiu num mês fechado não pode sumir: mudaria o passado.
      const fechados = await tx.select({ c: pessoalFechamento.competencia }).from(pessoalFechamento)
        .where(eq(pessoalFechamento.tenantId, tenantId));
      const atingido = fechados.find((f) => parcelaNoMes({ valorTotalCent: 1, parcelas: d.parcelas, competenciaInicio: d.competenciaInicio }, f.c));
      if (atingido) throw new BadRequestException(`Este débito já foi descontado em ${atingido.c}, que está fechado. Reabra esse mês para remover.`);
      await tx.delete(pessoalDebito).where(eq(pessoalDebito.id, id));
      return { removido: true };
    });
  }

  /**
   * Fecha a competência: grava o retrato do mês (é ele que a tela mostra daí
   * em diante) e os dias de benefício carregados para o mês seguinte — base
   * do acerto quando o próximo mês fechar.
   */
  async fechar(tenantId: string, comp: string) {
    this.validarComp(comp);
    await this.exigirAberta(tenantId, comp);
    const snap = await this.calcular(tenantId, comp);
    return comTenant(this.db, tenantId, async (tx) => {
      const [r] = await tx.insert(pessoalFechamento).values({ tenantId, competencia: comp, snapshot: snap }).returning();
      return { competencia: comp, fechadoEm: r!.fechadoEm };
    });
  }

  async reabrir(tenantId: string, comp: string) {
    this.validarComp(comp);
    return comTenant(this.db, tenantId, async (tx) => {
      // Reabrir um mês com o seguinte já fechado deixaria o acerto do seguinte
      // apoiado num retrato que pode mudar.
      const seg = await this.fechamento(tx, tenantId, somarMeses(comp, 1));
      if (seg) throw new BadRequestException(`Reabra ${somarMeses(comp, 1)} antes de reabrir ${comp}.`);
      await tx.delete(pessoalFechamento)
        .where(and(eq(pessoalFechamento.tenantId, tenantId), eq(pessoalFechamento.competencia, comp)));
      return { reaberto: true };
    });
  }

  /** Lista enxuta de pessoas (para o seletor de débito). */
  async pessoas(tenantId: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const emps = await tx.select({ id: empregado.id, nome: empregado.nome }).from(empregado)
        .where(and(eq(empregado.tenantId, tenantId), eq(empregado.ativo, true))).orderBy(asc(empregado.nome));
      const prest = await tx.select({ id: pessoalPrestador.id, nome: pessoalPrestador.nome, tipo: pessoalPrestador.tipo })
        .from(pessoalPrestador).where(and(eq(pessoalPrestador.tenantId, tenantId), inArray(pessoalPrestador.tipo, ['MEI', 'MOTORISTA'])))
        .orderBy(asc(pessoalPrestador.nome));
      return [
        ...emps.map((e) => ({ pessoaTipo: 'CLT' as const, pessoaId: e.id, nome: e.nome })),
        ...prest.map((p) => ({ pessoaTipo: p.tipo as PessoaTipo, pessoaId: p.id, nome: p.nome })),
      ];
    });
  }
}
