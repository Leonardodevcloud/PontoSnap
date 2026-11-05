import { minutosParaHhMm } from '../lib/formato';
import css from './Fechamento.module.css';

/**
 * Painel de Fechamento do mês — a reconciliação da apuração, igual ao rodapé
 * do espelho PDF. Mostra as positivas por natureza (hora extra + indenização
 * de intervalo), o feriado trabalhado pago à parte, as negativas e, por baixo,
 * como "trabalhado − previsto" se encaixa com o saldo líquido e a tolerância.
 *
 * Tudo vem dos totais do próprio motor (ResultadoCLT), sem recalcular — por
 * isso bate, no número, com o espelho.
 */
export interface DadosFechamento {
  trabalhadoMin: number;
  previstoMin: number;
  /** Total de extras do motor (inclui feriado e indenização). */
  extrasTotalMin: number;
  atrasoMin: number;
  faltaMin: number;
  saldoMin: number;
  /** Feriado/domingo trabalhado pago à parte na folha (100%). */
  feriadoAParteMin: number;
  /** Indenização de intervalo/interjornada (+50%), verba fora do saldo. */
  indenizMin: number;
  /** true = extras vão para o banco; false = pagas na folha. */
  banco: boolean;
}

const hhmm = (m: number) => minutosParaHhMm(Math.abs(m));
const comSinal = (m: number) => `${m > 0 ? '+' : m < 0 ? '−' : ''}${hhmm(m)}`;

export function Fechamento({ d }: { d: DadosFechamento }) {
  // O feriado trabalhado é pago à parte (verba própria 100%) — não entra na conta
  // de trabalhado × previsto. Tiramos ele do trabalhado e do saldo para a
  // "diferença" ser a EXTRA REAL (a que vai pra folha ou pro banco).
  const feri = d.feriadoAParteMin;
  const trabFora = d.trabalhadoMin - feri;
  const diferenca = trabFora - d.previstoMin;
  const saldoFora = d.saldoMin - feri;
  const tolerancia = diferenca - saldoFora;
  // Horas extras do mês = tudo que passou, menos o feriado pago à parte (coluna Positivas do espelho).
  const extrasMes = Math.max(0, d.extrasTotalMin - feri);
  // Hora extra "produtiva" (sem a indenização, que é verba à parte).
  const extraProd = Math.max(0, extrasMes - d.indenizMin);

  return (
    <section className={css.card} aria-label="Fechamento do mês">
      <div className={css.topo}>
        <div><div className={css.rot}>Horas trabalhadas</div><div className={css.val}>{hhmm(trabFora)}</div>{feri > 0 && <div className={css.op}>fora o feriado ({hhmm(feri)} à parte)</div>}</div>
        <div><div className={css.rot}>Horas previstas</div><div className={css.val}>{hhmm(d.previstoMin)}</div></div>
        <div className={css.destaque}><div className={css.rot}>Diferença</div><div className={css.val}>{comSinal(diferenca)}</div><div className={css.op}>{feri > 0 ? 'a extra real (fora feriado)' : 'trabalhado − previsto'}</div></div>
      </div>

      <div className={`${css.secao} ${css.pos}`}>
        <div className={css.h}><span className={css.dot} style={{ background: 'var(--ok-text)' }} />Horas positivas</div>
        <div className={css.linha}>
          <div className={css.lbl}>Hora extra<span className={css.det}>Dias úteis acima da jornada + trabalho em folga/sábado</span></div>
          <div className={css.vl}>{extraProd > 0 ? hhmm(extraProd) : '—'}</div>
        </div>
        {d.indenizMin > 0 && (
          <div className={css.linha}>
            <div className={css.lbl}>Indenização de intervalo <span className={`${css.tag} ${css.tagY}`}>Art. 71 §4º</span><span className={css.det}>Intervalo abaixo do mínimo — verba +50%</span></div>
            <div className={css.vl}>{hhmm(d.indenizMin)}</div>
          </div>
        )}
        <div className={css.subtot}>
          <div className={css.lbl}>Horas extras do mês<span className={`${css.tag} ${css.tagB}`}>{d.banco ? 'Vão para o banco' : 'Pagas na folha'}</span></div>
          <div className={css.vl}>{extrasMes > 0 ? hhmm(extrasMes) : '0h00'}</div>
        </div>
      </div>

      {d.feriadoAParteMin > 0 && (
        <div className={css.aparte}>
          <div className={css.t}>Feriado trabalhado — 100%<small>Verba própria, paga na folha — não entra em "horas extras"</small></div>
          <div className={css.vl}>{hhmm(d.feriadoAParteMin)}</div>
        </div>
      )}

      {(d.atrasoMin > 0 || d.faltaMin > 0) && (
        <div className={`${css.secao} ${css.neg}`}>
          <div className={css.h}><span className={css.dot} style={{ background: 'var(--erro-text)' }} />Horas negativas</div>
          {d.atrasoMin > 0 && (
            <div className={css.linha}><div className={css.lbl}>Atrasos / saídas antecipadas<span className={css.det}>Confronto batida a batida com a janela (já com tolerância)</span></div><div className={css.vl}>{hhmm(d.atrasoMin)}</div></div>
          )}
          {d.faltaMin > 0 && (
            <div className={css.linha}><div className={css.lbl}>Faltas de dia inteiro</div><div className={css.vl}>{hhmm(d.faltaMin)}</div></div>
          )}
        </div>
      )}

      <div className={css.recon}>
        <div className={css.reconH}>Como os números se encaixam</div>
        <div className={css.eq}><span className={css.q}>Saldo líquido (extras produtivas − atrasos)</span><span className={css.r}>{comSinal(saldoFora)}</span></div>
        {tolerancia !== 0 && (
          <div className={css.eq}><span className={css.q}>Tolerância Súmula 366 absorvida</span><span className={css.r}>{comSinal(tolerancia)}</span></div>
        )}
        <div className={css.eq}><span className={css.q}><b>{feri > 0 ? 'Diferença (fora feriado)' : 'Trabalhado − previsto'}</b></span><span className={css.r}><b>{comSinal(diferenca)}</b></span></div>
        <div className={css.nota}>
          {feri > 0 && <>O feriado trabalhado ({hhmm(feri)}) é verba própria 100%, paga à parte na folha — por isso fica fora do trabalhado e desta diferença. </>}
          {d.indenizMin > 0 && <>A indenização de intervalo é verba +50% e não entra no saldo. </>}
          A tolerância da Súmula 366 (5min por batida, teto 10min/dia) absorve pequenos desvios.
        </div>
      </div>
    </section>
  );
}
