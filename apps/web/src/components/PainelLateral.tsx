import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icone } from './Icone';
import css from './PainelLateral.module.css';

/**
 * Painel que entra pela direita (slide-over). Prende o foco enquanto aberto,
 * fecha no Esc ou clicando fora, e devolve o foco para quem abriu.
 */
export function PainelLateral({ titulo, subtitulo, aberto, onFechar, children, rodape, largura = 460 }: {
  titulo: string; subtitulo?: ReactNode; aberto: boolean; onFechar: () => void;
  children: ReactNode; rodape?: ReactNode; largura?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const voltar = useRef<HTMLElement | null>(null);
  const fechar = useRef(onFechar);
  fechar.current = onFechar;

  useEffect(() => {
    if (!aberto) return;
    voltar.current = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const alvo = ref.current?.querySelector<HTMLElement>('input, select, textarea, [data-autofoco]')
        ?? ref.current?.querySelector<HTMLElement>('button');
      alvo?.focus();
    }, 30);
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); fechar.current(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const f = [...ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')];
      if (f.length === 0) return;
      const pri = f[0]!, ult = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === pri) { e.preventDefault(); ult.focus(); }
      else if (!e.shiftKey && document.activeElement === ult) { e.preventDefault(); pri.focus(); }
    };
    document.addEventListener('keydown', tecla);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', tecla);
      document.body.style.overflow = overflow;
      voltar.current?.focus?.();
    };
  }, [aberto]);

  if (!aberto) return null;
  return createPortal(
    <>
      <div className={css.veu} onClick={onFechar} />
      <div className={css.painel} role="dialog" aria-modal="true" aria-label={titulo} ref={ref} style={{ width: `min(${largura}px, 100%)` }}>
        <div className={css.topo}>
          <div className={css.tit}>
            <h2>{titulo}</h2>
            {subtitulo && <p>{subtitulo}</p>}
          </div>
          <button className={css.x} onClick={onFechar} aria-label="Fechar"><Icone nome="x" /></button>
        </div>
        <div className={css.corpo}>{children}</div>
        {rodape && <div className={css.rodape}>{rodape}</div>}
      </div>
    </>,
    document.body,
  );
}
