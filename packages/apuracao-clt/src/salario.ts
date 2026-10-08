import type { RegrasApuracao, ResultadoDia, ResultadoPeriodo } from './tipos.js';
import { valorizarPeriodo, type DestinoValores, type ResultadoValores } from './valores.js';

/**
 * Salário com vigência. Uma promoção no meio do mês não reescreve o passado:
 * cada dia é valorizado pelo salário que valia NAQUELE dia, e o salário do mês
 * sai proporcional (base comercial de 30 dias, como na folha).
 */
export interface SalarioVigente {
  /** YYYY-MM-DD a partir de quando vale. */
  desde: string;
  centavos: number;
}

/** Salário que vale numa data (o mais recente com desde ≤ data). */
export function salarioEm(salarios: SalarioVigente[], data: string): number | null {
  let atual: number | null = null;
  for (const s of [...salarios].sort((a, b) => a.desde.localeCompare(b.desde))) {
    if (s.desde <= data) atual = s.centavos;
  }
  return atual;
}

export interface ParteSalario { desde: string; ate: string; dias: number; salarioCent: number; valorCent: number }

/**
 * Salário do mês, proporcional quando muda no meio. Mês comercial de 30 dias:
 * cada dia corrido vale salário/30, e o último trecho fecha os 30 — assim um mês
 * sem mudança paga exatamente o salário cheio (28, 30 ou 31 dias).
 */
export function salarioDoMes(salarios: SalarioVigente[], comp: string): { totalCent: number; partes: ParteSalario[] } | null {
  const [a, m] = comp.split('-').map(Number) as [number, number];
  const n = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const p2 = (x: number) => String(x).padStart(2, '0');
  const partes: ParteSalario[] = [];
  for (let d = 1; d <= n; d++) {
    const data = `${comp}-${p2(d)}`;
    const s = salarioEm(salarios, data);
    if (s == null) continue; // ainda sem salário (admissão no meio do mês)
    const ult = partes[partes.length - 1];
    if (ult && ult.salarioCent === s && ult.ate === `${comp}-${p2(d - 1)}`) { ult.ate = data; ult.dias++; }
    else partes.push({ desde: data, ate: data, dias: 1, salarioCent: s, valorCent: 0 });
  }
  if (partes.length === 0) return null;
  if (partes.length === 1 && partes[0]!.dias === n) {
    partes[0]!.valorCent = partes[0]!.salarioCent;
    return { totalCent: partes[0]!.salarioCent, partes };
  }
  // Trechos anteriores pelos dias corridos; o último completa os 30 dias (se o
  // primeiro trecho começa no dia 1). Admissão no meio: só os dias trabalhados.
  const comecaNoDia1 = partes[0]!.desde === `${comp}-01`;
  let usados = 0;
  partes.forEach((p, i) => {
    const ultimo = i === partes.length - 1;
    const dias = ultimo && comecaNoDia1 ? Math.max(0, 30 - usados) : Math.min(p.dias, 30 - usados);
    p.valorCent = Math.round((p.salarioCent * dias) / 30);
    usados += dias;
  });
  return { totalCent: partes.reduce((s, p) => s + p.valorCent, 0), partes };
}

const segundaDaSemana = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return d.toISOString().slice(0, 10);
};

/**
 * Valoriza o período com salário por dia. Sem mudança no período, é exatamente
 * valorizarPeriodo. Com mudança, divide os dias por salário, valoriza cada
 * trecho com o salário dele e soma.
 */
export function valorizarComSalarios(
  r: ResultadoPeriodo, salarios: SalarioVigente[], horasMensaisFolha: number, regras: RegrasApuracao, dest: DestinoValores = {},
): ResultadoValores | null {
  if (salarios.length === 0) return null;
  const salDia = (d: string) => salarioEm(salarios, d) ?? 0;
  const trechos: { sal: number; dias: ResultadoDia[] }[] = [];
  for (const d of [...r.dias].sort((x, y) => x.data.localeCompare(y.data))) {
    const s = salDia(d.data);
    const ult = trechos[trechos.length - 1];
    if (ult && ult.sal === s) ult.dias.push(d); else trechos.push({ sal: s, dias: [d] });
  }
  if (trechos.length <= 1) {
    const s = trechos[0]?.sal ?? salarioEm(salarios, '9999-12-31') ?? 0;
    return valorizarPeriodo(r, { salarioMensalCentavos: s, horasMensaisFolha }, regras, dest);
  }

  // DSR perdido é por semana: atribui a semana ao trecho do primeiro dia de falta dela.
  const semanaDoTrecho = new Map<string, number>();
  trechos.forEach((t, i) => t.dias.forEach((d) => {
    if (!d.faltaInjustificada) return;
    const k = segundaDaSemana(d.data);
    if (!semanaDoTrecho.has(k)) semanaDoTrecho.set(k, i);
  }));

  const soma = (l: ResultadoDia[], f: (d: ResultadoDia) => number) => l.reduce((a, d) => a + f(d), 0);
  const parciais = trechos.map((t, i) => {
    const extrasPorAdicional: Record<string, number> = {};
    for (const d of t.dias) for (const e of d.extras) extrasPorAdicional[String(e.adicionalPct)] = (extrasPorAdicional[String(e.adicionalPct)] ?? 0) + e.min;
    const totalExtrasMin = soma(t.dias, (d) => d.extrasTotalMin);
    const sub: ResultadoPeriodo = {
      dias: t.dias,
      totalTrabalhadoMin: soma(t.dias, (d) => d.minutosTrabalhados),
      totalContratadoMin: soma(t.dias, (d) => d.minutosContratados),
      totalExtrasMin, extrasPorAdicional,
      totalNoturnoLegalMin: soma(t.dias, (d) => d.minutosNoturnosLegais),
      totalFaltaMin: soma(t.dias, (d) => d.faltaMin),
      totalAtrasoMin: soma(t.dias, (d) => d.atrasoMin),
      saldoPeriodoMin: soma(t.dias, (d) => d.saldoMin),
      bancoDeHorasMin: 0,
      reflexoDsrMin: r.totalExtrasMin > 0 ? Math.round((r.reflexoDsrMin * totalExtrasMin) / r.totalExtrasMin) : 0,
      dsrPerdidoSemanas: [...semanaDoTrecho.values()].filter((x) => x === i).length,
      diasComViolacao: [], diasPendentes: [],
    };
    return valorizarPeriodo(sub, { salarioMensalCentavos: t.sal, horasMensaisFolha }, regras, dest);
  });

  const total = (f: (v: ResultadoValores) => number) => parciais.reduce((a, v) => a + f(v), 0);
  const extrasPorAdicionalCentavos: Record<string, number> = {};
  for (const v of parciais) for (const [k, c] of Object.entries(v.extrasPorAdicionalCentavos)) extrasPorAdicionalCentavos[k] = (extrasPorAdicionalCentavos[k] ?? 0) + c;
  return {
    valorHoraCentavos: parciais[parciais.length - 1]!.valorHoraCentavos,
    extrasPorAdicionalCentavos,
    extrasCentavos: total((v) => v.extrasCentavos),
    adicionalNoturnoCentavos: total((v) => v.adicionalNoturnoCentavos),
    reflexoDsrCentavos: total((v) => v.reflexoDsrCentavos),
    descontoFaltasCentavos: total((v) => v.descontoFaltasCentavos),
    descontoAtrasosCentavos: total((v) => v.descontoAtrasosCentavos),
    descontoDsrPerdidoCentavos: total((v) => v.descontoDsrPerdidoCentavos),
    liquidoProventosCentavos: total((v) => v.liquidoProventosCentavos),
    extrasNoBancoMin: total((v) => v.extrasNoBancoMin),
    indenizacaoMin: total((v) => v.indenizacaoMin),
    indenizacaoCentavos: total((v) => v.indenizacaoCentavos),
  };
}
