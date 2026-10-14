import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { embedDoVideo } from '@ponto/shared';
import { mmss, miniaturaVideo, tamanho, urlDaMidia, useMidia, type Bloco } from '../../lib/comunicacao';
import css from './ComunicadoView.module.css';

/** Monta o caminho da mídia: RH usa /comunicacao/midia, o app /comunicacao/meus/midia. */
export type CaminhoMidia = (id: string, mini?: boolean) => string;

// ───────── texto com **negrito**, *itálico*, listas e links ─────────
function inline(t: string, k: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|https?:\/\/[^\s)]+)/g;
  let ult = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(t))) {
    if (m.index > ult) out.push(t.slice(ult, m.index));
    const s = m[0];
    if (s.startsWith('**')) out.push(<strong key={`${k}b${i}`}>{s.slice(2, -2)}</strong>);
    else if (s.startsWith('*')) out.push(<em key={`${k}i${i}`}>{s.slice(1, -1)}</em>);
    else out.push(<a key={`${k}a${i}`} href={s} target="_blank" rel="noopener noreferrer">{s.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)}</a>);
    ult = m.index + s.length; i++;
  }
  if (ult < t.length) out.push(t.slice(ult));
  return out;
}
export function TextoFormatado({ texto }: { texto: string }) {
  const grupos: { lista: boolean; linhas: string[] }[] = [];
  for (const l of texto.split('\n')) {
    const lista = /^\s*[-•]\s+/.test(l);
    const g = grupos.at(-1);
    if (!l.trim()) { grupos.push({ lista: false, linhas: [] }); continue; }
    if (g && g.lista === lista && (lista || g.linhas.length)) g.linhas.push(lista ? l.replace(/^\s*[-•]\s+/, '') : l);
    else grupos.push({ lista, linhas: [lista ? l.replace(/^\s*[-•]\s+/, '') : l] });
  }
  return (
    <div className={css.texto}>
      {grupos.filter((g) => g.linhas.length).map((g, gi) => (g.lista
        ? <ul key={gi}>{g.linhas.map((l, li) => <li key={li}>{inline(l, `${gi}-${li}`)}</li>)}</ul>
        : <p key={gi}>{g.linhas.map((l, li) => <Fragment key={li}>{li > 0 && <br />}{inline(l, `${gi}-${li}`)}</Fragment>)}</p>))}
    </div>
  );
}

// ───────── vídeo: miniatura com play → player embutido ─────────
export function VideoEmbed({ bloco, onPlay, compacto }: { bloco: Extract<Bloco, { tipo: 'VIDEO' }>; onPlay?: () => void; compacto?: boolean }) {
  const [tocando, setTocando] = useState(false);
  const [semMini, setSemMini] = useState(false);
  const mini = semMini ? null : miniaturaVideo(bloco);
  const nomeProv = bloco.provedor === 'YOUTUBE' ? 'YouTube' : bloco.provedor === 'VIMEO' ? 'Vimeo' : 'Google Drive';
  if (tocando) {
    const src = embedDoVideo(bloco.provedor, bloco.videoId) + (bloco.provedor === 'DRIVE' ? '' : '&autoplay=1');
    return (
      <div className={css.video}>
        <iframe src={src} title={bloco.titulo ?? `Vídeo do ${nomeProv}`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
      </div>
    );
  }
  return (
    <button type="button" className={`${css.video} ${css.videoCapa}`} onClick={(e) => { e.stopPropagation(); setTocando(true); onPlay?.(); }}
      aria-label={`Assistir: ${bloco.titulo ?? 'vídeo'}`}>
      {mini ? <img src={mini} alt="" loading="lazy" onError={() => setSemMini(true)} /> : <span className={css.videoFundo} />}
      {!compacto && bloco.titulo && <span className={css.videoTitulo}>{bloco.titulo}</span>}
      <span className={bloco.provedor === 'YOUTUBE' ? css.playYt : css.play} aria-hidden="true" />
      <span className={css.videoProv}>{nomeProv}</span>
    </button>
  );
}

// ───────── fotos: grade + tela cheia ─────────
function Foto({ caminho, className, alt = '' }: { caminho: string; className?: string; alt?: string }) {
  const { url, erro } = useMidia(caminho);
  return url ? <img src={url} alt={alt} className={className} loading="lazy" /> : <span className={`${className ?? ''} ${css.fotoVazia}`}>{erro ? '!' : ''}</span>;
}

/** Grade de fotos. `estatica` = só mostra (o toque vai para quem está por fora, ex.: o cartão da lista). */
export function Galeria({ midias, caminho, max = 4, total, estatica }: { midias: string[]; caminho: CaminhoMidia; max?: number; total?: number; estatica?: boolean }) {
  const [aberta, setAberta] = useState<number | null>(null);
  const vis = midias.slice(0, max);
  const resto = (total ?? midias.length) - vis.length;
  if (estatica) {
    return (
      <div className={`${css.galeria} ${css[`g${Math.min(vis.length, 4)}`]}`} aria-hidden="true">
        {vis.map((m, i) => (
          <span key={m} className={css.gFoto} style={{ cursor: 'inherit' }}>
            <Foto caminho={caminho(m, true)} />
            {i === vis.length - 1 && resto > 0 && <span className={css.gMais}>+{resto}</span>}
          </span>
        ))}
      </div>
    );
  }
  return (
    <>
      <div className={`${css.galeria} ${css[`g${Math.min(vis.length, 4)}`]}`}>
        {vis.map((m, i) => (
          <button type="button" key={m} className={css.gFoto} onClick={(e) => { e.stopPropagation(); setAberta(i); }} aria-label={`Ver foto ${i + 1} de ${midias.length}`}>
            <Foto caminho={caminho(m, true)} />
            {i === vis.length - 1 && resto > 0 && <span className={css.gMais}>+{resto}</span>}
          </button>
        ))}
      </div>
      {aberta != null && <TelaCheia midias={midias} caminho={caminho} inicial={aberta} onFechar={() => setAberta(null)} />}
    </>
  );
}

function TelaCheia({ midias, caminho, inicial, onFechar }: { midias: string[]; caminho: CaminhoMidia; inicial: number; onFechar: () => void }) {
  const [i, setI] = useState(inicial);
  const toque = useRef<number | null>(null);
  const fechar = useRef(onFechar); fechar.current = onFechar;
  const btn = useRef<HTMLButtonElement>(null);
  const ir = useCallback((d: number) => setI((x) => (x + d + midias.length) % midias.length), [midias.length]);
  useEffect(() => {
    const voltar = document.activeElement as HTMLElement | null;
    btn.current?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar.current();
      else if (e.key === 'ArrowRight') ir(1);
      else if (e.key === 'ArrowLeft') ir(-1);
    };
    document.addEventListener('keydown', k);
    const ov = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = ov; voltar?.focus(); };
  }, [ir]);
  return (
    <div className={css.cheia} role="dialog" aria-modal="true" aria-label={`Foto ${i + 1} de ${midias.length}`} onClick={() => fechar.current()}
      onTouchStart={(e) => { toque.current = e.touches[0]!.clientX; }}
      onTouchEnd={(e) => { if (toque.current == null) return; const d = e.changedTouches[0]!.clientX - toque.current; if (Math.abs(d) > 50) ir(d < 0 ? 1 : -1); toque.current = null; }}>
      <button ref={btn} type="button" className={css.cheiaX} onClick={() => fechar.current()} aria-label="Fechar">×</button>
      <div onClick={(e) => e.stopPropagation()} className={css.cheiaImg}><Foto caminho={caminho(midias[i]!)} alt={`Foto ${i + 1}`} /></div>
      {midias.length > 1 && <>
        <button type="button" className={`${css.cheiaNav} ${css.ant}`} onClick={(e) => { e.stopPropagation(); ir(-1); }} aria-label="Foto anterior">‹</button>
        <button type="button" className={`${css.cheiaNav} ${css.prox}`} onClick={(e) => { e.stopPropagation(); ir(1); }} aria-label="Próxima foto">›</button>
        <span className={css.cheiaCont}>{i + 1} / {midias.length}</span>
      </>}
    </div>
  );
}

// ───────── áudio: onda, velocidade, continua de onde parou ─────────
const VELS = [1, 1.5, 2];
export function PlayerAudio({ caminho, duracaoSeg, picos, onOuvir }: { caminho: string; duracaoSeg: number; picos: number[]; onOuvir?: () => void }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [tocando, setTocando] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(duracaoSeg);
  const [vel, setVel] = useState(1);
  const [erro, setErro] = useState(false);
  const ouviu = useRef(false);
  const chave = `pontosnap.audio.${caminho}`;
  const ouvir = useRef(onOuvir); ouvir.current = onOuvir;

  useEffect(() => {
    try { const s = Number(localStorage.getItem(chave)); if (s > 0) setPos(s); } catch { /* sem storage */ }
    return () => { audio.current?.pause(); };
  }, [chave]);

  async function alternar(e: React.MouseEvent) {
    e.stopPropagation();
    if (audio.current && tocando) { audio.current.pause(); return; }
    if (!audio.current) {
      setCarregando(true);
      try {
        const a = new Audio(await urlDaMidia(caminho));
        a.playbackRate = vel;
        a.ontimeupdate = () => {
          setPos(a.currentTime);
          try { localStorage.setItem(chave, String(Math.floor(a.currentTime))); } catch { /* sem storage */ }
          const d = Number.isFinite(a.duration) ? a.duration : dur;
          if (!ouviu.current && d > 0 && a.currentTime / d >= 0.5) { ouviu.current = true; ouvir.current?.(); }
        };
        a.onloadedmetadata = () => { if (Number.isFinite(a.duration) && a.duration > 0) setDur(a.duration); if (pos > 0 && pos < a.duration - 1) a.currentTime = pos; };
        a.onplay = () => setTocando(true);
        a.onpause = () => setTocando(false);
        a.onended = () => {
          setTocando(false); setPos(0);
          try { localStorage.removeItem(chave); } catch { /* sem storage */ }
          if (!ouviu.current) { ouviu.current = true; ouvir.current?.(); }
        };
        a.onerror = () => { setErro(true); setTocando(false); };
        audio.current = a;
      } catch { setErro(true); setCarregando(false); return; }
      setCarregando(false);
    }
    try { await audio.current.play(); } catch { setErro(true); }
  }
  function buscar(e: React.MouseEvent<HTMLDivElement>) {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const alvo = ((e.clientX - r.left) / r.width) * (dur || 1);
    setPos(alvo);
    if (audio.current) audio.current.currentTime = alvo;
  }
  function trocarVel(e: React.MouseEvent) {
    e.stopPropagation();
    const v = VELS[(VELS.indexOf(vel) + 1) % VELS.length]!;
    setVel(v);
    if (audio.current) audio.current.playbackRate = v;
  }
  const frac = dur > 0 ? pos / dur : 0;
  const barras = picos.length ? picos : Array.from({ length: 40 }, () => 40);
  return (
    <div className={css.audio} onClick={(e) => e.stopPropagation()}>
      <button type="button" className={`${css.aBtn} ${tocando ? css.pausa : ''}`} onClick={alternar} disabled={carregando}
        aria-label={tocando ? 'Pausar áudio' : 'Ouvir áudio'}>{carregando && <span className={css.giro} />}</button>
      <div className={css.onda} onClick={buscar} role="slider" tabIndex={0} aria-label="Posição do áudio"
        aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(pos)} aria-valuetext={`${mmss(pos)} de ${mmss(dur)}`}
        onKeyDown={(e) => {
          if (!audio.current) return;
          if (e.key === 'ArrowRight') audio.current.currentTime = Math.min(dur, audio.current.currentTime + 5);
          if (e.key === 'ArrowLeft') audio.current.currentTime = Math.max(0, audio.current.currentTime - 5);
        }}>
        {barras.map((v, i) => <i key={i} className={i / barras.length < frac ? css.ja : ''} style={{ height: `${Math.max(10, v)}%` }} />)}
      </div>
      <span className={css.aTempo}>{erro ? 'erro' : mmss(tocando || pos > 0 ? pos : dur)}</span>
      <button type="button" className={css.vel} onClick={trocarVel} aria-label={`Velocidade ${vel}×`}>{String(vel).replace('.', ',')}×</button>
    </div>
  );
}

// ───────── PDF ─────────
export function ArquivoPdf({ caminho, nome, bytes }: { caminho: string; nome: string; bytes: number }) {
  const [abrindo, setAbrindo] = useState(false);
  async function abrir(e: React.MouseEvent) {
    e.stopPropagation();
    setAbrindo(true);
    try {
      const url = await urlDaMidia(caminho);
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.download = nome;
      a.click();
    } finally { setAbrindo(false); }
  }
  return (
    <button type="button" className={css.arquivo} onClick={abrir} disabled={abrindo}>
      <span className={css.arqIc} aria-hidden="true">PDF</span>
      <span className={css.arqTxt}><b>{nome}</b><small>{abrindo ? 'Abrindo…' : `${tamanho(bytes)} · toque para abrir`}</small></span>
    </button>
  );
}

/** O comunicado inteiro, na ordem em que o RH montou. */
export function ComunicadoView({ blocos, caminho, onMidia }: { blocos: Bloco[]; caminho: CaminhoMidia; onMidia?: () => void }) {
  return (
    <div className={css.blocos}>
      {blocos.map((b, i) => {
        switch (b.tipo) {
          case 'TEXTO': return <TextoFormatado key={i} texto={b.texto} />;
          case 'VIDEO': return <VideoEmbed key={i} bloco={b} onPlay={onMidia} />;
          case 'FOTOS': return <Galeria key={i} midias={b.midias} caminho={caminho} />;
          case 'AUDIO': return <PlayerAudio key={i} caminho={caminho(b.midiaId)} duracaoSeg={b.duracaoSeg} picos={b.picos} onOuvir={onMidia} />;
          case 'ARQUIVO': return <ArquivoPdf key={i} caminho={caminho(b.midiaId)} nome={b.nome} bytes={b.bytes} />;
          default: return null;
        }
      })}
    </div>
  );
}
