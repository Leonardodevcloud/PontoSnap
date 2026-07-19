import { useEffect, useState } from 'react';
import { aoCarregar } from '../lib/api';
import css from './BarraProgresso.module.css';

/**
 * Barra fininha no topo que aparece enquanto há requisição em voo. Faz toda
 * transição de tela parecer intencional em vez de "travada" — some sozinha
 * quando o carregamento termina.
 */
export function BarraProgresso() {
  const [ativo, setAtivo] = useState(false);
  useEffect(() => aoCarregar(setAtivo), []);
  return (
    <div className={`${css.barra} ${ativo ? css.ativo : ''}`} aria-hidden="true">
      <div className={css.pulso} />
    </div>
  );
}
