import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { Orbe, type EstadoOrbe } from './Orbe';
import { Gravador, blobParaBase64, falar, pararFala, nivelDaFala } from './voz';
import css from './EsferaArgos.module.css';

interface Status { ativo: boolean; voz: boolean; fala: boolean }
interface Resposta { resposta: string; fala?: string; fontes: string[]; pessoa: string | null; empregadoId: string | null; mes: string }
interface Turno { q: string; a: string; fontes: string[]; pessoa: string | null; pendente?: boolean }

type Fase = 'pronto' | 'ouvindo' | 'transcrevendo' | 'pensando' | 'falando' | 'erro';

const CHAVE_MUDO = 'pontosnap:argos-mudo';
const lerMudo = () => { try { return localStorage.getItem(CHAVE_MUDO) === '1'; } catch { return false; } };

const ESTADO: Record<Fase, EstadoOrbe> = {
  pronto: 'parado', ouvindo: 'ouvindo', transcrevendo: 'pensando', pensando: 'pensando', falando: 'falando', erro: 'erro',
};
const ROTULO: Record<Fase, string> = {
  pronto: 'Segure espaço e fale, ou digite', ouvindo: 'Ouvindo…', transcrevendo: 'Entendendo…',
  pensando: 'Lendo a apuração e as regras…', falando: 'Respondendo…', erro: 'Algo deu errado',
};

/** Impede o atalho de Espaço de roubar o foco de campos e botões. */
function ocupado(alvo: EventTarget | null): boolean {
  const el = alvo as HTMLElement | null;
  return !!el?.closest?.('input, textarea, select, button, a, [contenteditable="true"], [role="button"], [role="textbox"]');
}

/** Argos: a esfera no canto da tela. Segure espaço (ou clique na esfera) e fale; pergunta livre. */
export function EsferaArgos() {
  const [status, setStatus] = useState<Status | null>(null);
  const [aberto, setAberto] = useState(false);
  const [fase, setFase] = useState<Fase>('pronto');
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [texto, setTexto] = useState('');
  const [mudo, setMudo] = useState(lerMudo);
  const [movimento] = useState(() => typeof window !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const faseRef = useRef(fase); faseRef.current = fase;
  const turnosRef = useRef(turnos); turnosRef.current = turnos;
  const mudoRef = useRef(mudo); mudoRef.current = mudo;
  const statusRef = useRef(status); statusRef.current = status;
  const gravadorRef = useRef<Gravador | null>(null);
  const vigiaRef = useRef(0);
  const pressRef = useRef(0);
  const fimRef = useRef<HTMLDivElement>(null);

  useEffect(() => { api.get<Status>('/argos/status').then(setStatus).catch(() => setStatus({ ativo: false, voz: false, fala: false })); }, []);
  useEffect(() => { if (aberto) fimRef.current?.scrollIntoView({ behavior: movimento ? 'smooth' : 'auto' }); }, [turnos, fase, aberto, movimento]);

  const nivel = useCallback(() => {
    const f = faseRef.current;
    if (f === 'ouvindo') return gravadorRef.current?.nivel() ?? 0;
    if (f === 'falando') return nivelDaFala();
    return 0;
  }, []);

  const perguntarTexto = useCallback(async (q: string) => {
    setFase('pensando');
    const historico = turnosRef.current.filter((t) => !t.pendente).slice(-4).map((t) => ({ pergunta: t.q, resposta: t.a }));
    setTurnos((ts) => [...ts, { q, a: '', fontes: [], pessoa: null, pendente: true }]);
    try {
      const r = await api.post<Resposta>('/argos/perguntar', { pergunta: q, historico });
      setTurnos((ts) => ts.map((t, i) => (i === ts.length - 1 ? { q, a: r.resposta, fontes: r.fontes, pessoa: r.pessoa } : t)));
      if (!mudoRef.current) { setFase('falando'); await falar((r.fala || r.resposta).trim(), !!statusRef.current?.fala, () => { if (faseRef.current === 'falando') setFase('pronto'); }); }
      else setFase('pronto');
    } catch (e) {
      const msg = (e as Error).message || 'Não consegui responder agora.';
      setTurnos((ts) => ts.map((t, i) => (i === ts.length - 1 ? { q, a: msg, fontes: [], pessoa: null } : t)));
      setFase('pronto');
    }
  }, []);

  const pararEescutar = useCallback(async () => {
    window.clearInterval(vigiaRef.current); vigiaRef.current = 0;
    const g = gravadorRef.current; gravadorRef.current = null;
    if (!g) { setFase('pronto'); return; }
    const falou = g.falou;
    const { blob, mime } = await g.parar();
    if (!falou || blob.size < 1200) { setFase('pronto'); return; }
    setFase('transcrevendo');
    try {
      const audioBase64 = await blobParaBase64(blob);
      const { texto: t } = await api.post<{ texto: string }>('/argos/transcrever', { audioBase64, mime });
      const q = (t || '').trim();
      if (!q) { setFase('pronto'); return; }
      await perguntarTexto(q);
    } catch {
      setFase('erro'); setTimeout(() => { if (faseRef.current === 'erro') setFase('pronto'); }, 2400);
    }
  }, [perguntarTexto]);

  const escutar = useCallback(async (continuo: boolean) => {
    if (!Gravador.suportado() || gravadorRef.current) return;
    pararFala();
    const g = new Gravador(); gravadorRef.current = g;
    setFase('ouvindo');
    try { await g.iniciar(); } catch { gravadorRef.current = null; setFase('erro'); setTimeout(() => { if (faseRef.current === 'erro') setFase('pronto'); }, 2400); return; }
    if (continuo) {
      vigiaRef.current = window.setInterval(() => {
        const gg = gravadorRef.current; if (!gg) return;
        if ((gg.falou && gg.silencioMs() > 1000) || gg.silencioMs() > 15000) void pararEescutar();
      }, 150);
    }
  }, [pararEescutar]);

  // Barra de espaço: segure e fale, solte para enviar. Em qualquer tela.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || ocupado(e.target)) return;
      e.preventDefault();
      setAberto(true);
      if (faseRef.current === 'falando') pararFala();
      if (!gravadorRef.current) { pressRef.current = performance.now(); void escutar(false); }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !pressRef.current) return;
      pressRef.current = 0;
      if (gravadorRef.current) void pararEescutar();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [escutar, pararEescutar]);

  useEffect(() => () => { gravadorRef.current?.cancelar(); pararFala(); window.clearInterval(vigiaRef.current); }, []);

  function tocarOrbe() {
    if (fase === 'ouvindo') { void pararEescutar(); return; }
    if (fase === 'transcrevendo' || fase === 'pensando') return;
    void escutar(true);
  }

  function enviarTexto() {
    const q = texto.trim(); if (!q) return;
    setTexto(''); setAberto(true);
    void perguntarTexto(q);
  }

  function alternarMudo() {
    const n = !mudo; setMudo(n);
    try { localStorage.setItem(CHAVE_MUDO, n ? '1' : '0'); } catch { /* ignore */ }
    if (n) { pararFala(); if (faseRef.current === 'falando') setFase('pronto'); }
  }

  if (!aberto) {
    return (
      <button className={css.bolha} onClick={() => { setAberto(true); void escutar(true); }} aria-label="Falar com o Argos (segure espaço)">
        <Orbe estado="parado" nivel={nivel} tamanho={48} movimento={movimento} />
      </button>
    );
  }

  const ouvindo = fase === 'ouvindo';
  return (
    <div className={css.painel} role="dialog" aria-label="Argos">
      <header className={css.cab}>
        <span className={css.tit}><b>Argos</b><small>{ROTULO[fase]}</small></span>
        <button className={css.icone} onClick={alternarMudo} aria-pressed={mudo} title={mudo ? 'Ligar a voz' : 'Silenciar'}>{mudo ? '🔇' : '🔊'}</button>
        {turnos.length > 0 && <button className={css.icone} onClick={() => { setTurnos([]); setFase('pronto'); }} title="Nova conversa">↺</button>}
        <button className={css.icone} onClick={() => { pararFala(); gravadorRef.current?.cancelar(); gravadorRef.current = null; setFase('pronto'); setAberto(false); }} title="Fechar">✕</button>
      </header>

      {status?.ativo === false && <div className={css.aviso}>Falta a chave <b>DEEPSEEK_CHAVE</b> na API para o Argos responder.</div>}

      <div className={css.corpo}>
        <button className={css.palco} onClick={tocarOrbe} aria-label={ouvindo ? 'Parar e enviar' : 'Falar'}>
          <Orbe estado={ESTADO[fase]} nivel={nivel} tamanho={148} movimento={movimento} />
        </button>
        {turnos.length === 0 && (fase === 'pronto' || fase === 'ouvindo') && (
          <p className={css.dica}>{fase === 'ouvindo' ? 'Pode falar…' : 'Pergunte livremente: “por que a Bianca ficou com essas horas extras em outubro?”. Ele entende a pessoa e o mês pela frase.'}</p>
        )}
        {turnos.map((t, i) => (
          <div key={i} className={css.turno}>
            <div className={css.pergunta}>{t.q}</div>
            {t.pendente ? <div className={css.pensando}>…</div> : (
              <div className={css.resposta}>
                {t.pessoa && <div className={css.sobre}>sobre {t.pessoa}</div>}
                {t.a.split('\n').filter(Boolean).map((p, j) => <p key={j}>{p}</p>)}
                {t.fontes.length > 0 && <div className={css.fontes}>{t.fontes.map((f) => <span key={f}>{f}</span>)}</div>}
              </div>
            )}
          </div>
        ))}
        <div ref={fimRef} />
      </div>

      <div className={css.barra}>
        <button className={`${css.mic} ${ouvindo ? css.micOn : ''}`} onClick={tocarOrbe} aria-label={ouvindo ? 'Parar e enviar' : 'Falar'}>{ouvindo ? '■' : '🎙'}</button>
        <textarea
          value={texto} onChange={(e) => setTexto(e.target.value)} rows={1}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarTexto(); } }}
          placeholder="Segure espaço e fale, ou digite…"
        />
        <button className={css.enviar} onClick={enviarTexto} disabled={!texto.trim()} aria-label="Enviar">➤</button>
      </div>
    </div>
  );
}
