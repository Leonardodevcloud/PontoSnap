import type { RegrasApuracao, ResultadoPeriodo } from './tipos.js';

/** Parâmetros de folha para valorizar a apuração (tudo em centavos). */
export interface ParametrosValor {
  salarioMensalCentavos: number;
  horasMensaisFolha: number; // divisor da folha (ex.: 220 para 44h/semana)
}

export interface ResultadoValores {
  valorHoraCentavos: number;
  extrasPorAdicionalCentavos: Record<string, number>;
  extrasCentavos: number;              // total pago em extras (base + adicional)
  adicionalNoturnoCentavos: number;    // só o adicional (a hora-base já está no salário)
  reflexoDsrCentavos: number;
  descontoFaltasCentavos: number;
  descontoAtrasosCentavos: number;
  descontoDsrPerdidoCentavos: number;
  liquidoProventosCentavos: number;    // proventos - descontos (parcial, só o que a apuração toca)
  /** Minutos de extra que NÃO foram pagos porque foram pro banco de horas. */
  extrasNoBancoMin: number;
  /**
   * Indenização de intervalo/interjornada (Art. 71 §4º / Art. 66): JÁ ESTÁ
   * dentro de extrasCentavos, separada aqui pra tela não chamar de hora extra.
   * Não é jornada: não vai pro banco e não gera reflexo em DSR.
   */
  indenizacaoMin: number;
  indenizacaoCentavos: number;
}

/**
 * Para onde cada coisa vai — decide o que vira R$ NESTA folha.
 * Sem isto, tudo é valorizado (comportamento antigo, sem banco).
 */
export interface DestinoValores {
  /**
   * Banco ativo: a extra comum vira crédito no banco e NÃO é paga agora
   * (senão a mesma hora aparece duas vezes: no banco e em R$). Indenização de
   * intervalo/interjornada é sempre paga — não é jornada, não vai pro banco.
   */
  extrasNoBanco?: boolean;
  /** Falta vira desconto em R$ só com destinação DESCONTA (banco/abono não descontam). */
  descontaFaltas?: boolean;
  /** Atraso vira desconto em R$ só com destinação DESCONTA (banco/tolera não descontam). */
  descontaAtrasos?: boolean;
}

const ehIndenizacao = (motivo: string) => motivo.startsWith('indenização');

const porMin = (min: number, taxaHoraCentavos: number) => Math.round((min / 60) * taxaHoraCentavos);

/**
 * Converte a apuração (em minutos) em valores de folha (em centavos).
 * Não é a folha completa — cobre só o que a jornada gera: extras com adicional,
 * adicional noturno, reflexo de DSR e os descontos de falta/atraso/DSR perdido.
 */
export function valorizarPeriodo(
  r: ResultadoPeriodo, p: ParametrosValor, regras: RegrasApuracao, dest: DestinoValores = {},
): ResultadoValores {
  const valorHora = Math.round(p.salarioMensalCentavos / p.horasMensaisFolha);
  const descontaFaltas = dest.descontaFaltas ?? true;
  const descontaAtrasos = dest.descontaAtrasos ?? true;

  // Extras que viram dinheiro nesta folha. Com banco, só a indenização.
  let pagasPorAdicional: Record<string, number> = r.extrasPorAdicional;
  let extrasNoBancoMin = 0;
  if (dest.extrasNoBanco) {
    pagasPorAdicional = {};
    for (const d of r.dias) {
      for (const e of d.extras) {
        if (ehIndenizacao(e.motivo)) {
          const k = String(e.adicionalPct);
          pagasPorAdicional[k] = (pagasPorAdicional[k] ?? 0) + e.min;
        } else {
          extrasNoBancoMin += e.min;
        }
      }
    }
  }
  const pagasMin = Object.values(pagasPorAdicional).reduce((a, b) => a + b, 0);

  // Indenização (intervalo suprimido, interjornada): sempre paga, nunca banco.
  // Somado por adicional e arredondado uma vez — mesma conta das extras pagas,
  // pra indenização nunca passar do total pago por diferença de centavo.
  let indenizacaoMin = 0, indenizacaoCentavos = 0;
  const indPorPct: Record<string, number> = {};
  for (const d of r.dias) {
    for (const e of d.extras) {
      if (!ehIndenizacao(e.motivo)) continue;
      indenizacaoMin += e.min;
      indPorPct[String(e.adicionalPct)] = (indPorPct[String(e.adicionalPct)] ?? 0) + e.min;
    }
  }
  for (const [pct, min] of Object.entries(indPorPct)) indenizacaoCentavos += Math.round(porMin(min, valorHora) * (1 + Number(pct) / 100));

  const extrasPorAdicionalCentavos: Record<string, number> = {};
  let extras = 0;
  for (const [pct, min] of Object.entries(pagasPorAdicional)) {
    const v = Math.round(porMin(min, valorHora) * (1 + Number(pct) / 100));
    extrasPorAdicionalCentavos[pct] = v;
    extras += v;
  }

  const adicionalNoturno = Math.round(porMin(r.totalNoturnoLegalMin, valorHora) * (regras.noturno.adicionalPct / 100));
  // Reflexo do DSR só sobre HORA EXTRA paga (proporcional). Indenização de
  // intervalo é verba indenizatória (Reforma 2017): não reflete em DSR.
  const extraPagaMin = Math.max(0, pagasMin - indenizacaoMin);
  const reflexoMin = r.totalExtrasMin > 0 ? Math.round(r.reflexoDsrMin * (extraPagaMin / r.totalExtrasMin)) : 0;
  const reflexoDsr = porMin(reflexoMin, valorHora);
  const descFaltas = descontaFaltas ? porMin(r.totalFaltaMin, valorHora) : 0;
  const descAtrasos = descontaAtrasos ? porMin(r.totalAtrasoMin, valorHora) : 0;
  const salarioDia = Math.round(p.salarioMensalCentavos / 30);
  // Falta abonada/compensada no banco não é falta injustificada pra perda de DSR.
  const descDsrPerdido = descontaFaltas ? r.dsrPerdidoSemanas * salarioDia : 0;

  const liquido = extras + adicionalNoturno + reflexoDsr - descFaltas - descAtrasos - descDsrPerdido;

  return {
    valorHoraCentavos: valorHora,
    extrasPorAdicionalCentavos,
    extrasCentavos: extras,
    adicionalNoturnoCentavos: adicionalNoturno,
    reflexoDsrCentavos: reflexoDsr,
    descontoFaltasCentavos: descFaltas,
    descontoAtrasosCentavos: descAtrasos,
    descontoDsrPerdidoCentavos: descDsrPerdido,
    liquidoProventosCentavos: liquido,
    extrasNoBancoMin,
    indenizacaoMin,
    indenizacaoCentavos,
  };
}

/** Resultado do acerto do banco "compensa no mês" valorizado em R$. */
export interface AcertoBancoValores {
  /** Horas acertadas: > 0 pagas, < 0 descontadas. */
  acertoMin: number;
  /** Hora extra paga (base + adicional), por adicional. */
  porAdicionalMin: Record<string, number>;
  extrasCentavos: number;
  reflexoDsrCentavos: number;
  descontoCentavos: number;
}

/**
 * Valoriza o acerto do banco que compensa no mês e paga a diferença.
 *
 * Positivo: é hora extra que sobrou depois de compensar — paga com adicional.
 * A sobra sai das extras do mês começando pelo adicional mais alto (domingo e
 * feriado primeiro, o que nunca prejudica o empregado); o que passar das
 * extras do mês (lançamento avulso positivo) vai pelo adicional de dia útil.
 * Reflete no DSR na mesma proporção das extras.
 *
 * Negativo: horas devidas descontadas pelo valor da hora, sem adicional.
 */
export function valorizarAcertoBanco(
  r: ResultadoPeriodo, valorHoraCentavos: number, acertoMin: number, regras: RegrasApuracao,
): AcertoBancoValores {
  const vazio: AcertoBancoValores = { acertoMin, porAdicionalMin: {}, extrasCentavos: 0, reflexoDsrCentavos: 0, descontoCentavos: 0 };
  if (acertoMin < 0) return { ...vazio, descontoCentavos: porMin(-acertoMin, valorHoraCentavos) };
  if (acertoMin === 0) return vazio;

  const doMes: Record<string, number> = {};
  for (const d of r.dias) {
    for (const e of d.extras) {
      if (ehIndenizacao(e.motivo)) continue;
      doMes[String(e.adicionalPct)] = (doMes[String(e.adicionalPct)] ?? 0) + e.min;
    }
  }
  const porAdicionalMin: Record<string, number> = {};
  let falta = acertoMin;
  for (const pct of Object.keys(doMes).sort((a, b) => Number(b) - Number(a))) {
    if (falta <= 0) break;
    const usa = Math.min(falta, doMes[pct]!);
    if (usa > 0) porAdicionalMin[pct] = usa;
    falta -= usa;
  }
  if (falta > 0) {
    const k = String(regras.extra.diaUtilPct);
    porAdicionalMin[k] = (porAdicionalMin[k] ?? 0) + falta;
  }

  let extrasCentavos = 0;
  for (const [pct, min] of Object.entries(porAdicionalMin)) {
    extrasCentavos += Math.round(porMin(min, valorHoraCentavos) * (1 + Number(pct) / 100));
  }
  const extrasMesMin = Object.values(doMes).reduce((a, b) => a + b, 0);
  const reflexoMin = extrasMesMin > 0 ? Math.round(r.reflexoDsrMin * Math.min(1, acertoMin / extrasMesMin)) : 0;
  return { ...vazio, porAdicionalMin, extrasCentavos, reflexoDsrCentavos: porMin(reflexoMin, valorHoraCentavos) };
}
