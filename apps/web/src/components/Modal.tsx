import type { ReactNode } from 'react';
import css from './Modal.module.css';

interface Props { titulo: string; onFechar: () => void; children: ReactNode; }

export function Modal({ titulo, onFechar, children }: Props) {
  return (
    <div className={css.overlay} onClick={onFechar}>
      <div className={css.card} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className={css.head}>
          <h3>{titulo}</h3>
          <button className={css.x} onClick={onFechar} aria-label="Fechar">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
