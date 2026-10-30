import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import css from './Explica.module.css';

/**
 * Botão "?" que abre uma explicação curta por cima da tela.
 * Serve para tirar textos longos da frente sem esconder a informação.
 */
export function Explica({ children, rotulo = 'O que é isso?', lado = 'esq' }: { children: ReactNode; rotulo?: string; lado?: 'esq' | 'dir' }) {
  const [aberto, setAberto] = useState(false);
  const id = useId();
  const raiz = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!raiz.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);

  return (
    <span className={css.raiz} ref={raiz}>
      <button type="button" className={css.btn} aria-label={rotulo} aria-expanded={aberto} aria-controls={id} onClick={() => setAberto((a) => !a)}>?</button>
      {aberto && <span id={id} role="note" className={`${css.balao} ${lado === 'dir' ? css.dir : ''}`}>{children}</span>}
    </span>
  );
}
