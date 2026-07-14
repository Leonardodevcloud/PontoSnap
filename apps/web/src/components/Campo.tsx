import type { InputHTMLAttributes } from 'react';
import css from './Campo.module.css';

interface Props extends InputHTMLAttributes<HTMLInputElement> { rotulo: string; }

export function Campo({ rotulo, id, ...rest }: Props) {
  const campoId = id ?? rotulo.toLowerCase().replace(/\s+/g, '-');
  return (
    <label className={css.campo} htmlFor={campoId}>
      <span className={css.rotulo}>{rotulo}</span>
      <input id={campoId} className={css.input} {...rest} />
    </label>
  );
}
