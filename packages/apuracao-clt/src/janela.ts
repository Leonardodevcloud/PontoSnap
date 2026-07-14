import type { RegrasApuracao } from './tipos.js';
import { diffMin, minutosDoDia, minutosDeHHMM } from './tempo.js';

export interface Desvio { min: number; tipo: 'atraso' | 'extra'; }

/**
 * Confronta as batidas reais com a janela prevista, marcação a marcação:
 * entrada tardia / saída antecipada = atraso; entrada adiantada / saída
 * tardia = extra. Pares faltantes viram atraso; pares além do previsto, extra.
 */
export function desviosDaJanela(
  pares: Array<[Date, Date]>,
  janela: Array<{ entrada: string; saida: string }>,
): Desvio[] {
  const out: Desvio[] = [];
  const jm = janela.map((p) => ({ e: minutosDeHHMM(p.entrada), s: minutosDeHHMM(p.saida) }));
  const max = Math.max(pares.length, jm.length);
  for (let i = 0; i < max; i++) {
    const par = pares[i];
    const j = jm[i];
    if (par && j) {
      const entrada = minutosDoDia(par[0]) - j.e; // + atraso / - extra antes
      const saida = j.s - minutosDoDia(par[1]);    // + saída antecipada / - extra depois
      if (entrada > 0) out.push({ min: entrada, tipo: 'atraso' });
      else if (entrada < 0) out.push({ min: -entrada, tipo: 'extra' });
      if (saida > 0) out.push({ min: saida, tipo: 'atraso' });
      else if (saida < 0) out.push({ min: -saida, tipo: 'extra' });
    } else if (par && !j) {
      out.push({ min: Math.max(0, diffMin(par[0], par[1])), tipo: 'extra' });
    } else if (!par && j) {
      out.push({ min: Math.max(0, j.s - j.e), tipo: 'atraso' });
    }
  }
  return out;
}

/** Tolerância da Súmula 366 TST: 5min por marcação, teto de 10min/dia. */
export function aplicarTolerancia(desvios: Desvio[], regras: RegrasApuracao): { atraso: number; extra: number } {
  let orcamento = regras.toleranciaDiariaMin;
  let atraso = 0;
  let extra = 0;
  for (const d of desvios) {
    let efetivo = d.min;
    if (d.min <= regras.toleranciaPorMarcacaoMin && orcamento > 0) {
      const t = Math.min(d.min, orcamento);
      orcamento -= t;
      efetivo = d.min - t;
    }
    if (d.tipo === 'atraso') atraso += efetivo; else extra += efetivo;
  }
  return { atraso, extra };
}

/** A janela é apurável só se todos os pares previstos ficam no mesmo dia. */
export function janelaMesmoDia(janela: Array<{ entrada: string; saida: string }>): boolean {
  return janela.length > 0 && janela.every((p) => minutosDeHHMM(p.saida) > minutosDeHHMM(p.entrada));
}
