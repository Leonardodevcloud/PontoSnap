import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { OrbeCanvas, type FaseOrbe } from './OrbeCanvas';
import { Gravador, blobParaBase64, falar, pararFala, nivelDaFala } from './voz';
import css from './EsferaArgos.module.css';

interface Status { ativo: boolean; voz: boolean; fala: boolean }
interface Resposta { resposta: string; fontes: string[]; pessoa: string | null; empregadoId: string | null; mes: string }
interface Turno { q: string; a: string; fontes: string[]; pessoa: string | null; pendente?: boolean }

const CHAVE_MUDO = 'pontosnap:argos-mudo';
const lerMudo = () => { try { return localStorage.getItem(CHAVE_MUDO) === '1'; } catch { return false; } };

const ROTULO: Record<FaseOrbe, string> = {
  pronto: 'Pergunte — segure a barra de espaço e fale, ou digite',
  ouvindo: 'Ouvindo…',
  transcrevendo: 'Entendendo o que você disse…',
  pensando: 'Lendo a apuração e as regras…',
  falando: 'Respondendo…',
  erro: 'Algo deu errado. Tente de novo.',
};

/** Impede o atalho de Espaço de roubar o foco de campos e botões. */
function ocupado(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const t = el.tagName;
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || t === 'BUTTON' || t === 'A' || el.isContentEditable || el.getAttribute('role') === 'button';
}

/** Esfera do Argos, no canto da tela. Barra de espaço abre e ouve; pergunta livre. */
export function EsferaArgos() {
  const [status, setStatus] = useState<Status | null>(null);
  const [aberto, setAberto] = useState(false);
  const [fase, setFase] = useState<FaseOrbe>('pronto');
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [texto, setTexto] = useState('');
  const [mudo, setMudo] = useState(lerMudo);

  const faseRef = useRef(fase); faseRef.current = fase;
  const turnosRef = useRef(turnos); turnosRef.current = turnos;
  const mudoRef = useRef(mudo); mudoRef.current = mudo;
  const statusRef = useRef(status); statusRef.current = status;
  const gravadorRef = useRef<Gravador | null>(null);
  const vigiaRef = useRef(0);
  const pressRef = useRef(0);
  const fimRef = useRef<HTMLDivElement>(null);

  useEffect(() => { api.get<Status>('/argos/status').then(setStatus).catch(() => setStatus({ ativo: false, voz: false, fala: false })); }, []);
  useEffect(() => { if (aberto) fimRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [turnos, fase, aberto]);

  const nivelOrbe = useCallback(() => {
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
      if (!mudoRef.current) { setFase('falando'); await falar(r.resposta, !!statusRef.current?.fala, () => setFase('pronto')); }
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
    const { blob, mime } = await g.parar();
    if (!g.falou || blob.size < 1200) { setFase('pronto'); return; }
    setFase('transcrevendo');
    try {
      const audioBase64 = await blobParaBase64(blob);
      const { texto: t } = await api.post<{ texto: string }>('/argos/transcrever', { audioBase64, mime });
      const q = (t || '').trim();
      if (!q) { setFase('pronto'); return; }
      await perguntarTexto(q);
    } catch {
      setFase('erro'); setTimeout(() => setFase('pronto'), 1600);
    }
  }, [perguntarTexto]);

  const iniciarEscuta = useCallback(async (continuo: boolean) => {
    if (!Gravador.suportado() || !statusRef.current?.voz || gravadorRef.current) return;
    pararFala();
    const g = new Gravador(); gravadorRef.current = g;
    setFase('ouvindo');
    try { await g.iniciar(); } catch { gravadorRef.current = null; setFase('erro'); setTimeout(() => setFase('pronto'), 1600); return; }
    if (continuo) {
      vigiaRef.current = window.setInterval(() => {
        const gg = gravadorRef.current; if (!gg) return;
        if ((gg.falou && gg.silencioMs() > 1200) || gg.silencioMs() > 15000) void pararEescutar();
      }, 200);
    }
  }, [pararEescutar]);

  // Barra de espaço: abre e ouve (segure e fale, solte para enviar).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || ocupado()) return;
      if (!statusRef.current?.voz) return;
      e.preventDefault();
      setAberto(true);
      if (faseRef.current === 'falando') pararFala();
      if (!gravadorRef.current) { pressRef.current = performance.now(); void iniciarEscuta(false); }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !pressRef.current) return;
      pressRef.current = 0;
      if (gravadorRef.current) void pararEescutar();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [iniciarEscuta, pararEescutar]);

  useEffect(() => () => { gravadorRef.current?.cancelar(); pararFala(); window.clearInterval(vigiaRef.current); }, []);

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

  const ouvindo = fase === 'ouvindo';

  if (!aberto) {
    return (
      <button className={css.bolha} onClick={() => setAberto(true)} aria-label="Abrir o Argos (ou aperte a barra de espaço)">
        <OrbeCanvas size={54} fase={fase} nivel={nivelOrbe} />
      </button>
    );
  }

  return (
    <div className={css.painel} role="dialog" aria-label="Argos">
      <header className={css.cab}>
        <div className={css.orbeMini}><OrbeCanvas size={40} fase={fase} nivel={nivelOrbe} /></div>
        <div className={css.tit}><b>Argos</b><small>{ROTULO[fase]}</small></div>
        <button className={css.icone} onClick={alternarMudo} aria-label={mudo ? 'Ativar voz' : 'Silenciar'} title={mudo ? 'Ativar voz' : 'Silenciar'}>{mudo ? '🔇' : '🔊'}</button>
        <button className={css.icone} onClick={() => { pararFala(); gravadorRef.current?.cancelar(); gravadorRef.current = null; setFase('pronto'); setAberto(false); }} aria-label="Fechar">✕</button>
      </header>

      {status?.ativo === false && <div className={css.aviso}>Falta a chave <b>DEEPSEEK_CHAVE</b> na API para o Argos responder.</div>}

      <div className={css.corpo}>
        <div className={css.orbeGrande}><OrbeCanvas size={132} fase={fase} nivel={nivelOrbe} /></div>
        {turnos.length === 0 && fase === 'pronto' && (
          <p className={css.dica}>Pergunte livremente: "por que a Bianca ficou com essas horas extras em outubro?", "esse intervalo curto está certo?". Ele entende o funcionário e o mês pela pergunta.</p>
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
        {status?.voz && (
          <button className={`${css.mic} ${ouvindo ? css.micOn : ''}`} onClick={() => (ouvindo ? void pararEescutar() : void iniciarEscuta(true))} aria-label={ouvindo ? 'Parar de ouvir' : 'Falar'}>
            {ouvindo ? '■' : '🎙'}
          </button>
        )}
        <textarea
          value={texto} onChange={(e) => setTexto(e.target.value)} rows={1}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarTexto(); } }}
          placeholder={status?.voz ? 'Fale (segure espaço) ou digite…' : 'Pergunte ao Argos…'}
        />
        <button className={css.enviar} onClick={enviarTexto} disabled={!texto.trim()} aria-label="Enviar">➤</button>
      </div>
    </div>
  );
}
