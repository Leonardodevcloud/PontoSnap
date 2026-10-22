import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'unpdf/pdfjs';
import css from './VisorNota.module.css';

/** O arquivo da nota: PDF (desenhado na tela), imagem ou XML. */
export type FonteNota =
  | { tipo: 'pdf'; dados: ArrayBuffer; url: string }
  | { tipo: 'img'; url: string }
  | { tipo: 'xml'; texto: string };

const PASSOS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
type Zoom = number | 'LARGURA';

/** pdf.js (o mesmo que a API usa para ler a nota) só carrega quando abre um PDF. */
const abrirPdf = async (dados: ArrayBuffer) => (await import('unpdf')).getDocumentProxy(new Uint8Array(dados.slice(0)));

/**
 * Visor da nota para conferir: zoom (+/−, ajustar à largura, Ctrl+roda),
 * arrastar para mover, girar e abrir em outra aba. Atalhos: + − 0.
 */
export function VisorNota({ fonte, titulo, ampliado, onAmpliar }: {
  fonte: FonteNota | null; titulo: string; ampliado?: boolean; onAmpliar?: () => void;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<Zoom>('LARGURA');
  const [giro, setGiro] = useState(0);
  const [largura, setLargura] = useState(0);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [tamPag, setTamPag] = useState<{ w: number; h: number }[]>([]);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Arquivo novo: volta para "ajustar à largura".
  useEffect(() => { setZoom('LARGURA'); setGiro(0); setNatural(null); setErro(null); caixa.current?.scrollTo(0, 0); }, [fonte]);

  // Largura útil (para ajustar).
  useEffect(() => {
    const el = caixa.current; if (!el) return;
    const ro = new ResizeObserver(() => setLargura(el.clientWidth));
    ro.observe(el); setLargura(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Abre o PDF.
  useEffect(() => {
    setDoc(null); setTamPag([]);
    if (fonte?.tipo !== 'pdf') return;
    let vivo = true; let aberto: PDFDocumentProxy | null = null;
    abrirPdf(fonte.dados).then(async (d) => {
      aberto = d;
      const t: { w: number; h: number }[] = [];
      for (let i = 1; i <= d.numPages; i++) { const v = (await d.getPage(i)).getViewport({ scale: 1 }); t.push({ w: v.width, h: v.height }); }
      if (vivo) { setDoc(d); setTamPag(t); } else void d.destroy();
    }).catch(() => vivo && setErro('Não consegui abrir este PDF aqui. Use "Abrir em outra aba".'));
    return () => { vivo = false; void aberto?.destroy(); };
  }, [fonte]);

  const deitado = giro % 180 !== 0;
  const baseW = fonte?.tipo === 'pdf' ? Math.max(1, ...tamPag.map((p) => (deitado ? p.h : p.w))) : natural ? (deitado ? natural.h : natural.w) : 1;
  const escalaAjuste = largura > 0 ? Math.max(0.2, (largura - 32) / baseW) : 1;
  const escala = zoom === 'LARGURA' ? escalaAjuste : zoom;

  const mudarZoom = useCallback((dir: 1 | -1) => {
    setZoom((z) => {
      const atual = z === 'LARGURA' ? escalaAjuste : z;
      const prox = dir > 0 ? PASSOS.find((p) => p > atual + 0.01) : [...PASSOS].reverse().find((p) => p < atual - 0.01);
      return prox ?? atual;
    });
  }, [escalaAjuste]);

  // Atalhos + − 0 (fora de campos de texto).
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName) || e.metaKey || e.ctrlKey || e.altKey || !fonte) return;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); mudarZoom(1); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); mudarZoom(-1); }
      else if (e.key === '0') { e.preventDefault(); setZoom('LARGURA'); }
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [fonte, mudarZoom]);

  // Ctrl + roda do mouse: zoom (sem dar zoom na página inteira).
  useEffect(() => {
    const el = caixa.current; if (!el) return;
    const roda = (e: WheelEvent) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); mudarZoom(e.deltaY < 0 ? 1 : -1); };
    el.addEventListener('wheel', roda, { passive: false });
    return () => el.removeEventListener('wheel', roda);
  }, [mudarZoom]);

  // Arrastar para mover (quando a nota é maior que o visor).
  const arraste = useRef<{ x: number; y: number; l: number; t: number } | null>(null);
  const [arrastando, setArrastando] = useState(false);
  function inicio(e: RPointerEvent<HTMLDivElement>) {
    const el = caixa.current; if (!el || e.button !== 0 || fonte?.tipo === 'xml') return;
    if (el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight) return;
    arraste.current = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop };
    el.setPointerCapture(e.pointerId); setArrastando(true);
  }
  function move(e: RPointerEvent<HTMLDivElement>) {
    const a = arraste.current, el = caixa.current; if (!a || !el) return;
    el.scrollLeft = a.l - (e.clientX - a.x); el.scrollTop = a.t - (e.clientY - a.y);
  }
  function fim() { arraste.current = null; setArrastando(false); }

  const abrirUrl = fonte?.tipo === 'pdf' || fonte?.tipo === 'img' ? fonte.url : null;
  const pct = Math.round(escala * 100);

  return (
    <div className={`${css.visor} ${ampliado ? css.ampliado : ''}`}>
      <div className={css.barra} role="toolbar" aria-label="Zoom da nota">
        <button type="button" onClick={() => mudarZoom(-1)} disabled={!fonte} aria-label="Diminuir zoom" title="Diminuir (−)">−</button>
        <span className={css.pct} aria-live="polite">{fonte ? `${pct}%` : '—'}</span>
        <button type="button" onClick={() => mudarZoom(1)} disabled={!fonte} aria-label="Aumentar zoom" title="Aumentar (+)">+</button>
        <button type="button" className={zoom === 'LARGURA' ? css.on : ''} onClick={() => setZoom('LARGURA')} disabled={!fonte} title="Ajustar à largura (0)">Ajustar</button>
        <button type="button" onClick={() => setZoom(2)} disabled={!fonte} title="Ver de perto (200%)">200%</button>
        {fonte?.tipo !== 'xml' && <button type="button" onClick={() => setGiro((g) => (g + 90) % 360)} disabled={!fonte} aria-label="Girar" title="Girar 90°">⟳</button>}
        <span className={css.esp} />
        {abrirUrl && <a href={abrirUrl} target="_blank" rel="noopener noreferrer" title="Abrir em outra aba" aria-label="Abrir em outra aba">↗</a>}
        {onAmpliar && <button type="button" className={ampliado ? css.on : ''} onClick={onAmpliar} aria-pressed={!!ampliado} title="Ampliar o visor (F)">{ampliado ? '⤡ Reduzir' : '⤢ Ampliar'}</button>}
      </div>
      <div ref={caixa} className={`${css.caixa} ${arrastando ? css.arrastando : ''}`} tabIndex={0} aria-label={titulo}
        onPointerDown={inicio} onPointerMove={move} onPointerUp={fim} onPointerCancel={fim}>
        {!fonte ? <p className={css.msg}>Carregando…</p>
          : erro ? <p className={css.msg}>{erro}</p>
          : fonte.tipo === 'xml' ? <pre className={css.xml} style={{ fontSize: `${Math.max(9, Math.round(12 * (zoom === 'LARGURA' ? 1 : zoom)))}px` }}>{fonte.texto}</pre>
          : fonte.tipo === 'img' ? (
            <div className={css.folha} style={{ width: natural ? (deitado ? natural.h : natural.w) * escala : undefined, height: natural ? (deitado ? natural.w : natural.h) * escala : undefined }}>
              <img src={fonte.url} alt={titulo} draggable={false} onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                style={natural ? { width: natural.w * escala, height: natural.h * escala, transform: `translate(-50%, -50%) rotate(${giro}deg)` } : { maxWidth: '100%' }}
                className={natural ? css.imgGirada : undefined} />
            </div>
          )
          : !doc ? <p className={css.msg}>Abrindo o PDF…</p>
          : tamPag.map((_, i) => <PaginaPdf key={i} doc={doc} n={i + 1} escala={escala} giro={giro} />)}
      </div>
    </div>
  );
}

function PaginaPdf({ doc, n, escala, giro }: { doc: PDFDocumentProxy; n: number; escala: number; giro: number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const [tam, setTam] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    let tarefa: RenderTask | null = null; let vivo = true;
    // Espera o zoom "assentar" antes de redesenhar (Ctrl+roda dispara vários).
    const t = setTimeout(async () => {
      const pag = await doc.getPage(n);
      if (!vivo || !cv.current) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const v = pag.getViewport({ scale: escala * dpr, rotation: giro });
      const c = cv.current;
      c.width = Math.floor(v.width); c.height = Math.floor(v.height);
      setTam({ w: v.width / dpr, h: v.height / dpr });
      tarefa = pag.render({ canvas: c, viewport: v });
      await tarefa.promise.catch(() => undefined);
    }, 60);
    return () => { vivo = false; clearTimeout(t); tarefa?.cancel(); };
  }, [doc, n, escala, giro]);
  return <canvas ref={cv} className={css.pagina} style={tam ? { width: tam.w, height: tam.h } : undefined} aria-label={`Página ${n}`} />;
}
