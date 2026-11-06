import type { Vinculo } from '../lib/vinculos';
import { empresaCurta, periodoVinculo } from '../lib/vinculos';
import css from './GrupoEmpresa.module.css';

/** Cabeçalho de grupo por empresa (app do funcionário transferido no grupo). */
export function GrupoEmpresa({ v }: { v: Vinculo }) {
  const p = periodoVinculo(v);
  return (
    <div className={css.grupo}>
      <b>{empresaCurta(v.empresa)}<span className={`${css.etiqueta} ${v.atual ? css.etiquetaAtual : ''}`}>{v.atual ? 'atual' : 'anterior'}</span></b>
      {p && <small>{p}</small>}
    </div>
  );
}
