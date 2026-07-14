import type { ButtonHTMLAttributes } from 'react';
import css from './Botao.module.css';

type Variante = 'coral' | 'lime' | 'ghost';
interface Props extends ButtonHTMLAttributes<HTMLButtonElement> { variante?: Variante; }

export function Botao({ variante = 'coral', className, ...rest }: Props) {
  return <button className={`${css.btn} ${css[variante]} ${className ?? ''}`} {...rest} />;
}
