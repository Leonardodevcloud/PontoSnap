import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ARTIGOS, artigoDaRota } from './artigos';
import css from './Ajuda.module.css';

interface Ctx { abrir: (slug: string, secao?: string) => void; fechar: () => void; aberto: string | null }
const AjudaCtx = createContext<Ctx>({ abrir: () => {}, fechar: () => {}, aberto: null });
export const useAjuda = () => useContext(AjudaCtx);

/**
 * Ajuda ao lado da tela: abre o artigo num painel à direita, sem sair do que
 * se está fazendo. Fica no LayoutRH (um só para todas as telas).
 */
export function ProvedorAjuda({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<{ slug: string; secao?: string } | null>(null);
  const abrir = useCallback((slug: string, secao?: string) => setEstado({ slug, secao }), []);
  const fechar = useCallback(() => setEstado(null), []);
  const { pathname } = useLocation();
  useEffect(() => { setEstado(null); }, [pathname]);
  const v = useMemo(() => ({ abrir, fechar, aberto: estado?.slug ?? null }), [abrir, fechar, estado]);
  return (
    <AjudaCtx.Provider value={v}>
      {children}
      {estado && <Painel slug={estado.slug} secao={estado.secao} onFechar={fechar} />}
    </AjudaCtx.Provider>
  );
}

function Painel({ slug, secao, onFechar }: { slug: string; secao?: string; onFechar: () => void }) {
  const a = ARTIGOS.find((x) => x.slug === slug);
  const ref = useRef<HTMLElement>(null);
  const voltar = useRef<HTMLElement | null>(null);
  useEffect(() => {
    voltar.current = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const alvo = secao ? ref.current?.querySelector<HTMLElement>(`#s-${secao}`) : null;
      if (alvo) alvo.scrollIntoView({ block: 'start' });
      ref.current?.focus();
    }, 30);
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    document.addEventListener('keydown', tecla);
    return () => { clearTimeout(t); document.removeEventListener('keydown', tecla); voltar.current?.focus?.(); };
  }, [slug, secao, onFechar]);
  if (!a) return null;
  const { Corpo } = a;
  return (
    <>
      <div className={css.painelVeu} onClick={onFechar} aria-hidden="true" />
      <aside ref={ref} className={css.painel} role="dialog" aria-modal="false" aria-labelledby="ajuda-tit" tabIndex={-1}>
        <div className={css.painelTopo}>
          <span className={css.painelTag}>Ajuda</span>
          <Link className={css.painelCheio} to={`/rh/ajuda/${a.slug}${secao ? `#s-${secao}` : ''}`} onClick={onFechar}>Abrir em tela cheia</Link>
          <button type="button" className={css.painelX} onClick={onFechar} aria-label="Fechar ajuda">✕</button>
        </div>
        <div className={css.painelCorpo}>
          <h2 id="ajuda-tit" className={css.painelH}>{a.titulo}</h2>
          <div className={css.artigo}><Corpo /></div>
        </div>
      </aside>
    </>
  );
}

/** "?" pequeno ao lado de um título: abre o artigo (e a seção) no painel. */
export function BotaoAjuda({ artigo, secao, rotulo }: { artigo: string; secao?: string; rotulo?: string }) {
  const { abrir } = useAjuda();
  const a = ARTIGOS.find((x) => x.slug === artigo);
  return (
    <button type="button" className={rotulo ? css.botaoAjudaTxt : css.botaoAjuda} onClick={(e) => { e.stopPropagation(); abrir(artigo, secao); }}
      aria-label={rotulo ? undefined : `Ajuda: ${a?.titulo ?? artigo}`} title={a?.titulo}>
      {rotulo ? <><span aria-hidden="true">?</span> {rotulo}</> : '?'}
    </button>
  );
}

/** Botão do topo de cada tela: abre o artigo daquela tela (se houver). */
export function AjudaDaTela() {
  const { pathname } = useLocation();
  const a = artigoDaRota(pathname);
  if (!a || pathname.startsWith('/rh/ajuda')) return null;
  return <BotaoAjuda artigo={a.slug} rotulo="Ajuda desta tela" />;
}
