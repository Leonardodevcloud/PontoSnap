import { minutosParaHhMm } from '../lib/formato';
import css from './Fechamento.module.css';

/**
 * Resumo do mês — começa pelo que importa: a hora extra e o atraso REAIS, com o
 * destino de cada um conforme a regra do funcionário (folha ou banco). O feriado
 * trabalhado aparece à parte (verba própria 100%). Nada de "diferença de
 * relógio", tolerância ou saldo intermediário: a conta crua só confunde — o
 * detalhe dia a dia fica na tabela do espelho.
 */
export interface DadosFechamento {
  /** Total de extras do motor (inclui feriado e indenização). */
  extrasTotalMin: number;
  atrasoMin: number;
  faltaMin: number;
  /** Feriado/domingo trabalhado pago à parte na folha (100%). */
  feriadoAParteMin: number;
  /** Indenização de intervalo/interjornada (+50%), verba própria. */
  indenizMin: number;
  /** true = extras vão para o banco; false = pagas na folha. */
  banco: boolean;
  atrasoDestino?: 'BANCO' | 'DESCONTA' | 'TOLERA' | 'FOLHA';
  faltaDestino?: 'BANCO' | 'DESCONTA' | 'ABONA' | 'FOLHA';
}

const hhmm = (m: number) => minutosParaHhMm(Math.abs(m));

export function Fechamento({ d }: { d: DadosFechamento }) {
  // Hora extra "produtiva" = o que passou, menos feriado (à parte) e menos a
  // indenização de intervalo (verba própria, mostrada à parte).
  const extrasMes = Math.max(0, d.extrasTotalMin - d.feriadoAParteMin);
  const extraProd = Math.max(0, extrasMes - d.indenizMin);
  const extraDest = d.banco ? 'crédito no banco' : 'paga na folha';
  const atrasoDest = d.atrasoDestino === 'BANCO' ? 'abate do banco'
    : d.atrasoDestino === 'TOLERA' ? 'tolerado' : 'descontado na folha';
  const faltaDest = d.faltaDestino === 'BANCO' ? 'abate do banco'
    : d.faltaDestino === 'ABONA' ? 'abonada' : 'descontada na folha';

  return (
    <section className={css.card} aria-label="Resumo do mês">
      <div className={css.resultado}>
        <div className={`${css.big} ${css.extra}`}>
          <div className={css.rot}>Hora extra</div>
          <div className={css.n}>{extraProd > 0 ? `+${hhmm(extraProd)}` : '0h00'}</div>
          <div className={css.dest}>{extraProd > 0 ? `→ ${extraDest}` : 'sem extra no mês'}</div>
        </div>
        <div className={`${css.big} ${css.atraso}`}>
          <div className={css.rot}>Atraso / saída antecipada</div>
          <div className={css.n}>{d.atrasoMin > 0 ? `−${hhmm(d.atrasoMin)}` : '0h00'}</div>
          <div className={css.dest}>{d.atrasoMin > 0 ? `→ ${atrasoDest}` : 'nenhum atraso'}</div>
        </div>
      </div>

      {d.indenizMin > 0 && (
        <div className={css.linha}>
          <span>Indenização de intervalo<small>verba +50% (Art. 71 §4º) · {d.banco ? 'crédito no banco' : 'paga na folha'}</small></span>
          <span className={css.v}>{hhmm(d.indenizMin)}</span>
        </div>
      )}

      {d.faltaMin > 0 && (
        <div className={css.linha}>
          <span>Faltas de dia inteiro<small>→ {faltaDest}</small></span>
          <span className={css.v}>{hhmm(d.faltaMin)}</span>
        </div>
      )}

      {d.feriadoAParteMin > 0 && (
        <div className={css.aparte}>
          <div className={css.t}>Feriado trabalhado — 100%<small>Verba própria, paga à parte na folha</small></div>
          <div className={css.v}>{hhmm(d.feriadoAParteMin)}</div>
        </div>
      )}

      <div className={css.rodape}>
        A regra do funcionário decide o destino: {d.banco ? 'com banco, a extra vira crédito e o atraso débito do banco' : 'sem banco, a extra é paga e o atraso descontado na folha'}. O feriado trabalhado é sempre verba própria (100%), à parte.
      </div>
    </section>
  );
}
