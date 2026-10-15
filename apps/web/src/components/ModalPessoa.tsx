import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icone } from './Icone';
import css from './ModalPessoa.module.css';

export interface AbaModal { id: string; rotulo: string }

/**
 * Modal largo e centralizado de uma pessoa (substitui o painel lateral):
 * foto grande no topo para identificar, abas para separar o assunto, ações no
 * rodapé. Prende o foco, fecha no Esc ou clicando fora e devolve o foco a quem
 * abriu. No celular ocupa a tela inteira.
 */
export function ModalPessoa({ aberto, onFechar, foto, titulo, meta, chips, abas, aba, onAba, rodape, children, largura = 980, compacto }: {
  aberto: boolean; onFechar: () => void;
  foto?: ReactNode; titulo: string; meta?: ReactNode; chips?: ReactNode;
  abas?: AbaModal[]; aba?: string; onAba?: (id: string) => void;
  rodape?: ReactNode; children: ReactNode; largura?: number;
  /** Cabeçalho menor (ex.: um passo dentro do fluxo). */
  compacto?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const voltar = useRef<HTMLElement | null>(null);
  const fechar = useRef(onFechar);
  fechar.current = onFechar;

  useEffect(() => {
    if (!aberto) return;
    voltar.current = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>('[data-autofoco]')?.focus() ?? ref.current?.focus(), 30);
    const tecla = (e: KeyboardEvent) => {
      // Diálogo de confirmação aberto por cima: ele cuida do próprio Esc.
      if (document.querySelector('[data-dialogo]')) return;
      if (e.key === 'Escape') { e.stopPropagation(); fechar.current(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const f = [...ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
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
    <div className={css.veu} onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div className={css.modal} role="dialog" aria-modal="true" aria-labelledby="mp-titulo" ref={ref} tabIndex={-1} style={{ width: `min(${largura}px, 100%)` }}>
        <header className={`${css.topo} ${compacto ? css.compacto : ''}`}>
          {foto && <span className={css.foto}>{foto}</span>}
          <div className={css.tit}>
            <h2 id="mp-titulo">{titulo}</h2>
            {meta && <p>{meta}</p>}
            {chips && <div className={css.chips}>{chips}</div>}
          </div>
          <button type="button" className={css.x} onClick={onFechar} aria-label="Fechar"><Icone nome="x" /></button>
        </header>
        {abas && abas.length > 1 && (
          <div className={css.abas} role="tablist" aria-label="Seções">
            {abas.map((a) => (
              <button key={a.id} type="button" role="tab" aria-selected={a.id === aba} className={a.id === aba ? css.abaOn : ''} onClick={() => onAba?.(a.id)}>{a.rotulo}</button>
            ))}
          </div>
        )}
        <div className={css.corpo} role={abas ? 'tabpanel' : undefined}>{children}</div>
        {rodape && <footer className={css.rodape}>{rodape}</footer>}
      </div>
    </div>,
    document.body,
  );
}
