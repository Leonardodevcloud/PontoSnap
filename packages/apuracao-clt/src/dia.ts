import type { EntradaDia, ExtraClassificada, RegrasApuracao, ResultadoDia } from './tipos.js';
import { diffMin, minutosDoDia } from './tempo.js';
import { minutosNoturnosReais, noturnoLegal } from './noturno.js';
import { desviosDaJanela, aplicarTolerancia, janelaMesmoDia } from './janela.js';

/** Apura um dia de jornada a partir das batidas cegas e das regras. */
export function apurarDia(dia: EntradaDia, regras: RegrasApuracao): ResultadoDia {
  const obs: string[] = [];
  const ms = [...dia.marcacoes].sort((a, b) => a.getTime() - b.getTime());
  const paresIncompletos = ms.length % 2 !== 0;
  if (paresIncompletos) obs.push('Número ímpar de batidas — jornada em aberto.');

  const pares: Array<[Date, Date]> = [];
  for (let i = 0; i + 1 < ms.length; i += 2) pares.push([ms[i]!, ms[i + 1]!]);

  // trabalhado bruto (o intervalo, gap entre pares, já fica de fora)
  let trabalhado = 0;
  for (const [e, s] of pares) trabalhado += Math.max(0, diffMin(e, s));

  // noturno (real e legal)
  let notReais = 0;
  for (const [e, s] of pares) notReais += minutosNoturnosReais(e, s, regras);
  const notLegais = noturnoLegal(notReais, regras.noturno.reduzida);

  // intervalo intrajornada = soma dos gaps entre pares
  let intervalo = 0;
  for (let i = 0; i + 1 < pares.length; i++) intervalo += Math.max(0, diffMin(pares[i]![1], pares[i + 1]![0]));

  const r12x36 = dia.regime === 'r12x36';

  // penalidade de intervalo por faixa (Art. 71: >6h→60min; 4–6h→15min)
  let penIntervalo = 0;
  const faixa = [...regras.intervalo.faixas].sort((a, b) => b.acimaMin - a.acimaMin).find((f) => trabalhado > f.acimaMin);
  if (regras.intervalo.penalidade && faixa && pares.length > 0 && intervalo < faixa.minimoMin) {
    penIntervalo = faixa.minimoMin - intervalo;
    obs.push(`Intervalo insuficiente (${intervalo}min de ${faixa.minimoMin}): ${penIntervalo}min indenizáveis +50% (Art. 71 §4º).`);
  }

  // interjornada (Art. 66) — não se aplica ao regime 12x36 (Art. 59-A)
  let violInter = false;
  let penInter = 0;
  if (!r12x36 && dia.saidaDiaAnterior && pares.length > 0) {
    const gap = diffMin(dia.saidaDiaAnterior, pares[0]![0]);
    if (gap < regras.interjornadaMinimaMin) {
      violInter = true;
      penInter = regras.interjornadaMinimaMin - gap;
      obs.push(`Interjornada abaixo do mínimo: ${penInter}min indenizáveis +50% (Art. 66 / OJ 355 TST).`);
    }
  }

  // esperado do dia. No 12x36, domingo/feriado são dias normais da escala (Art. 59-A).
  const descanso = r12x36 ? !!dia.ehDescanso : (!!dia.ehDomingo || !!dia.ehFeriado || !!dia.ehDescanso);
  const premium = !r12x36 && (!!dia.ehDomingo || !!dia.ehFeriado); // 100% só em domingo/feriado (fora do 12x36)
  const esperado = descanso ? 0 : Math.max(0, dia.jornadaContratadaMin - (dia.ausenciaAbonadaMin ?? 0));
  const pctDia = premium ? regras.extra.domingoFeriadoPct : regras.extra.diaUtilPct;
  const motivoExtra = premium ? 'extra em domingo/feriado' : dia.ehDescanso ? 'extra em folga' : 'hora extra';

  const extras: ExtraClassificada[] = [];
  let extrasTotal = 0;
  let falta = 0;
  let atrasoMin = 0;
  let saldo = 0;

  const usaJanela = !descanso && !!dia.janelaPrevista && janelaMesmoDia(dia.janelaPrevista)
    && pares.every(([e, s]) => minutosDoDia(s) >= minutosDoDia(e)); // sem virada de dia

  if (descanso) {
    // trabalho em dia de descanso: tudo é extra (tolerância no total)
    const bruto = trabalhado;
    if (bruto > regras.toleranciaDiariaMin) {
      extras.push({ min: bruto, adicionalPct: pctDia, motivo: motivoExtra });
      extrasTotal += bruto;
      saldo = bruto;
    }
  } else if (usaJanela) {
    if (trabalhado === 0) {
      falta = esperado;
    } else {
      const desvios = desviosDaJanela(pares, dia.janelaPrevista!);
      let { atraso, extra } = aplicarTolerancia(desvios, regras);
      if (regras.compensarAtrasoComExtra) {
        const net = extra - atraso;
        extra = Math.max(0, net);
        atraso = Math.max(0, -net);
      }
      if (extra > 0) {
        extras.push({ min: extra, adicionalPct: pctDia, motivo: motivoExtra });
        extrasTotal += extra;
        if (extra > regras.extra.limiteDiarioMin) obs.push(`Extra diária acima do limite legal (${regras.extra.limiteDiarioMin}min).`);
      }
      atrasoMin = atraso;
      if (atraso > 0) obs.push(`Atraso/saída antecipada: ${atraso}min (confronto com a jornada prevista).`);
      saldo = extra - atraso;
    }
  } else {
    // fallback: apuração pelo total do dia, com tolerância no líquido (Súmula 366)
    const bruto = trabalhado - esperado;
    saldo = Math.abs(bruto) <= regras.toleranciaDiariaMin ? 0 : bruto;
    if (saldo > 0) {
      extras.push({ min: saldo, adicionalPct: pctDia, motivo: motivoExtra });
      extrasTotal += saldo;
      if (saldo > regras.extra.limiteDiarioMin) obs.push(`Extra diária acima do limite legal (${regras.extra.limiteDiarioMin}min).`);
    } else if (saldo < 0) {
      falta = -saldo;
    }
  }

  // penalidades entram como indenização +50%
  const indeniz = penIntervalo + penInter;
  if (indeniz > 0) {
    extras.push({ min: indeniz, adicionalPct: 50, motivo: 'indenização de intervalo' });
    extrasTotal += indeniz;
  }

  return {
    data: dia.data,
    marcacoes: dia.marcacoes,
    minutosTrabalhados: trabalhado,
    minutosContratados: esperado,
    minutosNoturnosReais: notReais,
    minutosNoturnosLegais: notLegais,
    extras,
    extrasTotalMin: extrasTotal,
    faltaMin: falta,
    faltaInjustificada: falta > 0,
    ehDescansoDia: descanso,
    atrasoMin,
    saldoMin: saldo,
    intervaloGozadoMin: intervalo,
    penalidadeIntervaloMin: penIntervalo,
    penalidadeInterjornadaMin: penInter,
    violacaoInterjornada: violInter,
    paresIncompletos,
    observacoes: obs,
  };
}
