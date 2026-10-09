/**
 * Cálculos puros da Gestão de Pessoal. Tudo em CENTAVOS (inteiros) pra não
 * acumular erro de ponto flutuante em soma de folha.
 *
 * Nada aqui toca banco: o serviço junta os dados (ponto, cadastro, lançamentos)
 * e estas funções devolvem os números. É o que os testes cobrem.
 */

export type VtTipo = 'NENHUM' | 'DIA' | 'FIXO';
export type BaseDias = 'SEG_SAB' | 'SEG_SEX';
export type PessoaTipo = 'CLT' | 'MEI' | 'MOTORISTA';

/** "1234.56" | 1234.56 | null → 123456 */
export const centavos = (v: number | string | null | undefined): number => Math.round(Number(v ?? 0) * 100);

// ---------- calendário ----------

const p2 = (n: number) => String(n).padStart(2, '0');

/** Dia da semana (0=dom) de uma data YYYY-MM-DD, sem depender de fuso. */
export const diaSemana = (iso: string): number => new Date(`${iso}T12:00:00Z`).getUTCDay();

export function faixaDoMes(comp: string): { inicio: string; fim: string } {
  const [a, m] = comp.split('-').map(Number) as [number, number];
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { inicio: `${comp}-01`, fim: `${comp}-${p2(ultimo)}` };
}

export function somarMeses(comp: string, n: number): string {
  const [a, m] = comp.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`;
}

/** Meses de `de` até `ate` (pode ser negativo). */
export function mesesEntre(de: string, ate: string): number {
  const [a1, m1] = de.split('-').map(Number) as [number, number];
  const [a2, m2] = ate.split('-').map(Number) as [number, number];
  return (a2 - a1) * 12 + (m2 - m1);
}

export function diasDoMes(comp: string): string[] {
  const { fim } = faixaDoMes(comp);
  const n = Number(fim.slice(8, 10));
  return Array.from({ length: n }, (_, i) => `${comp}-${p2(i + 1)}`);
}

/** Dias do mês que contam pra um prestador (seg–sáb ou seg–sex), sem feriados. */
export function diasBase(comp: string, base: BaseDias, feriados: Set<string>): string[] {
  const ultimo = base === 'SEG_SAB' ? 6 : 5;
  return diasDoMes(comp).filter((d) => { const w = diaSemana(d); return w >= 1 && w <= ultimo && !feriados.has(d); });
}

/** Semanas do mês (segunda a domingo), recortadas no mês. */
export function semanasDoMes(comp: string): { inicio: string; fim: string; dias: string[] }[] {
  const out: { inicio: string; fim: string; dias: string[] }[] = [];
  let atual: string[] = [];
  for (const d of diasDoMes(comp)) {
    if (diaSemana(d) === 1 && atual.length) { out.push({ inicio: atual[0]!, fim: atual[atual.length - 1]!, dias: atual }); atual = []; }
    atual.push(d);
  }
  if (atual.length) out.push({ inicio: atual[0]!, fim: atual[atual.length - 1]!, dias: atual });
  return out;
}

// ---------- débitos parcelados ----------

/**
 * Parcela do débito na competência (ou null se não cai nela). A última
 * parcela absorve o resto da divisão — a soma das parcelas fecha o total.
 */
export type DebitoParcelado = {
  valorTotalCent: number; parcelas: number; competenciaInicio: string; parcelasPagas?: number;
  /** FIXO: valorTotalCent é o valor de cada mês, sem número de parcelas, até competenciaFim (se houver). */
  tipo?: 'PARCELADO' | 'FIXO'; competenciaFim?: string | null;
};

/**
 * Parcela que cai no mês. Com parcelas já pagas antes do lançamento (débito
 * retroativo), a competência de início é a da parcela seguinte: com 4 de 12
 * pagas, o início desconta a 5ª.
 */
export function parcelaNoMes(d: DebitoParcelado, comp: string): { numero: number; valorCent: number } | null {
  const i = mesesEntre(d.competenciaInicio, comp);
  if (d.tipo === 'FIXO') {
    if (i < 0 || (d.competenciaFim && comp > d.competenciaFim)) return null;
    return { numero: i + 1, valorCent: d.valorTotalCent };
  }
  const pagas = d.parcelasPagas ?? 0;
  const numero = pagas + i + 1;
  if (i < 0 || numero > d.parcelas) return null;
  const base = Math.floor(d.valorTotalCent / d.parcelas);
  const valorCent = numero === d.parcelas ? d.valorTotalCent - base * (d.parcelas - 1) : base;
  return { numero, valorCent };
}

/** Situação do débito no mês: quanto já foi pago antes desta parcela e quanto falta depois dela. */
export function situacaoDebito(d: DebitoParcelado, comp: string): { pagoCent: number; faltaCent: number | null } | null {
  const pc = parcelaNoMes(d, comp);
  if (!pc) return null;
  // Fixo: já descontado nos meses anteriores; o que falta não tem fim definido.
  if (d.tipo === 'FIXO') return { pagoCent: d.valorTotalCent * (pc.numero - 1), faltaCent: null };
  const base = Math.floor(d.valorTotalCent / d.parcelas);
  const pagoCent = base * (pc.numero - 1);
  return { pagoCent, faltaCent: d.valorTotalCent - pagoCent - pc.valorCent };
}

// ---------- benefícios (CLT) ----------

export interface EntradaBeneficio {
  vrDiaCent: number;
  cestaCent: number;
  vtTipo: VtTipo;
  vtValorCent: number;
  /** Dias previstos de trabalho no mês da carga (próximo mês). Base do VT. */
  diasProx: number;
  /** Dias da carga que dão VR/VA (sem sábado de meio turno). Ausente = diasProx. */
  diasProxVr?: number;
  /** Dias que já foram pagos para o mês apurado (carga anterior). */
  pagos: string[];
  /** Desses, os que foram pagos com VR/VA. Ausente = todos (regra antiga). */
  pagosVr?: string[];
  /** Dias em que a pessoa devia trabalhar no mês apurado (sem feriado/afastamento). */
  previstosMes: Set<string>;
  /** Faltas (dia inteiro) do mês apurado, vindas do ponto. */
  faltas: Set<string>;
  feriados: Set<string>;
  /**
   * Valores que valiam quando o mês apurado foi pago. O acerto devolve o que
   * foi pago, não o valor novo — se o VR subiu, o dia não usado volta pelo
   * valor antigo. Ausente = mesmos valores da carga.
   */
  pagoCom?: { vrDiaCent: number; vtTipo: VtTipo; vtValorCent: number };
  /**
   * Cesta básica: prêmio de assiduidade do mês apurado. Só é paga se a pessoa
   * já cumpriu a carência (cestaLiberada) e não teve falta injustificada no mês.
   */
  cestaLiberada?: boolean;
}

export type MotivoNaoUso = 'feriado' | 'falta' | 'afastamento';

export type StatusCesta = 'PAGA' | 'PERDIDA_FALTA' | 'CARENCIA' | 'SEM_CESTA';

export interface ResultadoBeneficio {
  /** VR/VA por dia do próximo mês (a cesta vem separada). */
  vrProxCent: number;
  /** Cesta paga neste fechamento (0 se perdeu por falta, em carência ou sem cesta). */
  cestaCent: number;
  cestaStatus: StatusCesta;
  vtProxCent: number;
  naoUsados: { data: string; motivo: MotivoNaoUso }[];
  acertoVrCent: number;
  acertoVtCent: number;
  acertoCent: number;
  /** O que vai ser carregado: VR + VT do próximo mês − acerto do mês apurado. */
  cargaCent: number;
}

/**
 * O benefício é carregado no fim do mês para o mês seguinte (antecipado).
 * O que foi pago para o mês apurado e não foi usado — feriado, falta,
 * férias/atestado/folga — volta como acerto, abatido na carga seguinte.
 *
 * Combustível com valor FIXO mensal não muda com feriado: só falta e
 * afastamento abatem, a 1/30 do valor por dia.
 */
export function calcularBeneficio(e: EntradaBeneficio): ResultadoBeneficio {
  const vrProxCent = (e.diasProxVr ?? e.diasProx) * e.vrDiaCent;
  // Cesta = assiduidade: qualquer falta injustificada no mês apurado zera.
  const cestaStatus: StatusCesta = e.cestaCent <= 0 ? 'SEM_CESTA'
    : e.cestaLiberada === false ? 'CARENCIA'
    : e.faltas.size > 0 ? 'PERDIDA_FALTA' : 'PAGA';
  const cestaCent = cestaStatus === 'PAGA' ? e.cestaCent : 0;
  const vtProxCent = e.vtTipo === 'DIA' ? e.diasProx * e.vtValorCent : e.vtTipo === 'FIXO' ? e.vtValorCent : 0;

  const naoUsados = e.pagos
    .filter((d) => !e.previstosMes.has(d) || e.faltas.has(d))
    .map((data) => ({
      data,
      motivo: (e.feriados.has(data) ? 'feriado' : e.faltas.has(data) ? 'falta' : 'afastamento') as MotivoNaoUso,
    }));

  const pg = e.pagoCom ?? { vrDiaCent: e.vrDiaCent, vtTipo: e.vtTipo, vtValorCent: e.vtValorCent };
  const n = naoUsados.length;
  // VR só volta dos dias em que foi pago (sábado de meio turno não teve VR).
  const pagosVr = e.pagosVr ? new Set(e.pagosVr) : null;
  const nVr = pagosVr ? naoUsados.filter((x) => pagosVr.has(x.data)).length : n;
  const acertoVrCent = pg.vrDiaCent > 0 ? nVr * pg.vrDiaCent : 0;
  const semFeriado = naoUsados.filter((x) => x.motivo !== 'feriado').length;
  const acertoVtCent = pg.vtTipo === 'DIA' ? n * pg.vtValorCent
    : pg.vtTipo === 'FIXO' ? Math.round((semFeriado * pg.vtValorCent) / 30) : 0;
  const acertoCent = acertoVrCent + acertoVtCent;
  return {
    vrProxCent, cestaCent, cestaStatus, vtProxCent, naoUsados, acertoVrCent, acertoVtCent, acertoCent,
    cargaCent: Math.max(0, vrProxCent + cestaCent + vtProxCent - acertoCent),
  };
}

// ---------- MEI ----------

export interface EntradaMei {
  valorCent: number;
  diasMes: number;          // dias base do mês (seg–sáb ou seg–sex) sem feriados
  heMin: number;
  faltas: number;
  feriadosTrab: number;
  metaCent: number;
  metaPaga: boolean;
  debitosCent: number;
}
export interface ResultadoMei {
  valorDiaCent: number;
  valorHoraCent: number;
  heCent: number;
  feriadosCent: number;
  faltasCent: number;
  /** Valor da nota fiscal que o MEI emite. */
  brutoCent: number;
  metaDescontadaCent: number;
  abatimentosCent: number;
  /** O que a empresa paga agora. */
  liquidoCent: number;
}

/**
 * Bruto = contrato + extras + feriados trabalhados − faltas + meta  (vai na NF)
 * Líquido = bruto − débitos − meta que já foi paga antes
 */
export function calcularMei(e: EntradaMei): ResultadoMei {
  const dias = Math.max(1, e.diasMes);
  const vd = e.valorCent / dias;
  const vh = e.valorCent / (dias * 8);
  const heCent = Math.round((e.heMin / 60) * vh * 1.5);
  const feriadosCent = Math.round(e.feriadosTrab * vd);
  const faltasCent = Math.round(e.faltas * vd);
  const brutoCent = e.valorCent + heCent + feriadosCent - faltasCent + e.metaCent;
  const metaDescontadaCent = e.metaPaga ? e.metaCent : 0;
  const abatimentosCent = e.debitosCent + metaDescontadaCent;
  return {
    valorDiaCent: Math.round(vd), valorHoraCent: Math.round(vh),
    heCent, feriadosCent, faltasCent, brutoCent, metaDescontadaCent, abatimentosCent,
    liquidoCent: brutoCent - abatimentosCent,
  };
}

// ---------- motorista ----------

/** Diária = mensal ÷ dias base do mês; semana = dias × diária + adicionais. */
export function calcularSemanaMotorista(e: { mensalCent: number; diasMes: number; dias: number; adicionalCent: number }) {
  const diariaCent = Math.round(e.mensalCent / Math.max(1, e.diasMes));
  return { diariaCent, totalCent: Math.round((e.mensalCent / Math.max(1, e.diasMes)) * e.dias) + e.adicionalCent };
}

/**
 * Dias que dão VR/VA: todo dia da escala, menos o sábado de meio turno
 * (jornada do sábado menor que o turno cheio da semana). VT continua em todos.
 */
export function diasComVr(dias: string[], jornada: Record<string, number>): string[] {
  const semana = Object.entries(jornada).filter(([d]) => { const w = diaSemana(d); return w >= 1 && w <= 5; }).map(([, m]) => m);
  const cheio = semana.length ? Math.max(...semana) : Math.max(0, ...Object.values(jornada));
  return dias.filter((d) => diaSemana(d) !== 6 || (jornada[d] ?? cheio) >= cheio);
}
