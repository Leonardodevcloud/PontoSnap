import type { EntradaDia, RegrasApuracao, ResultadoDia, ResultadoPeriodo } from './tipos.js';
import { apurarDia } from './dia.js';

/** Chave da semana: data (YYYY-MM-DD) da segunda-feira daquela semana (-0300). */
function segundaDaSemana(iso: string): string {
  const d = new Date(`${iso}T12:00:00-0300`);
  const dow = d.getUTCDay(); // 0=dom
  const ajuste = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + ajuste);
  return d.toISOString().slice(0, 10);
}

/**
 * Apura um período (competência). Encadeia os dias em ordem para calcular a
 * interjornada, agrega os totais, estima o reflexo em DSR e trata o banco.
 */
export function apurarPeriodo(dias: EntradaDia[], regras: RegrasApuracao): ResultadoPeriodo {
  const ordenados = [...dias].sort((a, b) => a.data.localeCompare(b.data));

  const resultados: ResultadoDia[] = [];
  let saidaAnterior: Date | undefined;
  for (const d of ordenados) {
    const r = apurarDia({ ...d, saidaDiaAnterior: saidaAnterior }, regras);
    resultados.push(r);
    const ms = [...d.marcacoes].sort((a, b) => a.getTime() - b.getTime());
    if (ms.length) saidaAnterior = ms[ms.length - 1];
  }

  const soma = (f: (r: ResultadoDia) => number) => resultados.reduce((acc, r) => acc + f(r), 0);
  const totalTrabalhado = soma((r) => r.minutosTrabalhados);
  const totalContratado = soma((r) => r.minutosContratados);
  const totalExtras = soma((r) => r.extrasTotalMin);
  const totalFalta = soma((r) => r.faltaMin);
  const totalNoturno = soma((r) => r.minutosNoturnosLegais);
  const totalAtraso = soma((r) => r.atrasoMin);

  const extrasPorAdicional: Record<string, number> = {};
  for (const r of resultados) {
    for (const e of r.extras) {
      const k = String(e.adicionalPct);
      extrasPorAdicional[k] = (extrasPorAdicional[k] ?? 0) + e.min;
    }
  }

  const saldoPeriodo = soma((r) => r.saldoMin);
  const bancoDeHoras = regras.bancoDeHoras ? saldoPeriodo : 0;

  // Reflexo do DSR sobre as extras — ESTIMATIVA por semana:
  // em cada semana, (extras / dias trabalhados) * dias de descanso.
  // Perda de DSR (Lei 605/49): semana com falta injustificada perde o repouso.
  const semanas = new Map<string, ResultadoDia[]>();
  for (const r of resultados) {
    const k = segundaDaSemana(r.data);
    const arr = semanas.get(k) ?? [];
    arr.push(r);
    semanas.set(k, arr);
  }
  let reflexoDsr = 0;
  let dsrPerdidoSemanas = 0;
  for (const dias of semanas.values()) {
    const extrasSemana = dias.reduce((a, x) => a + x.extrasTotalMin, 0);
    const trab = dias.filter((x) => x.minutosTrabalhados > 0).length;
    const desc = dias.filter((x) => x.ehDescansoDia).length;
    if (trab > 0 && desc > 0) reflexoDsr += Math.round((extrasSemana / trab) * desc);
    if (dias.some((x) => x.faltaInjustificada)) dsrPerdidoSemanas++;
  }

  const diasComViolacao = resultados
    .filter((r) => r.violacaoInterjornada || r.penalidadeIntervaloMin > 0 || r.paresIncompletos)
    .map((r) => r.data);

  return {
    dias: resultados,
    totalTrabalhadoMin: totalTrabalhado,
    totalContratadoMin: totalContratado,
    totalExtrasMin: totalExtras,
    extrasPorAdicional,
    totalNoturnoLegalMin: totalNoturno,
    totalFaltaMin: totalFalta,
    totalAtrasoMin: totalAtraso,
    saldoPeriodoMin: saldoPeriodo,
    bancoDeHorasMin: bancoDeHoras,
    reflexoDsrMin: reflexoDsr,
    dsrPerdidoSemanas,
    diasComViolacao,
  };
}
