import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import {
  comTenant, empregado, pessoalCltConfig, pessoalPadrao, pessoalPrestadorValor, pessoalCltCesta, pessoalNfArquivo, pessoalPrestador, pessoalExclusao, pessoalLancamento,
  pessoalDebito, pessoalFechamento, type Db,
} from '@ponto/db';
import { DB } from '../database/database.module';

/** Competência corrente no fuso de Brasília. */
const mesCorrente = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7);
import { salarioDoMes, salarioEm } from '@ponto/apuracao-clt';
import { TratamentoService } from '../tratamento/tratamento.service';
import { CriptoService } from '../common/cripto.service';
import {
  calcularBeneficio, calcularMei, calcularSemanaMotorista, centavos, diasBase, faixaDoMes, parcelaNoMes,
  semanasDoMes, somarMeses, type BaseDias, type MotivoNaoUso, type PessoaTipo, type VtTipo,
} from './calculo';

const COMP_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const reais = (c: number) => (c / 100).toFixed(2);

export interface LinhaClt {
  empregadoId: string; nome: string; matricula: string | null;
  /**
   * Valores aplicados na carga do próximo mês. origem: PADRAO (segue o padrão
   * da empresa), PROPRIO (valor da pessoa) ou NENHUM (sem benefício).
   * vigenteDesde = mês do benefício a partir do qual esse valor vale.
   */
  config: ConfigBeneficio & { cargo: string | null; chavePix: string | null; origem: 'PADRAO' | 'PROPRIO' | 'NENHUM'; vigenteDesde: string | null };
  /** Salário do MÊS (proporcional se mudou no meio). null = sem salário. */
  salarioCent: number | null;
  /** Trechos do mês quando o salário mudou (promoção/reajuste); 1 trecho = sem mudança. */
  salarioPartes: { desde: string; ate: string; dias: number; salarioCent: number; valorCent: number }[];
  diasMes: number; valorDiaMesCent: number; valorDia30Cent: number; valorHoraCent: number;
  /** Hora extra de verdade (sem indenização), e quanto dela foi pro banco. */
  heMin: number; heNoBancoMin: number;
  /** Indenização de intervalo/interjornada: sempre paga, não é hora extra. */
  indenizacaoMin: number; indenizacaoCent: number;
  /** Tudo que é pago em R$ vindo do ponto: extras pagas + indenização + noturno + reflexo. */
  proventosCent: number;
  faltasDias: string[]; descontosCent: number; debitosCent: number;
  beneficios: {
    diasProx: number; diasProxLista: string[]; pagosEstimado: boolean;
    vrProxCent: number; vtProxCent: number;
    naoUsados: { data: string; motivo: MotivoNaoUso }[];
    acertoVrCent: number; acertoVtCent: number; acertoCent: number; cargaCent: number;
    /** Cesta do mês apurado: paga só sem falta e depois da carência. */
    cestaCent: number; cestaStatus: 'PAGA' | 'PERDIDA_FALTA' | 'CARENCIA' | 'SEM_CESTA';
    /** Mês a partir do qual a cesta é paga; origem MANUAL (definido no painel) ou AUTO (3 meses após o início no ponto). */
    cestaDesde: string | null; cestaDesdeOrigem: 'MANUAL' | 'AUTO' | null;
  };
  liquidoSalarioCent: number; custoBrutoCent: number; abatimentosCent: number; liquidoPagarCent: number;
  observacao: string | null;
  /** Sem escala/REP: a apuração falhou e os números do ponto ficaram zerados. */
  erro: string | null;
}
export interface ConfigBeneficio { vrDiaCent: number; cestaCent: number; vtTipo: VtTipo; vtValorCent: number }
export interface PadraoBeneficio extends ConfigBeneficio { vigenteDesde: string }

export interface LancMei {
  heMin: number; faltas: number; feriadosTrab: number; metaCent: number; metaPaga: boolean; metaPagaEm: string | null;
  nfNumero: string | null; nfData: string | null; pago: boolean; observacao: string | null;
  /** Quanto foi pago e quando (null enquanto não pago). */
  valorPagoCent: number | null; pagoEm: string | null;
  /** Arquivo da NF enviado (metadados; o conteúdo baixa por /pessoal/nf/:id). */
  nfArquivo: NfArquivo | null;
}
export interface NfArquivo { id: string; nome: string; mime: string; bytes: number; enviadoEm: string }
/** Valor de contrato com vigência (o mês usa a linha mais recente ≤ ele). */
export interface ValorContrato { vigenteDesde: string; valorCent: number; baseDias: BaseDias }

/** Registro de pagamento do mês (motorista: linha MES, além do "pago" de cada semana). */
export interface PagamentoMes { pago: boolean; valorPagoCent: number | null; pagoEm: string | null }
export interface LinhaMei {
  id: string; nome: string; documento: string | null; funcao: string | null; empresa: string | null; valorCent: number; chavePix: string | null;
  /** Desde quando o valor deste mês vale + histórico de reajustes (mais recente primeiro). */
  valorDesde: string; historicoValores: ValorContrato[];
  baseDias: BaseDias; diasMes: number; lanc: LancMei; debitosCent: number;
  valorDiaCent: number; valorHoraCent: number; heCent: number; feriadosCent: number; faltasCent: number;
  brutoCent: number; metaDescontadaCent: number; abatimentosCent: number; liquidoCent: number;
}
export interface SemanaMot { inicio: string; fim: string; diasAuto: number; dias: number; adicionalCent: number; nfNumero: string | null; pago: boolean; totalCent: number; nfArquivo: NfArquivo | null }
export interface LinhaMot {
  id: string; nome: string; documento: string | null; funcao: string | null; empresa: string | null; valorCent: number; chavePix: string | null;
  valorDesde: string; historicoValores: ValorContrato[];
  baseDias: BaseDias; diasMes: number; diariaCent: number; semanas: SemanaMot[];
  totalCent: number; debitosCent: number; liquidoCent: number; observacao: string | null;
  pagamento: PagamentoMes;
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
  /** Padrão da empresa que vale para a carga do próximo mês (null = não definido). */
  padrao: PadraoBeneficio | null;
  /** Histórico do padrão (mais recente primeiro). */
  padroes: PadraoBeneficio[];
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

@Injectable()
export class PessoalService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly trat: TratamentoService,
    private readonly cripto: CriptoService,
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
    if (fech) return this.sobreporPagamento(tenantId, { ...(fech.snapshot as CompetenciaPessoal), fechado: true, fechadoEm: fech.fechadoEm.toISOString() });
    return this.calcular(tenantId, comp);
  }

  /**
   * Mês fechado é retrato dos VALORES. Mas NF e pagamento chegam depois do
   * fechamento — então número/data da NF, arquivo e "pago" são lidos ao vivo
   * por cima do retrato.
   */
  private async sobreporPagamento(tenantId: string, snap: CompetenciaPessoal): Promise<CompetenciaPessoal> {
    const comp = snap.competencia;
    const { lancs, nfs } = await comTenant(this.db, tenantId, async (tx) => ({
      lancs: await tx.select().from(pessoalLancamento).where(and(eq(pessoalLancamento.tenantId, tenantId), eq(pessoalLancamento.competencia, comp))),
      nfs: await this.nfsDoMes(tx, tenantId, comp),
    }));
    const l = (tipo: string, id: string, per: string) => lancs.find((x) => x.pessoaTipo === tipo && x.pessoaId === id && x.periodo === per);
    const pg = (x?: { pago: boolean; valorPago: string | null; pagoEm: Date | null }) => ({
      valorPagoCent: x?.pago && x.valorPago != null ? centavos(x.valorPago) : null,
      pagoEm: x?.pago && x.pagoEm ? x.pagoEm.toISOString() : null,
    });
    const mei = snap.mei.map((m) => {
      const x = l('MEI', m.id, 'MES');
      return { ...m, lanc: { ...m.lanc, nfNumero: x?.nfNumero ?? null, nfData: x?.nfData ?? null, pago: x?.pago ?? false, ...pg(x), nfArquivo: nfs.get(`MEI:${m.id}:MES`) ?? null } };
    });
    const motoristas = snap.motoristas.map((m) => ({
      ...m,
      pagamento: { pago: l('MOTORISTA', m.id, 'MES')?.pago ?? false, ...pg(l('MOTORISTA', m.id, 'MES')) },
      semanas: m.semanas.map((s) => {
        const x = l('MOTORISTA', m.id, s.inicio);
        return { ...s, nfNumero: x?.nfNumero ?? null, pago: x?.pago ?? false, nfArquivo: nfs.get(`MOTORISTA:${m.id}:${s.inicio}`) ?? null };
      }),
    }));
    return {
      ...snap, mei, motoristas,
      pendencias: {
        ...snap.pendencias,
        nfMei: mei.filter((m) => !m.lanc.nfNumero && !m.lanc.nfArquivo).length,
        nfMotorista: motoristas.reduce((a, m) => a + m.semanas.filter((s) => s.dias > 0 && !s.nfNumero && !s.nfArquivo).length, 0),
      },
    };
  }

  /** Metadados das NFs do mês (sem o conteúdo), por "TIPO:pessoa:período". */
  private async nfsDoMes(tx: Tx, tenantId: string, comp: string): Promise<Map<string, NfArquivo>> {
    const rows = await tx.select({
      id: pessoalNfArquivo.id, pessoaTipo: pessoalNfArquivo.pessoaTipo, pessoaId: pessoalNfArquivo.pessoaId, periodo: pessoalNfArquivo.periodo,
      nome: pessoalNfArquivo.arquivoNome, mime: pessoalNfArquivo.arquivoMime, bytes: pessoalNfArquivo.arquivoBytes, criadoEm: pessoalNfArquivo.criadoEm,
    }).from(pessoalNfArquivo).where(and(eq(pessoalNfArquivo.tenantId, tenantId), eq(pessoalNfArquivo.competencia, comp)));
    return new Map(rows.map((r) => [`${r.pessoaTipo}:${r.pessoaId}:${r.periodo}`, { id: r.id, nome: r.nome, mime: r.mime, bytes: r.bytes, enviadoEm: r.criadoEm.toISOString() }]));
  }

  private async calcular(tenantId: string, comp: string): Promise<CompetenciaPessoal> {
    const { inicio, fim } = faixaDoMes(comp);
    const prox = somarMeses(comp, 1);
    const fx = faixaDoMes(prox);

    const dados = await comTenant(this.db, tenantId, async (tx) => {
      const emps = await tx.select().from(empregado)
        .where(and(eq(empregado.tenantId, tenantId), eq(empregado.ativo, true))).orderBy(asc(empregado.nome));
      const configs = await tx.select().from(pessoalCltConfig).where(eq(pessoalCltConfig.tenantId, tenantId));
      const padroesRows = await tx.select().from(pessoalPadrao).where(eq(pessoalPadrao.tenantId, tenantId));
      const valoresRows = await tx.select().from(pessoalPrestadorValor).where(eq(pessoalPrestadorValor.tenantId, tenantId));
      const cestaRows = await tx.select().from(pessoalCltCesta).where(eq(pessoalCltCesta.tenantId, tenantId));
      const nfs = await this.nfsDoMes(tx, tenantId, comp);
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
      return { emps, configs, padroesRows, valoresRows, cestaRows, nfs, prest, excl, lancs, debs, fechAnt };
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

    // ---------- valores de benefício com vigência ----------
    const padroes: PadraoBeneficio[] = dados.padroesRows
      .map((p) => ({ vigenteDesde: p.vigenteDesde, vrDiaCent: centavos(p.vrDia), cestaCent: centavos(p.cestaMensal), vtTipo: p.vtTipo as VtTipo, vtValorCent: centavos(p.vtValor) }))
      .sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde));
    const padraoEm = (c: string) => padroes.find((p) => p.vigenteDesde <= c) ?? null;
    /** Valor que vale para o benefício do mês `c` (vigência: a linha mais recente ≤ c). */
    const beneficioEm = (empId: string, c: string) => {
      const proprio = dados.configs.filter((x) => x.empregadoId === empId && x.vigenteDesde <= c)
        .sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde))[0];
      const pad = padraoEm(c);
      if (proprio && !proprio.usaPadrao) {
        return { origem: 'PROPRIO' as const, vigenteDesde: proprio.vigenteDesde, vrDiaCent: centavos(proprio.vrDia), cestaCent: centavos(proprio.cestaMensal), vtTipo: proprio.vtTipo as VtTipo, vtValorCent: centavos(proprio.vtValor) };
      }
      if (pad) return { origem: 'PADRAO' as const, ...pad, vigenteDesde: proprio && proprio.vigenteDesde > pad.vigenteDesde ? proprio.vigenteDesde : pad.vigenteDesde };
      return { origem: 'NENHUM' as const, vigenteDesde: null, vrDiaCent: 0, cestaCent: 0, vtTipo: 'NENHUM' as VtTipo, vtValorCent: 0 };
    };

    // ---------- CLT (base do ponto) ----------
    const clt: LinhaClt[] = [];
    for (const e of dados.emps) {
      const ex = exclusaoDe('CLT', e.id);
      if (ex) { foraDoMes.push({ exclusaoId: ex.id, pessoaTipo: 'CLT', pessoaId: e.id, nome: e.nome, escopo: ex.escopo as 'MES' | 'DIANTE', desde: ex.competencia }); continue; }
      if (e.dataInicioPonto && e.dataInicioPonto > fim) continue; // ainda não começou

      // Cargo e Pix não têm vigência: vale o último informado.
      const ultimo = dados.configs.filter((c) => c.empregadoId === e.id).sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde))[0];
      // A carga feita neste fechamento é do PRÓXIMO mês → vale o valor vigente nele.
      const config = { ...beneficioEm(e.id, prox), cargo: ultimo?.cargo ?? null, chavePix: ultimo?.chavePix ?? null };
      let salarioCent: number | null = null;
      let salarioPartes: LinhaClt['salarioPartes'] = [];
      let salarioFimMesCent = 0;

      let erro: string | null = null;
      let diasUteis: string[] = [], diasPrevistos: string[] = [], diasEscala: string[] = [];
      let diasProxLista: string[] = [];
      let heMin = 0, heNoBancoMin = 0, proventosCent = 0, descontosCent = 0, indenizacaoMin = 0, indenizacaoCent = 0;
      let faltasDias: string[] = [];
      try {
        const ap = await this.trat.apurarPeriodoCLT(tenantId, e.id, inicio, fim, feriadosLista);
        diasUteis = ap.diasUteis; diasPrevistos = ap.diasPrevistos; diasEscala = ap.diasEscala;
        // Salário do mês com vigência: proporcional quando muda no meio.
        const sm = salarioDoMes(ap.salarios, comp);
        if (sm) { salarioCent = sm.totalCent; salarioPartes = sm.partes; salarioFimMesCent = salarioEm(ap.salarios, fim) ?? 0; }
        // Hora extra de verdade = total − indenização de intervalo/interjornada.
        indenizacaoMin = ap.resultado.dias.reduce((t, d) => t + d.extras.filter((x) => x.motivo.startsWith('indenização')).reduce((a, x) => a + x.min, 0), 0);
        heMin = Math.max(0, ap.resultado.totalExtrasMin - indenizacaoMin);
        faltasDias = ap.resultado.dias.filter((d) => d.faltaMin > 0 && d.minutosTrabalhados === 0).map((d) => d.data);
        if (ap.valores) {
          heNoBancoMin = ap.valores.extrasNoBancoMin;
          indenizacaoCent = ap.valores.indenizacaoCentavos;
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
      const linhaAnt = snapAnt?.clt.find((x) => x.empregadoId === e.id);
      const pagosSnap = linhaAnt?.beneficios.diasProxLista;
      const pagos = pagosSnap ?? diasEscala;
      // O acerto devolve pelo valor que FOI PAGO para este mês: o do fechamento
      // anterior, ou (sem fechamento) o valor vigente neste mês.
      const pagoCom = linhaAnt?.config ?? beneficioEm(e.id, comp);
      // Cesta: valor vigente NESTE mês; liberada depois da carência.
      const cestaManual = dados.cestaRows.find((c) => c.empregadoId === e.id)?.cestaDesde ?? null;
      const cestaAuto = e.dataInicioPonto ? somarMeses(e.dataInicioPonto.slice(0, 7), 3) : null;
      const cestaDesde = cestaManual ?? cestaAuto;
      const ben = calcularBeneficio({
        vrDiaCent: config.vrDiaCent, cestaCent: beneficioEm(e.id, comp).cestaCent, cestaLiberada: !cestaDesde || comp >= cestaDesde, vtTipo: config.vtTipo, vtValorCent: config.vtValorCent,
        diasProx: diasProxLista.length, pagos,
        previstosMes: new Set(diasPrevistos), faltas: new Set(faltasDias), feriados,
        pagoCom: { vrDiaCent: pagoCom.vrDiaCent, vtTipo: pagoCom.vtTipo, vtValorCent: pagoCom.vtValorCent },
      });

      if (salarioCent == null && e.salarioMensal != null) { salarioCent = centavos(e.salarioMensal); salarioFimMesCent = salarioCent; }
      const sal = salarioCent ?? 0;
      const diasMes = diasUteis.length;
      const debitosCent = debitosDe('CLT', e.id);
      const liquidoSalarioCent = sal + proventosCent - descontosCent - debitosCent;
      const custoBrutoCent = sal + proventosCent - descontosCent + ben.vrProxCent + ben.cestaCent + ben.vtProxCent;
      const abatimentosCent = debitosCent + ben.acertoCent;
      clt.push({
        empregadoId: e.id, nome: e.nome, matricula: e.matricula, config, salarioCent, salarioPartes,
        diasMes,
        valorDiaMesCent: diasMes ? Math.round(sal / diasMes) : 0,
        // Base de falta e valor-hora: o salário vigente no fim do mês.
        valorDia30Cent: Math.round(salarioFimMesCent / 30),
        valorHoraCent: Math.round(salarioFimMesCent / 220),
        heMin, heNoBancoMin, indenizacaoMin, indenizacaoCent, proventosCent, faltasDias, descontosCent, debitosCent,
        beneficios: {
          ...ben, diasProx: diasProxLista.length, diasProxLista, pagosEstimado: !pagosSnap,
          cestaDesde, cestaDesdeOrigem: cestaManual ? 'MANUAL' : cestaAuto ? 'AUTO' : null,
        },
        liquidoSalarioCent, custoBrutoCent, abatimentosCent,
        liquidoPagarCent: liquidoSalarioCent + ben.cargaCent,
        observacao: lancDe('CLT', e.id)?.observacao ?? null,
        erro,
      });
    }

    // ---------- MEI ----------
    const pagamentoDe = (l?: { pago: boolean; valorPago: string | null; pagoEm: Date | null }) => ({
      valorPagoCent: l?.pago && l.valorPago != null ? centavos(l.valorPago) : null,
      pagoEm: l?.pago && l.pagoEm ? l.pagoEm.toISOString() : null,
    });
    const mei: LinhaMei[] = [];
    const motoristas: LinhaMot[] = [];
    const semanas = semanasDoMes(comp);
    for (const p of dados.prest) {
      const tipo = p.tipo as PessoaTipo;
      const ex = exclusaoDe(tipo, p.id);
      if (ex) { foraDoMes.push({ exclusaoId: ex.id, pessoaTipo: tipo, pessoaId: p.id, nome: p.nome, escopo: ex.escopo as 'MES' | 'DIANTE', desde: ex.competencia }); continue; }
      // Valor do contrato vigente NESTE mês (reajuste não reescreve o passado).
      const historicoValores: ValorContrato[] = dados.valoresRows.filter((v) => v.prestadorId === p.id)
        .map((v) => ({ vigenteDesde: v.vigenteDesde, valorCent: centavos(v.valorMensal), baseDias: v.baseDias as BaseDias }))
        .sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde));
      const vig = historicoValores.find((v) => v.vigenteDesde <= comp)
        ?? { vigenteDesde: p.competenciaInicio, valorCent: centavos(p.valorMensal), baseDias: p.baseDias as BaseDias };
      const base = vig.baseDias;
      const diasMes = diasBase(comp, base, feriados).length;
      const valorCent = vig.valorCent;
      const valorDesde = vig.vigenteDesde;
      const debitosCent = debitosDe(tipo, p.id);

      if (tipo === 'MEI') {
        const l = lancDe('MEI', p.id);
        const lanc: LancMei = {
          heMin: l?.heMin ?? 0, faltas: l?.faltas ?? 0, feriadosTrab: l?.feriadosTrab ?? 0,
          metaCent: centavos(l?.meta), metaPaga: l?.metaPaga ?? false, metaPagaEm: l?.metaPagaEm ?? null,
          nfNumero: l?.nfNumero ?? null, nfData: l?.nfData ?? null, pago: l?.pago ?? false, observacao: l?.observacao ?? null,
          ...pagamentoDe(l),
          nfArquivo: dados.nfs.get(`MEI:${p.id}:MES`) ?? null,
        };
        const r = calcularMei({ valorCent, diasMes, heMin: lanc.heMin, faltas: lanc.faltas, feriadosTrab: lanc.feriadosTrab, metaCent: lanc.metaCent, metaPaga: lanc.metaPaga, debitosCent });
        mei.push({ id: p.id, nome: p.nome, documento: p.documento, funcao: p.funcao, empresa: p.empresa, valorCent, chavePix: p.chavePix, valorDesde, historicoValores, baseDias: base, diasMes, lanc, debitosCent, ...r });
      } else {
        const sem: SemanaMot[] = semanas.map((s) => {
          const l = lancDe('MOTORISTA', p.id, s.inicio);
          const diasAuto = s.dias.filter((d) => diasBase(comp, base, feriados).includes(d)).length;
          const dias = l?.dias ?? diasAuto;
          const adicionalCent = centavos(l?.adicional);
          const { totalCent } = calcularSemanaMotorista({ mensalCent: valorCent, diasMes, dias, adicionalCent });
          return { inicio: s.inicio, fim: s.fim, diasAuto, dias, adicionalCent, nfNumero: l?.nfNumero ?? null, pago: l?.pago ?? false, totalCent,
            nfArquivo: dados.nfs.get(`MOTORISTA:${p.id}:${s.inicio}`) ?? null };
        });
        // Arredonda uma vez no mês: dias × (mensal ÷ dias do mês) fecha no mensal exato.
        const totalCent = Math.round((valorCent / Math.max(1, diasMes)) * sem.reduce((a, s) => a + s.dias, 0))
          + sem.reduce((a, s) => a + s.adicionalCent, 0);
        motoristas.push({
          id: p.id, nome: p.nome, documento: p.documento, funcao: p.funcao, empresa: p.empresa, valorCent, chavePix: p.chavePix, valorDesde, historicoValores, baseDias: base, diasMes,
          diariaCent: calcularSemanaMotorista({ mensalCent: valorCent, diasMes, dias: 1, adicionalCent: 0 }).diariaCent,
          semanas: sem, totalCent, debitosCent, liquidoCent: totalCent - debitosCent,
          observacao: lancDe('MOTORISTA', p.id)?.observacao ?? null,
          pagamento: { pago: lancDe('MOTORISTA', p.id)?.pago ?? false, ...pagamentoDe(lancDe('MOTORISTA', p.id)) },
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
        nfMei: mei.filter((m) => !m.lanc.nfNumero && !m.lanc.nfArquivo).length,
        nfMotorista: motoristas.reduce((a, m) => a + m.semanas.filter((s) => s.dias > 0 && !s.nfNumero && !s.nfArquivo).length, 0),
        semSalario: clt.filter((c) => c.salarioCent == null).length,
        semPonto: clt.filter((c) => c.erro).length,
      },
      padrao: padraoEm(prox),
      padroes,
    };
  }

  // ======================= escrita =======================

  /**
   * A carga do benefício do mês V é calculada no fechamento de V−1. Se V−1 já
   * fechou, a carga de V já saiu: um valor "a partir de V" chegaria tarde.
   */
  private async exigirVigenciaAberta(tenantId: string, vigenteDesde: string) {
    this.validarComp(vigenteDesde);
    const antes = somarMeses(vigenteDesde, -1);
    const f = await comTenant(this.db, tenantId, (tx) => this.fechamento(tx, tenantId, antes));
    if (f) {
      throw new BadRequestException(`A carga de ${vigenteDesde} já foi feita no fechamento de ${antes}. Escolha a partir de ${somarMeses(vigenteDesde, 1)}.`);
    }
  }

  /**
   * Valor de benefício da pessoa a partir de um mês (vigência). Não altera os
   * meses anteriores: eles continuam lendo a linha que valia na época.
   * usaPadrao = true → a partir dali segue o padrão da empresa.
   */
  async salvarConfigClt(tenantId: string, empregadoId: string, d: {
    cargo?: string | null; vrDia: number; cestaMensal: number; vtTipo: VtTipo; vtValor: number; chavePix?: string | null;
    vigenteDesde: string; usaPadrao?: boolean;
  }) {
    await this.exigirVigenciaAberta(tenantId, d.vigenteDesde);
    return comTenant(this.db, tenantId, async (tx) => {
      const e = (await tx.select({ id: empregado.id }).from(empregado)
        .where(and(eq(empregado.id, empregadoId), eq(empregado.tenantId, tenantId))).limit(1))[0];
      if (!e) throw new NotFoundException('Funcionário não encontrado');
      const v = {
        cargo: d.cargo?.trim() || null, vrDia: reais(centavos(d.vrDia)), cestaMensal: reais(centavos(d.cestaMensal)),
        vtTipo: d.vtTipo, vtValor: reais(centavos(d.vtValor)), chavePix: d.chavePix?.trim() || null,
        usaPadrao: !!d.usaPadrao, atualizadoEm: new Date(),
      };
      const [r] = await tx.insert(pessoalCltConfig).values({ tenantId, empregadoId, vigenteDesde: d.vigenteDesde, ...v })
        .onConflictDoUpdate({ target: [pessoalCltConfig.tenantId, pessoalCltConfig.empregadoId, pessoalCltConfig.vigenteDesde], set: v }).returning();
      return r;
    });
  }

  /**
   * Mês a partir do qual a cesta é paga. null = volta ao automático (3 meses
   * depois do início no ponto). Meses fechados não mudam (são retrato).
   */
  async definirInicioCesta(tenantId: string, empregadoId: string, cestaDesde: string | null) {
    return comTenant(this.db, tenantId, async (tx) => {
      const e = (await tx.select({ id: empregado.id }).from(empregado)
        .where(and(eq(empregado.id, empregadoId), eq(empregado.tenantId, tenantId))).limit(1))[0];
      if (!e) throw new NotFoundException('Funcionário não encontrado');
      if (cestaDesde == null) {
        await tx.delete(pessoalCltCesta).where(and(eq(pessoalCltCesta.tenantId, tenantId), eq(pessoalCltCesta.empregadoId, empregadoId)));
        return { cestaDesde: null };
      }
      this.validarComp(cestaDesde);
      await tx.insert(pessoalCltCesta).values({ tenantId, empregadoId, cestaDesde })
        .onConflictDoUpdate({ target: [pessoalCltCesta.tenantId, pessoalCltCesta.empregadoId], set: { cestaDesde, atualizadoEm: new Date() } });
      return { cestaDesde };
    });
  }

  /** Padrão de benefício da empresa a partir de um mês (vigência). */
  async salvarPadrao(tenantId: string, d: { vrDia: number; cestaMensal: number; vtTipo: VtTipo; vtValor: number; vigenteDesde: string }) {
    await this.exigirVigenciaAberta(tenantId, d.vigenteDesde);
    return comTenant(this.db, tenantId, async (tx) => {
      const v = { vrDia: reais(centavos(d.vrDia)), cestaMensal: reais(centavos(d.cestaMensal)), vtTipo: d.vtTipo, vtValor: reais(centavos(d.vtTipo === 'NENHUM' ? 0 : d.vtValor)) };
      const [r] = await tx.insert(pessoalPadrao).values({ tenantId, vigenteDesde: d.vigenteDesde, ...v })
        .onConflictDoUpdate({ target: [pessoalPadrao.tenantId, pessoalPadrao.vigenteDesde], set: v }).returning();
      return r;
    });
  }

  async criarPrestador(tenantId: string, d: {
    tipo: 'MEI' | 'MOTORISTA'; nome: string; documento?: string | null; funcao?: string | null; empresa?: string | null;
    valorMensal: number; baseDias: BaseDias; chavePix?: string | null; competenciaInicio: string;
  }) {
    this.validarComp(d.competenciaInicio);
    return comTenant(this.db, tenantId, async (tx) => {
      const [r] = await tx.insert(pessoalPrestador).values({
        tenantId, tipo: d.tipo, nome: d.nome.trim(), documento: d.documento?.replace(/\D/g, '') || null, funcao: d.funcao?.trim() || null,
        empresa: d.empresa?.trim() || null,
        valorMensal: reais(centavos(d.valorMensal)), baseDias: d.baseDias, chavePix: d.chavePix?.trim() || null,
        competenciaInicio: d.competenciaInicio,
      }).returning();
      await tx.insert(pessoalPrestadorValor).values({
        tenantId, prestadorId: r!.id, vigenteDesde: d.competenciaInicio,
        valorMensal: reais(centavos(d.valorMensal)), baseDias: d.baseDias,
      });
      return r;
    });
  }

  /**
   * Dados cadastrais (nome, CNPJ, função, Pix) mudam na hora. Valor e base de
   * dias são REAJUSTE: exigem vigenteDesde e só valem daquele mês em diante —
   * os meses anteriores continuam lendo o valor que valia na época.
   */
  async editarPrestador(tenantId: string, id: string, d: Partial<{
    nome: string; documento: string | null; funcao: string | null; empresa: string | null; valorMensal: number; baseDias: BaseDias; chavePix: string | null;
    vigenteDesde: string;
  }>) {
    const reajuste = d.valorMensal !== undefined || d.baseDias !== undefined;
    if (reajuste) {
      if (!d.vigenteDesde) throw new BadRequestException('Informe a partir de qual mês o novo valor vale');
      this.validarComp(d.vigenteDesde);
      await this.exigirAberta(tenantId, d.vigenteDesde);
    }
    return comTenant(this.db, tenantId, async (tx) => {
      const p = (await tx.select().from(pessoalPrestador)
        .where(and(eq(pessoalPrestador.id, id), eq(pessoalPrestador.tenantId, tenantId))).limit(1))[0];
      if (!p) throw new NotFoundException('Prestador não encontrado');
      const set: Record<string, unknown> = {};
      if (d.nome !== undefined) set.nome = d.nome.trim();
      if (d.documento !== undefined) set.documento = d.documento?.replace(/\D/g, '') || null;
      if (d.funcao !== undefined) set.funcao = d.funcao?.trim() || null;
      if (d.chavePix !== undefined) set.chavePix = d.chavePix?.trim() || null;
      if (d.empresa !== undefined) set.empresa = d.empresa?.trim() || null;
      if (reajuste) {
        if (d.vigenteDesde! < p.competenciaInicio) {
          throw new BadRequestException(`O contrato começa em ${p.competenciaInicio}. O reajuste não pode valer antes disso.`);
        }
        // Base do reajuste: o valor que valia no mês anterior (o que não for informado se mantém).
        const vigentes = await tx.select().from(pessoalPrestadorValor).where(and(
          eq(pessoalPrestadorValor.tenantId, tenantId), eq(pessoalPrestadorValor.prestadorId, id)));
        const atual = vigentes.filter((v) => v.vigenteDesde <= d.vigenteDesde!).sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde))[0];
        const valorMensal = reais(centavos(d.valorMensal ?? Number(atual?.valorMensal ?? p.valorMensal)));
        const baseDias = d.baseDias ?? atual?.baseDias ?? p.baseDias;
        await tx.insert(pessoalPrestadorValor).values({ tenantId, prestadorId: id, vigenteDesde: d.vigenteDesde!, valorMensal, baseDias })
          .onConflictDoUpdate({ target: [pessoalPrestadorValor.tenantId, pessoalPrestadorValor.prestadorId, pessoalPrestadorValor.vigenteDesde], set: { valorMensal, baseDias } });
        // O cadastro guarda o valor mais recente (referência pra listagens).
        const maisRecente = [...vigentes.map((v) => v.vigenteDesde), d.vigenteDesde!].sort().pop();
        if (maisRecente === d.vigenteDesde) { set.valorMensal = valorMensal; set.baseDias = baseDias; }
      }
      if (Object.keys(set).length === 0) return p;
      const rows = await tx.update(pessoalPrestador).set(set)
        .where(and(eq(pessoalPrestador.id, id), eq(pessoalPrestador.tenantId, tenantId))).returning();
      return rows[0];
    });
  }

  /** Lançamento do mês (MEI, observação de qualquer um) ou da semana (motorista). */
  async salvarLancamento(tenantId: string, d: {
    pessoaTipo: PessoaTipo; pessoaId: string; competencia: string; periodo?: string;
    heMin?: number; faltas?: number; feriadosTrab?: number; dias?: number | null; adicional?: number;
    meta?: number; metaPaga?: boolean; metaPagaEm?: string | null; nfNumero?: string | null; nfData?: string | null;
    pago?: boolean; valorPago?: number | null; observacao?: string | null;
  }) {
    this.validarComp(d.competencia);
    // Mês fechado: valores congelados, mas NF e pagamento ainda podem ser
    // registrados (chegam depois do fechamento e não mudam nenhum cálculo).
    const soPagamento = Object.entries(d)
      .filter(([k, v]) => v !== undefined && !['pessoaTipo', 'pessoaId', 'competencia', 'periodo'].includes(k))
      .every(([k]) => ['pago', 'valorPago', 'nfNumero', 'nfData'].includes(k));
    if (!soPagamento) await this.exigirAberta(tenantId, d.competencia);
    const periodo = d.periodo ?? 'MES';
    const set: Record<string, unknown> = { atualizadoEm: new Date() };
    for (const k of ['heMin', 'faltas', 'feriadosTrab', 'dias', 'metaPaga', 'pago'] as const) if (d[k] !== undefined) set[k] = d[k];
    if (d.adicional !== undefined) set.adicional = reais(centavos(d.adicional));
    if (d.meta !== undefined) set.meta = reais(centavos(d.meta));
    for (const k of ['metaPagaEm', 'nfNumero', 'nfData', 'observacao'] as const) {
      if (d[k] !== undefined) set[k] = (typeof d[k] === 'string' ? (d[k] as string).trim() : d[k]) || null;
    }
    if (d.metaPaga === false) set.metaPagaEm = null;
    if (d.valorPago !== undefined) set.valorPago = d.valorPago == null ? null : reais(centavos(d.valorPago));
    // Hora do pagamento: grava ao marcar "pago" (mantém a primeira), apaga ao desmarcar.
    const ins: Record<string, unknown> = { ...set };
    const upd: Record<string, unknown> = { ...set };
    if (d.pago === true) { ins.pagoEm = new Date(); upd.pagoEm = sql`coalesce(${pessoalLancamento.pagoEm}, now())`; }
    if (d.pago === false) { ins.pagoEm = upd.pagoEm = null; ins.valorPago = upd.valorPago = null; }
    return comTenant(this.db, tenantId, async (tx) => {
      const [r] = await tx.insert(pessoalLancamento).values({
        tenantId, pessoaTipo: d.pessoaTipo, pessoaId: d.pessoaId, competencia: d.competencia, periodo, ...ins,
      }).onConflictDoUpdate({
        target: [pessoalLancamento.tenantId, pessoalLancamento.pessoaTipo, pessoalLancamento.pessoaId, pessoalLancamento.competencia, pessoalLancamento.periodo],
        set: upd,
      }).returning();
      return r;
    });
  }

  /**
   * Registra (ou desfaz) o pagamento do mês numa ida só: valor e hora no
   * lançamento do mês; no motorista também marca as semanas trabalhadas.
   * Vale em mês fechado (pagamento não mexe em cálculo).
   */
  async registrarPagamento(tenantId: string, d: {
    pessoaTipo: 'MEI' | 'MOTORISTA'; pessoaId: string; competencia: string; pago: boolean; valorPago?: number | null; semanas?: string[];
  }) {
    this.validarComp(d.competencia);
    if (d.pago && (d.valorPago == null || d.valorPago < 0)) throw new BadRequestException('Informe o valor pago.');
    const agora = new Date();
    const valorPago = d.pago ? reais(centavos(d.valorPago!)) : null;
    const pagoEm = d.pago ? agora : null;
    const alvo = [pessoalLancamento.tenantId, pessoalLancamento.pessoaTipo, pessoalLancamento.pessoaId, pessoalLancamento.competencia, pessoalLancamento.periodo];
    return comTenant(this.db, tenantId, async (tx) => {
      const p = (await tx.select({ id: pessoalPrestador.id }).from(pessoalPrestador)
        .where(and(eq(pessoalPrestador.id, d.pessoaId), eq(pessoalPrestador.tenantId, tenantId))).limit(1))[0];
      if (!p) throw new NotFoundException('Prestador não encontrado');
      const base = { tenantId, pessoaTipo: d.pessoaTipo, pessoaId: d.pessoaId, competencia: d.competencia };
      await tx.insert(pessoalLancamento).values({ ...base, periodo: 'MES', pago: d.pago, valorPago, pagoEm, atualizadoEm: agora })
        .onConflictDoUpdate({ target: alvo, set: { pago: d.pago, valorPago, pagoEm, atualizadoEm: agora } });
      if (d.pessoaTipo === 'MOTORISTA') {
        for (const s of d.semanas ?? []) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !s.startsWith(d.competencia)) continue;
          await tx.insert(pessoalLancamento).values({ ...base, periodo: s, pago: d.pago, pagoEm, atualizadoEm: agora })
            .onConflictDoUpdate({ target: alvo, set: { pago: d.pago, pagoEm, atualizadoEm: agora } });
        }
      }
      return { pago: d.pago, valorPagoCent: d.pago ? centavos(d.valorPago!) : null, pagoEm: pagoEm?.toISOString() ?? null };
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

  // ======================= arquivo da NF =======================

  private static readonly NF_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/xml', 'text/xml'];
  private static readonly NF_MAX = 5 * 1024 * 1024;

  /** Sobe (ou substitui) o arquivo da NF de um lançamento. Vale também em mês fechado. */
  async salvarNf(tenantId: string, d: {
    pessoaTipo: 'MEI' | 'MOTORISTA'; pessoaId: string; competencia: string; periodo?: string;
    arquivoBase64: string; arquivoNome: string; arquivoMime: string;
  }) {
    this.validarComp(d.competencia);
    const mime = d.arquivoMime === 'text/xml' ? 'application/xml' : d.arquivoMime;
    if (!PessoalService.NF_MIMES.includes(mime)) throw new BadRequestException('Envie a nota em PDF, XML ou imagem (JPG/PNG).');
    const bruto = Buffer.from(d.arquivoBase64, 'base64');
    if (bruto.length === 0) throw new BadRequestException('Arquivo vazio.');
    if (bruto.length > PessoalService.NF_MAX) throw new BadRequestException('Arquivo maior que 5 MB. Envie um PDF menor.');
    const periodo = d.periodo ?? 'MES';
    return comTenant(this.db, tenantId, async (tx) => {
      const p = (await tx.select({ id: pessoalPrestador.id }).from(pessoalPrestador)
        .where(and(eq(pessoalPrestador.id, d.pessoaId), eq(pessoalPrestador.tenantId, tenantId))).limit(1))[0];
      if (!p) throw new NotFoundException('Prestador não encontrado');
      const valores = {
        arquivo: this.cripto.cifrarBytes(bruto), arquivoNome: d.arquivoNome.slice(0, 160), arquivoMime: mime, arquivoBytes: bruto.length, criadoEm: new Date(),
      };
      const [r] = await tx.insert(pessoalNfArquivo).values({ tenantId, pessoaTipo: d.pessoaTipo, pessoaId: d.pessoaId, competencia: d.competencia, periodo, ...valores })
        .onConflictDoUpdate({
          target: [pessoalNfArquivo.tenantId, pessoalNfArquivo.pessoaTipo, pessoalNfArquivo.pessoaId, pessoalNfArquivo.competencia, pessoalNfArquivo.periodo],
          set: valores,
        }).returning({ id: pessoalNfArquivo.id, nome: pessoalNfArquivo.arquivoNome, bytes: pessoalNfArquivo.arquivoBytes });
      return r;
    });
  }

  async baixarNf(tenantId: string, id: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const r = (await tx.select().from(pessoalNfArquivo)
        .where(and(eq(pessoalNfArquivo.id, id), eq(pessoalNfArquivo.tenantId, tenantId))).limit(1))[0];
      if (!r) throw new NotFoundException('Arquivo não encontrado');
      return { bytes: this.cripto.decifrarBytes(r.arquivo), nome: r.arquivoNome, mime: r.arquivoMime };
    });
  }

  async removerNf(tenantId: string, id: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      await tx.delete(pessoalNfArquivo).where(and(eq(pessoalNfArquivo.id, id), eq(pessoalNfArquivo.tenantId, tenantId)));
      return { removido: true };
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

  // ======================= histórico da pessoa =======================

  /** Todas as pessoas que já passaram pelo módulo (ativas e inativas), para a busca do histórico. */
  async pessoasHistorico(tenantId: string) {
    const hoje = mesCorrente();
    return comTenant(this.db, tenantId, async (tx) => {
      const emps = await tx.select({ id: empregado.id, nome: empregado.nome, matricula: empregado.matricula, ativo: empregado.ativo })
        .from(empregado).where(eq(empregado.tenantId, tenantId)).orderBy(asc(empregado.nome));
      const prest = await tx.select().from(pessoalPrestador)
        .where(and(eq(pessoalPrestador.tenantId, tenantId), inArray(pessoalPrestador.tipo, ['MEI', 'MOTORISTA']))).orderBy(asc(pessoalPrestador.nome));
      const desligados = await tx.select().from(pessoalExclusao)
        .where(and(eq(pessoalExclusao.tenantId, tenantId), eq(pessoalExclusao.escopo, 'DIANTE'), lte(pessoalExclusao.competencia, hoje)));
      return [
        ...emps.map((e) => ({ pessoaTipo: 'CLT' as PessoaTipo, pessoaId: e.id, nome: e.nome, detalhe: e.matricula ? `#${e.matricula}` : null, inativo: !e.ativo, desde: null as string | null })),
        ...prest.map((p) => {
          const fora = desligados.filter((x) => x.pessoaTipo === p.tipo && x.pessoaId === p.id).sort((a, b) => a.competencia.localeCompare(b.competencia))[0];
          return { pessoaTipo: p.tipo as PessoaTipo, pessoaId: p.id, nome: p.nome, detalhe: p.empresa, inativo: !!fora, desde: fora?.competencia ?? null };
        }),
      ];
    });
  }

  /**
   * Histórico de uma pessoa: um item por mês. Mês fechado vem do retrato do
   * fechamento (com NF e pagamento ao vivo por cima); os meses em aberto mais
   * recentes (até 3, terminando no mês atual) são calculados na hora.
   */
  async historico(tenantId: string, tipo: PessoaTipo, id: string) {
    const hoje = mesCorrente();
    const { fechs, lancs, nfs } = await comTenant(this.db, tenantId, async (tx) => ({
      fechs: await tx.select().from(pessoalFechamento).where(eq(pessoalFechamento.tenantId, tenantId)),
      lancs: tipo === 'CLT' ? [] : await tx.select().from(pessoalLancamento)
        .where(and(eq(pessoalLancamento.tenantId, tenantId), eq(pessoalLancamento.pessoaTipo, tipo), eq(pessoalLancamento.pessoaId, id))),
      nfs: tipo === 'CLT' ? [] : await tx.select({
        id: pessoalNfArquivo.id, competencia: pessoalNfArquivo.competencia, periodo: pessoalNfArquivo.periodo,
        nome: pessoalNfArquivo.arquivoNome, mime: pessoalNfArquivo.arquivoMime, bytes: pessoalNfArquivo.arquivoBytes, criadoEm: pessoalNfArquivo.criadoEm,
      }).from(pessoalNfArquivo).where(and(eq(pessoalNfArquivo.tenantId, tenantId), eq(pessoalNfArquivo.pessoaTipo, tipo), eq(pessoalNfArquivo.pessoaId, id))),
    }));
    const nfDe = (comp: string, per: string): NfArquivo | null => {
      const r = nfs.find((x) => x.competencia === comp && x.periodo === per);
      return r ? { id: r.id, nome: r.nome, mime: r.mime, bytes: r.bytes, enviadoEm: r.criadoEm.toISOString() } : null;
    };
    const lancDe = (comp: string, per: string) => lancs.find((x) => x.competencia === comp && x.periodo === per);
    const pg = (x?: { pago: boolean; valorPago: string | null; pagoEm: Date | null }) => ({
      valorPagoCent: x?.pago && x.valorPago != null ? centavos(x.valorPago) : null,
      pagoEm: x?.pago && x.pagoEm ? x.pagoEm.toISOString() : null,
    });
    type Item = { competencia: string; fechado: boolean; fechadoEm: string | null; linha: LinhaClt | LinhaMei | LinhaMot };
    const meses: Item[] = [];
    const extrair = (snap: CompetenciaPessoal) =>
      tipo === 'CLT' ? snap.clt.find((c) => c.empregadoId === id)
        : tipo === 'MEI' ? snap.mei.find((m) => m.id === id) : snap.motoristas.find((m) => m.id === id);

    for (const f of fechs) {
      const snap = f.snapshot as CompetenciaPessoal;
      const linha = extrair(snap);
      if (!linha) continue;
      const comp = f.competencia;
      let viva: LinhaClt | LinhaMei | LinhaMot = linha;
      if (tipo === 'MEI') {
        const m = linha as LinhaMei; const x = lancDe(comp, 'MES');
        viva = { ...m, lanc: { ...m.lanc, nfNumero: x?.nfNumero ?? null, nfData: x?.nfData ?? null, pago: x?.pago ?? false, ...pg(x), nfArquivo: nfDe(comp, 'MES') } };
      } else if (tipo === 'MOTORISTA') {
        const m = linha as LinhaMot; const x = lancDe(comp, 'MES');
        viva = {
          ...m, pagamento: { pago: x?.pago ?? false, ...pg(x) },
          semanas: m.semanas.map((sm) => { const y = lancDe(comp, sm.inicio); return { ...sm, nfNumero: y?.nfNumero ?? null, pago: y?.pago ?? false, nfArquivo: nfDe(comp, sm.inicio) }; }),
        };
      }
      meses.push({ competencia: comp, fechado: true, fechadoEm: f.fechadoEm.toISOString(), linha: viva });
    }
    // Meses em aberto recentes (o atual e até dois antes), se não estiverem fechados.
    const fechados = new Set(fechs.map((f) => f.competencia));
    for (const comp of [hoje, somarMeses(hoje, -1), somarMeses(hoje, -2)]) {
      if (fechados.has(comp)) continue;
      if (fechs.length && comp < fechs.map((f) => f.competencia).sort()[0]!) continue;
      const linha = extrair(await this.calcular(tenantId, comp));
      if (linha) meses.push({ competencia: comp, fechado: false, fechadoEm: null, linha });
    }
    meses.sort((a, b) => b.competencia.localeCompare(a.competencia));
    return { pessoaTipo: tipo, pessoaId: id, meses };
  }
}
