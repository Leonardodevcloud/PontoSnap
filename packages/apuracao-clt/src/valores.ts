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
}

const porMin = (min: number, taxaHoraCentavos: number) => Math.round((min / 60) * taxaHoraCentavos);

/**
 * Converte a apuração (em minutos) em valores de folha (em centavos).
 * Não é a folha completa — cobre só o que a jornada gera: extras com adicional,
 * adicional noturno, reflexo de DSR e os descontos de falta/atraso/DSR perdido.
 */
export function valorizarPeriodo(r: ResultadoPeriodo, p: ParametrosValor, regras: RegrasApuracao): ResultadoValores {
  const valorHora = Math.round(p.salarioMensalCentavos / p.horasMensaisFolha);

  const extrasPorAdicionalCentavos: Record<string, number> = {};
  let extras = 0;
  for (const [pct, min] of Object.entries(r.extrasPorAdicional)) {
    const v = Math.round(porMin(min, valorHora) * (1 + Number(pct) / 100));
    extrasPorAdicionalCentavos[pct] = v;
    extras += v;
  }

  const adicionalNoturno = Math.round(porMin(r.totalNoturnoLegalMin, valorHora) * (regras.noturno.adicionalPct / 100));
  const reflexoDsr = porMin(r.reflexoDsrMin, valorHora);
  const descFaltas = porMin(r.totalFaltaMin, valorHora);
  const descAtrasos = porMin(r.totalAtrasoMin, valorHora);
  const salarioDia = Math.round(p.salarioMensalCentavos / 30);
  const descDsrPerdido = r.dsrPerdidoSemanas * salarioDia;

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
  };
}
