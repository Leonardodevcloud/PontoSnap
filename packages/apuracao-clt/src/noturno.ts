import type { RegrasApuracao } from './tipos.js';
import { minutosDoDia } from './tempo.js';

/**
 * Minutos noturnos de relógio no intervalo [ent, sai).
 * Com prorrogação (Súmula 60 II TST): se o turno entra na janela noturna e
 * continua para além do fim dela (ex.: passa das 05h), o tempo prorrogado
 * também conta como noturno.
 */
export function minutosNoturnosReais(ent: Date, sai: Date, regras: RegrasApuracao): number {
  const { inicioMin, fimMin, prorrogacao } = regras.noturno;
  const noJanela = (m: number) => (inicioMin < fimMin ? m >= inicioMin && m < fimMin : m >= inicioMin || m < fimMin);
  let n = 0;
  let entrouNaNoite = false;
  const cur = new Date(ent);
  while (cur.getTime() < sai.getTime()) {
    const m = minutosDoDia(cur);
    if (noJanela(m)) { n++; entrouNaNoite = true; }
    else if (prorrogacao && entrouNaNoite) n++; // prorrogação: segue contando até o fim do par
    cur.setUTCMinutes(cur.getUTCMinutes() + 1);
  }
  return n;
}

/** Hora reduzida (52min30s): 7h de relógio = 8h legais (fator 60/52,5). */
export function noturnoLegal(minutosReais: number, reduzida: boolean): number {
  return reduzida ? Math.round((minutosReais * 60) / 52.5) : minutosReais;
}
