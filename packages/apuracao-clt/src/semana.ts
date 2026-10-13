import type { EntradaDia, ExtraClassificada, RegrasApuracao, ResultadoDia, SemanaCompensada } from './tipos.js';

/**
 * Compensação dentro da semana (escala "compensa na semana").
 *
 * A pessoa distribui a carga da semana como quiser entre os dias de trabalho
 * (estica a semana e folga o sábado, ou vem no sábado e sai mais cedo). O que
 * vale é o TOTAL da semana (segunda a domingo):
 *  - dia sem batida não é falta se a semana fechar a carga;
 *  - no fim da semana, o que passou da carga vira extra (ou crédito de banco),
 *    o que faltou vira atraso, e só vira falta quando falta um dia inteiro;
 *  - domingo, feriado e folga trabalhados continuam fora da conta (extra do dia);
 *  - acima de 10h no dia (Art. 59) é extra no próprio dia;
 *  - intervalo e interjornada seguem dia a dia (indenizações não mudam).
 *
 * Semana que ainda não terminou (ou termina no mês seguinte) fica ABERTA:
 * os dias aparecem com o trabalhado, sem extra/atraso/falta. O resultado entra
 * no mês em que a semana termina.
 */

/** Teto diário (Art. 59): até 10h o que passar da carga do dia fica na conta da semana. */
const TETO_DIA_MIN = 600;

function segunda(iso: string): string {
  const d = new Date(`${iso}T12:00:00-0300`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return d.toISOString().slice(0, 10);
}
function somarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00-0300`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Dia que entra na conta da semana: escala que compensa, dia de trabalho comum. */
function compensavel(e: EntradaDia | undefined, r: ResultadoDia): boolean {
  return !!e?.compensaSemana && e.regime !== 'r12x36' && !e.ehDomingo && !e.ehFeriado && !r.ehDescansoDia;
}

const ehIndenizacao = (x: ExtraClassificada) => x.motivo.startsWith('indenização');

export interface OpcoesSemana {
  /** Dias antes desta data só servem para fechar a semana (são de outro mês). */
  recorteDe?: string;
  /** Último dia do período apurado: semana que termina depois fica aberta. */
  fimPeriodo?: string;
}

export function compensarSemanas(
  entradas: EntradaDia[], resultados: ResultadoDia[], regras: RegrasApuracao, opts: OpcoesSemana = {},
): ResultadoDia[] {
  const porData = new Map(entradas.map((e) => [e.data, e]));
  if (!entradas.some((e) => e.compensaSemana)) return resultados;

  const out = resultados.map((r) => ({ ...r, extras: [...r.extras], observacoes: [...r.observacoes] }));
  const semanas = new Map<string, ResultadoDia[]>();
  for (const r of out) {
    if (!compensavel(porData.get(r.data), r)) continue;
    const k = segunda(r.data);
    semanas.set(k, [...(semanas.get(k) ?? []), r]);
  }

  for (const [ini, dias] of semanas) {
    const fim = somarDias(ini, 6);
    dias.sort((a, b) => a.data.localeCompare(b.data));
    // Fechada só quando o domingo já foi apurado (existe no período e não é hoje)
    // e a semana termina dentro do período. Dia pendente segura a semana.
    const domingo = out.find((r) => r.data === fim);
    const terminaDepois = !!opts.fimPeriodo && fim > opts.fimPeriodo;
    const domingoEmCurso = !domingo || !!porData.get(fim)?.diaEmCurso;
    const temPendente = dias.some((d) => d.pendente);
    const estado: SemanaCompensada['estado'] = terminaDepois ? 'PROXIMO_MES' : (domingoEmCurso || temPendente) ? 'ABERTA' : 'FECHADA';

    // Acima de 10h no dia é extra do próprio dia; o resto entra na semana.
    const tetoExtra = (d: ResultadoDia) => Math.max(0, d.minutosTrabalhados - TETO_DIA_MIN);
    const feito = dias.reduce((a, d) => a + Math.min(d.minutosTrabalhados, TETO_DIA_MIN), 0);
    const carga = dias.reduce((a, d) => a + d.minutosContratados, 0);
    let liquido = feito - carga;
    if (Math.abs(liquido) <= regras.toleranciaDiariaMin) liquido = 0;

    // Zera o resultado diário (fica só o trabalhado, a indenização e o excesso de 10h).
    for (const d of dias) {
      const exc = tetoExtra(d);
      const indeniz = d.extras.filter(ehIndenizacao);
      d.extras = [...indeniz];
      if (exc > 0) d.extras.push({ min: exc, adicionalPct: regras.extra.diaUtilPct, motivo: 'extra acima de 10h no dia' });
      d.extrasTotalMin = d.extras.reduce((a, x) => a + x.min, 0);
      d.faltaMin = 0; d.faltaInjustificada = false; d.atrasoMin = 0;
      d.saldoMin = exc;
      d.observacoes = d.observacoes.filter((o) => !/^(Atraso|Jornada incompleta|Extra diária|Falta)/.test(o));
      d.semana = { inicio: ini, fim, estado, feitoMin: feito, cargaMin: carga, resultadoMin: estado === 'FECHADA' ? liquido : 0,
        compensado: d.minutosTrabalhados === 0 && d.minutosContratados > 0, pendente: temPendente };
    }
    if (estado !== 'FECHADA') {
      const msg = estado === 'PROXIMO_MES' ? 'Compensa na semana: a semana termina no mês seguinte e fecha lá.'
        : temPendente ? 'Compensa na semana: há batida em aberto na semana — trate para a semana fechar.' : 'Compensa na semana: a semana ainda não fechou.';
      for (const d of dias) if (!d.observacoes.includes(msg)) d.observacoes.push(msg);
      continue;
    }

    // Onde o resultado da semana é lançado: último dia do período que conta.
    const noPeriodo = dias.filter((d) => !opts.recorteDe || d.data >= opts.recorteDe);
    const alvo = [...noPeriodo].reverse().find((d) => d.minutosTrabalhados > 0) ?? noPeriodo[noPeriodo.length - 1];
    if (!alvo) continue;

    if (liquido > 0) {
      const flex = dias.some((d) => porData.get(d.data)?.jornadaFlexivel);
      if (!(flex && regras.bancoDeHoras)) {
        alvo.extras.push({ min: liquido, adicionalPct: regras.extra.diaUtilPct, motivo: 'extra da semana' });
        alvo.extrasTotalMin += liquido;
      }
      alvo.saldoMin += liquido;
      alvo.observacoes.push(`Semana ${ini.slice(8)}/${ini.slice(5, 7)}–${fim.slice(8)}/${fim.slice(5, 7)}: ${liquido}min acima da carga.`);
    } else if (liquido < 0) {
      let falta = -liquido;
      // Dia inteiro devendo vira falta: os dias sem batida, do mais antigo, dentro do período.
      for (const d of noPeriodo) {
        if (d.minutosTrabalhados === 0 && d.minutosContratados > 0 && falta >= d.minutosContratados) {
          d.faltaMin = d.minutosContratados; d.faltaInjustificada = true;
          d.semana = { ...d.semana!, compensado: false };
          d.observacoes.push('Falta: a semana não fechou a carga e este dia ficou sem batida.');
          falta -= d.minutosContratados;
        }
      }
      if (falta > 0) {
        alvo.atrasoMin += falta;
        alvo.saldoMin -= falta;
        alvo.observacoes.push(`Semana ${ini.slice(8)}/${ini.slice(5, 7)}–${fim.slice(8)}/${fim.slice(5, 7)}: ${falta}min abaixo da carga.`);
      }
    }
  }
  return out;
}
