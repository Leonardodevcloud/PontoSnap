import { SEM_CURTO, diaDaSemana } from '../lib/diasMotorista';
import css from './DiasChips.module.css';

/**
 * Um botão por dia da semana (dentro do mês). Marcado = trabalhou.
 * Feriado e dia fora da base aparecem com um rótulo, mas dá para marcar
 * (rodou no feriado, rodou no domingo).
 */
export function DiasChips({ dias, marcadas, previstos, disabled, rotulo, onMarcar }: {
  dias: string[]; marcadas: string[] | null; previstos: string[]; disabled?: boolean; rotulo: string; onMarcar: (dia: string) => void;
}) {
  const prev = new Set(previstos);
  return (
    <div className={css.chips} role="group" aria-label={rotulo}>
      {dias.map((d) => {
        const on = !!marcadas?.includes(d);
        const fora = !prev.has(d);
        return (
          <button key={d} type="button" className={`${css.chip} ${on ? css.on : ''} ${fora ? css.fora : ''}`} aria-pressed={on} disabled={disabled}
            title={fora ? 'Fora dos dias previstos (feriado ou dia fora da base). Marque se ele rodou.' : undefined}
            onClick={() => onMarcar(d)}>
            <b>{d.slice(8, 10)}</b><small>{SEM_CURTO[diaDaSemana(d)]}</small>
          </button>
        );
      })}
    </div>
  );
}
