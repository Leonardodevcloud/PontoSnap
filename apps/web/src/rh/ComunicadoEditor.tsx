import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import {
  analisarAudio, enviarMidia, formatoGravacao, mmss, prepararFoto, tamanho, useMidia,
  type Bloco, type Publico, type StatusComunicado,
} from '../lib/comunicacao';
import { ArquivoPdf, ComunicadoView, PlayerAudio, VideoEmbed } from '../components/comunicado/ComunicadoView';
import { PainelLateral } from '../components/PainelLateral';
import css from './Comunicacao.module.css';

interface Pessoa { id: string; nome: string; cliente: string | null; horarioId: string | null; temApp: boolean; temPush: boolean }
interface Opcao { valor: string; rotulo: string; pessoas: number }
interface Opcoes { pessoas: Pessoa[]; clientes: Opcao[]; escalas: Opcao[] }
interface Carregado {
  destinatarios: unknown[];
  id: string; titulo: string; blocos: Bloco[]; publico: Publico; status: StatusComunicado; agendadoPara: string | null;
  pedirCiencia: boolean; fixado: boolean; notificar: boolean; lembrar: boolean; reacoes: boolean; autorNome: string | null;
}
interface InfoVideo { provedor: 'YOUTUBE' | 'VIMEO' | 'DRIVE'; videoId: string; titulo: string | null; miniatura: string | null }

/** Bloco no editor: o bloco salvo + estado local (chave, envio em andamento, gravação). */
type BlocoEd = (Bloco | { tipo: 'GRAVANDO' }) & { k: string; enviando?: number; videoEstado?: 'vazio' | 'verificando' | 'ok' | 'erro'; videoErro?: string };

const caminhoRH = (id: string, mini?: boolean) => `/comunicacao/midia/${id}${mini ? '?mini=1' : ''}`;
const CHAVE_AUTOR = 'pontosnap.comunicado.autor';
let seq = 0;
const novaChave = () => `b${Date.now()}${seq++}`;
const NOMES: Record<string, string> = { TEXTO: 'Texto', FOTOS: 'Fotos', AUDIO: 'Áudio', VIDEO: 'Vídeo', ARQUIVO: 'Arquivo PDF', GRAVANDO: 'Áudio · gravando' };

function amanha0730() {
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(7, 30, 0, 0);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function paraInputLocal(iso: string) {
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Interruptor({ ligado, onMudar, rotulo, ajuda, desabilitado }: { ligado: boolean; onMudar: (v: boolean) => void; rotulo: string; ajuda: string; desabilitado?: boolean }) {
  return (
    <div className={css.tg}>
      <div><b id={`tg-${rotulo}`}>{rotulo}</b><small>{ajuda}</small></div>
      <button type="button" role="switch" aria-checked={ligado} aria-labelledby={`tg-${rotulo}`} className={css.sw}
        disabled={desabilitado} onClick={() => onMudar(!ligado)} />
    </div>
  );
}

function FotoMini({ id, onTirar }: { id: string; onTirar: () => void }) {
  const { url } = useMidia(caminhoRH(id, true));
  return (
    <div className={css.gItem}>
      {url ? <img src={url} alt="" /> : null}
      <button type="button" onClick={onTirar} aria-label="Tirar esta foto">×</button>
    </div>
  );
}

/** Gravação de áudio no navegador, com a onda ao vivo. Até 5 minutos. */
function Gravador({ onPronto, onCancelar }: { onPronto: (b: Blob, mime: string) => void; onCancelar: () => void }) {
  const [seg, setSeg] = useState(0);
  const [niveis, setNiveis] = useState<number[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const pronto = useRef(onPronto); pronto.current = onPronto;
  const LIMITE = 300;

  useEffect(() => {
    let stream: MediaStream | null = null, ctx: AudioContext | null = null, raf = 0, timer = 0, cancelado = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (cancelado) { stream.getTracks().forEach((t) => t.stop()); return; }
        const mime = formatoGravacao();
        const r = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 48_000 });
        const partes: Blob[] = [];
        r.ondataavailable = (e) => { if (e.data.size) partes.push(e.data); };
        r.onstop = () => {
          stream?.getTracks().forEach((t) => t.stop());
          const tipo = r.mimeType || mime || 'audio/webm';
          if (partes.length) pronto.current(new Blob(partes, { type: tipo }), tipo);
        };
        r.start(250);
        rec.current = r;
        ctx = new AudioContext();
        const an = ctx.createAnalyser(); an.fftSize = 256;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Uint8Array(an.frequencyBinCount);
        const desenhar = () => {
          an.getByteTimeDomainData(buf);
          let pico = 0; for (const v of buf) pico = Math.max(pico, Math.abs(v - 128));
          setNiveis((n) => [...n.slice(-47), Math.min(100, 8 + (pico / 128) * 220)]);
          raf = requestAnimationFrame(desenhar);
        };
        desenhar();
        const ini = Date.now();
        timer = window.setInterval(() => {
          const s = Math.floor((Date.now() - ini) / 1000);
          setSeg(s);
          if (s >= LIMITE && r.state === 'recording') r.stop();
        }, 250);
      } catch {
        setErro('Não consegui usar o microfone. Libere o acesso no navegador (ícone de cadeado na barra de endereço).');
      }
    })();
    return () => {
      cancelado = true;
      cancelAnimationFrame(raf); clearInterval(timer);
      if (rec.current?.state === 'recording') { rec.current.onstop = null; rec.current.stop(); }
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
    };
  }, []);

  if (erro) return <div><p className={css.erro}>{erro}</p><button type="button" className={css.btnTxt} onClick={onCancelar}>Fechar</button></div>;
  return (
    <div className={css.rec}>
      <button type="button" className={css.recBtn} onClick={() => rec.current?.state === 'recording' && rec.current.stop()} aria-label="Parar e usar a gravação"><i /></button>
      <div className={css.recOnda} aria-hidden="true">
        {Array.from({ length: 48 }, (_, i) => niveis[i - (48 - niveis.length)] ?? 4).map((v, i) => <i key={i} style={{ height: `${v}%` }} />)}
      </div>
      <div className={css.recTempo} role="timer" aria-live="off">{mmss(seg)}<small>até {mmss(LIMITE)}</small></div>
    </div>
  );
}

/** Editor de comunicado em blocos (novo, rascunho, agendado ou já publicado). */
export function ComunicadoEditor() {
  const { id } = useParams();
  const navegar = useNavigate();
  const loc = useLocation() as { state?: { msg?: string } };
  const [status, setStatus] = useState<StatusComunicado>('RASCUNHO');
  const [agendadoPara, setAgendadoPara] = useState<string | null>(null);
  const [titulo, setTitulo] = useState('');
  const [blocos, setBlocos] = useState<BlocoEd[]>([{ tipo: 'TEXTO', texto: '', k: novaChave() }]);
  const [publico, setPublico] = useState<Publico>({ tipo: 'TODOS', valores: [] });
  const [op, setOp] = useState({ pedirCiencia: false, fixado: false, notificar: true, lembrar: true, reacoes: true });
  const [autor, setAutor] = useState(() => { try { return localStorage.getItem(CHAVE_AUTOR) ?? 'RH'; } catch { return 'RH'; } });
  const [opcoes, setOpcoes] = useState<Opcoes | null>(null);
  const [carregando, setCarregando] = useState(!!id);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(loc.state?.msg ?? null);
  const [salvando, setSalvando] = useState(false);
  const [confirmar, setConfirmar] = useState<null | 'publicar' | 'agendar' | 'excluir'>(null);
  const [quandoAg, setQuandoAg] = useState(amanha0730());
  const [previa, setPrevia] = useState(false);
  const [buscaP, setBuscaP] = useState('');
  const [sujo, setSujo] = useState(false);
  const [jaRecebeu, setJaRecebeu] = useState(0);
  const inFotos = useRef<HTMLInputElement>(null);
  const inAudio = useRef<HTMLInputElement>(null);
  const inPdf = useRef<HTMLInputElement>(null);
  const alvoFotos = useRef<string | null>(null);

  useEffect(() => { api.get<Opcoes>('/comunicacao/opcoes').then(setOpcoes).catch(() => setOpcoes({ pessoas: [], clientes: [], escalas: [] })); }, []);
  useEffect(() => {
    if (!id) return;
    api.get<Carregado>(`/comunicacao/${id}`).then((c) => {
      setStatus(c.status); setAgendadoPara(c.agendadoPara); setTitulo(c.titulo);
      setBlocos(c.blocos.map((b) => ({ ...b, k: novaChave(), ...(b.tipo === 'VIDEO' ? { videoEstado: 'ok' as const } : {}) })));
      setPublico(c.publico); setJaRecebeu(c.destinatarios?.length ?? 0);
      setOp({ pedirCiencia: c.pedirCiencia, fixado: c.fixado, notificar: c.notificar, lembrar: c.lembrar, reacoes: c.reacoes });
      if (c.autorNome) setAutor(c.autorNome);
      if (c.agendadoPara) setQuandoAg(paraInputLocal(c.agendadoPara));
    }).catch((e) => setErro((e as Error).message)).finally(() => setCarregando(false));
  }, [id]);
  useEffect(() => {
    if (!sujo) return;
    const aviso = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', aviso);
    return () => window.removeEventListener('beforeunload', aviso);
  }, [sujo]);

  const publicado = status === 'PUBLICADO' || status === 'ARQUIVADO';
  const mudar = useCallback((k: string, f: (b: BlocoEd) => BlocoEd) => { setBlocos((bs) => bs.map((b) => (b.k === k ? f(b) : b))); setSujo(true); }, []);
  const tirar = (k: string) => { setBlocos((bs) => bs.filter((b) => b.k !== k)); setSujo(true); };
  const mover = (k: string, d: number) => {
    setBlocos((bs) => { const i = bs.findIndex((b) => b.k === k); const j = i + d; if (j < 0 || j >= bs.length) return bs; const c = [...bs]; [c[i], c[j]] = [c[j]!, c[i]!]; return c; });
    setSujo(true);
  };
  const add = (b: BlocoEd) => { setBlocos((bs) => [...bs, b]); setSujo(true); };

  // ───── fotos ─────
  async function fotosEscolhidas(lista: FileList | null) {
    const arqs = [...(lista ?? [])].slice(0, 12);
    if (!arqs.length) return;
    let k = alvoFotos.current;
    if (!k) { k = novaChave(); add({ tipo: 'FOTOS', midias: [], k, enviando: 0 }); }
    alvoFotos.current = null;
    const chave = k;
    mudar(chave, (b) => ({ ...b, enviando: (b.enviando ?? 0) + arqs.length }));
    setErro(null);
    for (const a of arqs) {
      try {
        const { foto, mini } = await prepararFoto(a);
        const m = await enviarMidia('FOTO', foto, a.name.replace(/\.\w+$/, '.jpg'), mini);
        mudar(chave, (b) => (b.tipo === 'FOTOS' ? { ...b, midias: [...b.midias, m.id].slice(0, 12), enviando: (b.enviando ?? 1) - 1 } : b));
      } catch (e) {
        setErro((e as Error).message);
        mudar(chave, (b) => ({ ...b, enviando: (b.enviando ?? 1) - 1 }));
      }
    }
  }
  // ───── áudio ─────
  async function subirAudio(chave: string, blob: Blob, nome: string) {
    mudar(chave, (b) => ({ ...b, enviando: 1 }));
    try {
      const { duracaoSeg, picos } = await analisarAudio(blob);
      const m = await enviarMidia('AUDIO', blob, nome);
      mudar(chave, () => ({ tipo: 'AUDIO', midiaId: m.id, duracaoSeg, picos, k: chave }));
    } catch (e) {
      setErro((e as Error).message);
      tirar(chave);
    }
  }
  async function audioEscolhido(lista: FileList | null) {
    const a = lista?.[0];
    if (!a) return;
    if (a.size > 10 * 1024 * 1024) { setErro('Áudio grande demais (máximo 10 MB).'); return; }
    const k = novaChave();
    add({ tipo: 'GRAVANDO', k, enviando: 1 });
    await subirAudio(k, a, a.name);
  }
  // ───── PDF ─────
  async function pdfEscolhido(lista: FileList | null) {
    const a = lista?.[0];
    if (!a) return;
    if (a.size > 10 * 1024 * 1024) { setErro('PDF grande demais (máximo 10 MB).'); return; }
    const k = novaChave();
    add({ tipo: 'ARQUIVO', midiaId: '', nome: a.name, bytes: a.size, k, enviando: 1 });
    try {
      const m = await enviarMidia('ARQUIVO', a, a.name);
      mudar(k, () => ({ tipo: 'ARQUIVO', midiaId: m.id, nome: a.name, bytes: a.size, k }));
    } catch (e) { setErro((e as Error).message); tirar(k); }
  }
  // ───── vídeo ─────
  const timersVideo = useRef<Record<string, number>>({});
  function urlVideo(k: string, url: string) {
    mudar(k, (b) => ({ ...(b as Extract<Bloco, { tipo: 'VIDEO' }>), url, k, videoEstado: url.trim() ? 'verificando' : 'vazio', videoErro: undefined }));
    clearTimeout(timersVideo.current[k]);
    if (!url.trim()) return;
    timersVideo.current[k] = window.setTimeout(async () => {
      try {
        const v = await api.post<InfoVideo>('/comunicacao/video', { url });
        mudar(k, (b) => ({ ...b, tipo: 'VIDEO', url, provedor: v.provedor, videoId: v.videoId, titulo: v.titulo, videoEstado: 'ok' } as BlocoEd));
      } catch (e) {
        mudar(k, (b) => ({ ...b, videoEstado: 'erro', videoErro: (e as Error).message }));
      }
    }, 450);
  }

  // ───── público ─────
  const alvo = useMemo(() => {
    const ps = opcoes?.pessoas ?? [];
    const v = new Set(publico.valores);
    const dentro = ps.filter((p) => (publico.tipo === 'TODOS' ? true : publico.tipo === 'CLIENTE' ? v.has(p.cliente ?? '') : publico.tipo === 'ESCALA' ? v.has(p.horarioId ?? '') : v.has(p.id)));
    return { com: dentro.filter((p) => p.temApp).length, push: dentro.filter((p) => p.temPush).length, semApp: dentro.filter((p) => !p.temApp).length };
  }, [opcoes, publico]);
  const alternarValor = (v: string) => {
    setPublico((p) => ({ ...p, valores: p.valores.includes(v) ? p.valores.filter((x) => x !== v) : [...p.valores, v] }));
    setSujo(true);
  };

  // ───── salvar / publicar ─────
  const enviandoAlgo = blocos.some((b) => (b.enviando ?? 0) > 0 || b.tipo === 'GRAVANDO');
  function paraSalvar(): Bloco[] {
    return blocos.flatMap((b): Bloco[] => {
      if (b.tipo === 'GRAVANDO') return [];
      if (b.tipo === 'VIDEO' && (!b.url.trim() || b.videoEstado !== 'ok')) return [];
      if (b.tipo === 'TEXTO' && !b.texto.trim()) return [];
      if ((b.tipo === 'AUDIO' || b.tipo === 'ARQUIVO') && !b.midiaId) return [];
      if (b.tipo === 'FOTOS' && b.midias.length === 0) return [];
      const { k: _k, enviando: _e, videoEstado: _v, videoErro: _ve, ...resto } = b as BlocoEd & Record<string, unknown>;
      return [resto as Bloco];
    });
  }
  const conteudo = paraSalvar();
  const videoRuim = blocos.find((b) => b.tipo === 'VIDEO' && b.videoEstado === 'erro');

  async function salvar(): Promise<string | null> {
    setErro(null); setMsg(null);
    if (!titulo.trim()) { setErro('Dê um título ao comunicado.'); return null; }
    if (videoRuim) { setErro('Tem um link de vídeo que não reconheci. Corrija ou tire o bloco.'); return null; }
    setSalvando(true);
    try {
      try { localStorage.setItem(CHAVE_AUTOR, autor.trim() || 'RH'); } catch { /* sem storage */ }
      const corpo = { titulo: titulo.trim(), blocos: conteudo, publico, ...op, autorNome: autor.trim() || 'RH' };
      const r = id ? await api.put<{ id: string }>(`/comunicacao/${id}`, corpo) : await api.post<{ id: string }>('/comunicacao', corpo);
      setSujo(false);
      return r.id;
    } catch (e) { setErro((e as Error).message); return null; } finally { setSalvando(false); }
  }
  async function salvarRascunho() {
    const novo = await salvar();
    if (!novo) return;
    if (publicado) { navegar(`/rh/comunicacao/${novo}`); return; }
    const aviso = status === 'AGENDADO' ? 'Alterações salvas. Continua agendado.' : 'Rascunho salvo.';
    if (!id) navegar(`/rh/comunicacao/${novo}/editar`, { replace: true, state: { msg: aviso } });
    else setMsg(aviso);
  }
  async function publicar(agendar: boolean) {
    const novo = await salvar();
    if (!novo) return;
    setSalvando(true);
    try {
      const r = await api.post<{ status: string; destinatarios: number }>(`/comunicacao/${novo}/publicar`, agendar ? { agendadoPara: new Date(quandoAg).toISOString() } : {});
      if (r.status === 'AGENDADO') { navegar('/rh/comunicacao'); return; }
      navegar(`/rh/comunicacao/${novo}`, { state: { publicado: r.destinatarios } });
    } catch (e) { setErro((e as Error).message); setConfirmar(null); } finally { setSalvando(false); }
  }
  async function excluir() {
    if (!id) { navegar('/rh/comunicacao'); return; }
    try { await api.del(`/comunicacao/${id}`); setSujo(false); navegar('/rh/comunicacao'); } catch (e) { setErro((e as Error).message); }
  }
  async function desagendar() {
    if (!id) return;
    try { await api.post(`/comunicacao/${id}/desagendar`); setStatus('RASCUNHO'); setAgendadoPara(null); setMsg('Agendamento cancelado. Virou rascunho.'); } catch (e) { setErro((e as Error).message); }
  }

  if (carregando) return <div className={css.pagina} aria-busy="true"><p className={css.ajuda}>Carregando…</p></div>;

  const pronto = titulo.trim() && conteudo.length > 0 && !enviandoAlgo && (publico.tipo === 'TODOS' || publico.valores.length > 0);
  const lista: Opcao[] = publico.tipo === 'CLIENTE' ? opcoes?.clientes ?? [] : publico.tipo === 'ESCALA' ? opcoes?.escalas ?? [] : [];
  const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const pessoasFiltradas = (opcoes?.pessoas ?? []).filter((p) => p.temApp && (!buscaP || sem(p.nome).includes(sem(buscaP))));
  const primeiroTexto = conteudo.find((b) => b.tipo === 'TEXTO') as { texto: string } | undefined;
  const midiasTxt = (() => {
    const t = new Set(conteudo.map((b) => b.tipo)); const n: string[] = [];
    if (t.has('VIDEO')) n.push('vídeo'); if (t.has('FOTOS')) n.push('fotos'); if (t.has('AUDIO')) n.push('áudio'); if (t.has('ARQUIVO')) n.push('PDF');
    return n.length ? (n.length === 1 ? n[0] : `${n.slice(0, -1).join(', ')} e ${n.at(-1)}`) : '';
  })();

  return (
    <div className={css.pagina}>
      <div className={css.cab}>
        <div>
          <button type="button" className={css.voltar} onClick={() => navegar(publicado && id ? `/rh/comunicacao/${id}` : '/rh/comunicacao')}>‹ {publicado ? 'Voltar ao comunicado' : 'Comunicação interna'}</button>
          <h2>{publicado ? 'Editar comunicado' : id ? (status === 'AGENDADO' ? 'Comunicado agendado' : 'Rascunho') : 'Novo comunicado'}</h2>
          {status === 'AGENDADO' && agendadoPara && <p>Sai em {new Date(agendadoPara).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}. <button type="button" className={css.btnTxt} onClick={desagendar}>Cancelar agendamento</button></p>}
        </div>
        <div className={css.acoes}>
          <button type="button" className={css.btnSec} onClick={() => setPrevia(true)} disabled={!conteudo.length}>Ver como fica no app</button>
          {publicado ? (
            <button type="button" className={css.btnPri} onClick={salvarRascunho} disabled={salvando || enviandoAlgo}>Salvar alterações</button>
          ) : (<>
            <button type="button" className={css.btnSec} onClick={salvarRascunho} disabled={salvando || enviandoAlgo}>{status === 'AGENDADO' ? 'Salvar' : 'Salvar rascunho'}</button>
            <button type="button" className={css.btnSec} onClick={() => setConfirmar('agendar')} disabled={!pronto || salvando}>{status === 'AGENDADO' ? 'Mudar horário' : 'Agendar…'}</button>
            <button type="button" className={css.btnPri} onClick={() => setConfirmar('publicar')} disabled={!pronto || salvando}>Publicar para {alvo.com} {alvo.com === 1 ? 'pessoa' : 'pessoas'}</button>
          </>)}
        </div>
      </div>

      {erro && <p className={css.erro} role="alert">{erro}</p>}
      {msg && <p className={css.okMsg} role="status">{msg}</p>}
      {confirmar === 'publicar' && (
        <div className={css.confirma} role="alertdialog" aria-label="Confirmar publicação">
          <p><b>Publicar agora?</b> Vai para {alvo.com} {alvo.com === 1 ? 'pessoa' : 'pessoas'}{op.notificar ? `; ${alvo.push} ${alvo.push === 1 ? 'recebe' : 'recebem'} a notificação no celular na hora` : ''}. Depois de publicado, o público {op.pedirCiencia ? 'e a ciência obrigatória não mudam' : 'não muda'}.</p>
          <button type="button" className={css.btnSec} onClick={() => setConfirmar(null)}>Voltar</button>
          <button type="button" className={css.btnPri} onClick={() => publicar(false)} disabled={salvando} autoFocus>{salvando ? 'Publicando…' : 'Publicar agora'}</button>
        </div>
      )}
      {confirmar === 'agendar' && (
        <div className={css.agendar}>
          <label className={css.lbl} htmlFor="ag" style={{ margin: 0 }}>Publicar em</label>
          <input id="ag" type="datetime-local" className={css.inp} value={quandoAg} min={paraInputLocal(new Date(Date.now() + 5 * 60_000).toISOString())} onChange={(e) => setQuandoAg(e.target.value)} />
          <button type="button" className={css.btnPri} onClick={() => publicar(true)} disabled={salvando || !quandoAg || new Date(quandoAg).getTime() < Date.now() + 60_000}>Agendar</button>
          <button type="button" className={css.btnTxt} onClick={() => setConfirmar(null)}>Cancelar</button>
        </div>
      )}

      <div className={css.editor}>
        <div className={css.caixa}>
          <label className={css.lbl} htmlFor="tit">Título</label>
          <input id="tit" className={`${css.inp} ${css.inpTit}`} value={titulo} maxLength={160} placeholder="Ex.: Novo uniforme a partir de segunda"
            onChange={(e) => { setTitulo(e.target.value); setSujo(true); }} />

          <div className={css.blocos}>
            {blocos.map((b, i) => (
              <section key={b.k} className={css.bloco} aria-label={NOMES[b.tipo]}>
                <div className={css.blocoCab}>
                  <span>{NOMES[b.tipo]}{b.tipo === 'FOTOS' ? ` · ${b.midias.length}` : ''}{(b.enviando ?? 0) > 0 && b.tipo !== 'GRAVANDO' ? ' · enviando…' : ''}</span>
                  <div>
                    <button type="button" className={css.ico} onClick={() => mover(b.k, -1)} disabled={i === 0} aria-label="Subir bloco" title="Subir">↑</button>
                    <button type="button" className={css.ico} onClick={() => mover(b.k, 1)} disabled={i === blocos.length - 1} aria-label="Descer bloco" title="Descer">↓</button>
                    <button type="button" className={css.ico} onClick={() => tirar(b.k)} aria-label="Remover bloco" title="Remover">✕</button>
                  </div>
                </div>

                {b.tipo === 'TEXTO' && <BlocoTexto valor={b.texto} onMudar={(t) => mudar(b.k, (x) => ({ ...x, texto: t } as BlocoEd))} />}

                {b.tipo === 'FOTOS' && (
                  <div className={css.gal}>
                    {b.midias.map((m) => <FotoMini key={m} id={m} onTirar={() => mudar(b.k, (x) => (x.tipo === 'FOTOS' ? { ...x, midias: x.midias.filter((y) => y !== m) } : x))} />)}
                    {Array.from({ length: b.enviando ?? 0 }, (_, j) => <div key={`s${j}`} className={`${css.gItem} ${css.subindo}`}>enviando…</div>)}
                    {b.midias.length + (b.enviando ?? 0) < 12 && (
                      <button type="button" className={css.gAdd} aria-label="Adicionar fotos" onClick={() => { alvoFotos.current = b.k; inFotos.current?.click(); }}>＋</button>
                    )}
                  </div>
                )}

                {b.tipo === 'GRAVANDO' && ((b.enviando ?? 0) > 0
                  ? <p className={css.ajuda}>Preparando o áudio…</p>
                  : <Gravador onCancelar={() => tirar(b.k)} onPronto={(blob, mime) => void subirAudio(b.k, blob, `gravacao.${mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm'}`)} />)}

                {b.tipo === 'AUDIO' && <PlayerAudio caminho={caminhoRH(b.midiaId)} duracaoSeg={b.duracaoSeg} picos={b.picos} />}

                {b.tipo === 'VIDEO' && (<>
                  <input className={css.inp} value={b.url} placeholder="Cole o link do YouTube, Vimeo ou Google Drive" aria-label="Link do vídeo"
                    onChange={(e) => urlVideo(b.k, e.target.value)} />
                  {b.videoEstado === 'verificando' && <p className={css.ajuda}>Verificando o link…</p>}
                  {b.videoEstado === 'erro' && <p className={css.ajuda} style={{ color: 'var(--coral-dark)', fontWeight: 700 }}>{b.videoErro}</p>}
                  {b.videoEstado === 'ok' && b.videoId && (
                    <div className={css.vPrev}>
                      <VideoEmbed bloco={b} compacto />
                      <div>
                        <b>{b.titulo ?? 'Vídeo'}</b>
                        <small>{b.provedor === 'YOUTUBE' ? 'YouTube' : b.provedor === 'VIMEO' ? 'Vimeo' : 'Google Drive'}</small>
                        <span className={css.okTxt}>✓ Toca dentro do app, sem sair</span>
                        {b.provedor === 'DRIVE' && <small>No Drive, o arquivo precisa estar com "Qualquer pessoa com o link".</small>}
                      </div>
                    </div>
                  )}
                  {(!b.videoEstado || b.videoEstado === 'vazio') && <p className={css.ajuda}>Dica: no YouTube, envie o vídeo como "Não listado". Só quem tem o link assiste.</p>}
                </>)}

                {b.tipo === 'ARQUIVO' && ((b.enviando ?? 0) > 0
                  ? <p className={css.ajuda}>Enviando {b.nome} ({tamanho(b.bytes)})…</p>
                  : <ArquivoPdf caminho={caminhoRH(b.midiaId)} nome={b.nome} bytes={b.bytes} />)}
              </section>
            ))}
          </div>

          <div className={css.addBar}>
            <button type="button" className={css.addB} onClick={() => add({ tipo: 'TEXTO', texto: '', k: novaChave() })} disabled={blocos.length >= 20}>Aa Texto</button>
            <button type="button" className={css.addB} onClick={() => { alvoFotos.current = null; inFotos.current?.click(); }} disabled={blocos.length >= 20}>🖼 Fotos</button>
            <button type="button" className={css.addB} onClick={() => add({ tipo: 'GRAVANDO', k: novaChave() })} disabled={blocos.length >= 20 || blocos.some((b) => b.tipo === 'GRAVANDO' && !b.enviando) || typeof MediaRecorder === 'undefined'}>🎙 Gravar áudio</button>
            <button type="button" className={css.addB} onClick={() => inAudio.current?.click()} disabled={blocos.length >= 20}>🎵 Enviar áudio</button>
            <button type="button" className={css.addB} onClick={() => add({ tipo: 'VIDEO', url: '', provedor: 'YOUTUBE', videoId: '', titulo: null, k: novaChave(), videoEstado: 'vazio' })} disabled={blocos.length >= 20}>▶ Vídeo (link)</button>
            <button type="button" className={css.addB} onClick={() => inPdf.current?.click()} disabled={blocos.length >= 20}>📎 Arquivo PDF</button>
          </div>
          <input ref={inFotos} type="file" accept="image/*" multiple hidden onChange={(e) => { void fotosEscolhidas(e.target.files); e.target.value = ''; }} />
          <input ref={inAudio} type="file" accept="audio/*,.opus,.ogg,.m4a" hidden onChange={(e) => { void audioEscolhido(e.target.files); e.target.value = ''; }} />
          <input ref={inPdf} type="file" accept="application/pdf" hidden onChange={(e) => { void pdfEscolhido(e.target.files); e.target.value = ''; }} />
        </div>

        <div className={css.lado}>
          <div className={css.caixa}>
            <h4>Para quem</h4>
            {publicado && <p className={css.trava}>Já publicado: o público não muda mais (o comprovante vale para quem recebeu).</p>}
            <div className={css.chips} role="radiogroup" aria-label="Público">
              {([['TODOS', 'Todos'], ['CLIENTE', 'Por cliente'], ['ESCALA', 'Por escala'], ['PESSOAS', 'Pessoas…']] as const).map(([t, rot]) => (
                <button key={t} type="button" role="radio" aria-checked={publico.tipo === t} disabled={publicado || (t === 'CLIENTE' && !opcoes?.clientes.length) || (t === 'ESCALA' && !opcoes?.escalas.length)}
                  className={`${css.chip} ${publico.tipo === t ? css.chipOn : ''}`} onClick={() => { setPublico({ tipo: t, valores: [] }); setSujo(true); }}>{rot}</button>
              ))}
            </div>
            {!publicado && (publico.tipo === 'CLIENTE' || publico.tipo === 'ESCALA') && (
              <div className={css.escolha}>
                {lista.map((o) => (
                  <label key={o.valor}><input type="checkbox" checked={publico.valores.includes(o.valor)} onChange={() => alternarValor(o.valor)} /><span>{o.rotulo}</span><small>{o.pessoas}</small></label>
                ))}
              </div>
            )}
            {!publicado && publico.tipo === 'PESSOAS' && (<>
              <input className={`${css.inp} ${css.busca}`} placeholder="Buscar pelo nome" aria-label="Buscar pessoa" value={buscaP} onChange={(e) => setBuscaP(e.target.value)} />
              <div className={css.escolha}>
                {pessoasFiltradas.map((p) => (
                  <label key={p.id}><input type="checkbox" checked={publico.valores.includes(p.id)} onChange={() => alternarValor(p.id)} /><span>{p.nome}</span><small>{p.temPush ? '🔔' : ''}</small></label>
                ))}
                {pessoasFiltradas.length === 0 && <label><span>Ninguém encontrado.</span></label>}
              </div>
            </>)}
            {publicado && <p className={css.alcance}>Foi para <b>{jaRecebeu} {jaRecebeu === 1 ? 'pessoa' : 'pessoas'}</b>.</p>}
            {opcoes && !publicado && (
              <p className={css.alcance}>
                <b>{alvo.com} {alvo.com === 1 ? 'pessoa' : 'pessoas'}</b>
                {op.notificar ? ` · ${alvo.push} ${alvo.push === 1 ? 'recebe' : 'recebem'} notificação no celular${alvo.com - alvo.push > 0 ? `, ${alvo.com - alvo.push} ${alvo.com - alvo.push === 1 ? 'vai' : 'vão'} ver quando abrir o app` : ''}.` : ' · vão ver quando abrirem o app.'}
                {alvo.semApp > 0 && ` ${alvo.semApp} sem acesso ao app ${alvo.semApp === 1 ? 'fica' : 'ficam'} de fora.`}
              </p>
            )}
          </div>

          <div className={css.caixa}>
            <h4>Opções</h4>
            <Interruptor rotulo={'Pedir "Li e estou ciente"'} ajuda="Fica registrado com data e hora. Bom para regras e mudanças de escala." ligado={op.pedirCiencia} desabilitado={publicado}
              onMudar={(v) => { setOp((o) => ({ ...o, pedirCiencia: v })); setSujo(true); }} />
            <Interruptor rotulo="Fixar no topo" ajuda="Fica em destaque no app até você desafixar." ligado={op.fixado} onMudar={(v) => { setOp((o) => ({ ...o, fixado: v })); setSujo(true); }} />
            <Interruptor rotulo="Avisar no celular" ajuda="Manda notificação na hora da publicação." ligado={op.notificar} desabilitado={publicado} onMudar={(v) => { setOp((o) => ({ ...o, notificar: v })); setSujo(true); }} />
            <Interruptor rotulo="Lembrar quem não leu" ajuda="Nova notificação depois de 24h para quem ainda não abriu (ou não deu ciência)." ligado={op.lembrar} onMudar={(v) => { setOp((o) => ({ ...o, lembrar: v })); setSujo(true); }} />
            <Interruptor rotulo="Permitir reações" ajuda="👍 ❤️ 👏 😂 🙏 no app. Você vê quem reagiu." ligado={op.reacoes} onMudar={(v) => { setOp((o) => ({ ...o, reacoes: v })); setSujo(true); }} />
            <div className={css.tg}>
              <div style={{ flex: 1 }}>
                <label className={css.lbl} htmlFor="autor">Assinado por</label>
                <input id="autor" className={css.inp} value={autor} maxLength={60} onChange={(e) => { setAutor(e.target.value); setSujo(true); }} placeholder="Ex.: Joana · RH" />
              </div>
            </div>
          </div>

          <div className={css.caixa}>
            <h4>Como chega no celular</h4>
            <div className={css.notifPrev} aria-hidden="true">
              <div><i>P</i><span><b>📢 {titulo.trim() || 'Título do comunicado'}</b>
                <small>{midiasTxt ? `${autor || 'RH'} · ${midiasTxt} · toque para ver` : `${autor || 'RH'}: ${(primeiroTexto?.texto ?? '').slice(0, 80)}`}</small></span></div>
            </div>
          </div>

          {!publicado && (
            confirmar === 'excluir'
              ? <div className={css.acoes}><button type="button" className={css.btnPri} onClick={excluir}>Excluir de vez</button><button type="button" className={css.btnTxt} onClick={() => setConfirmar(null)}>Cancelar</button></div>
              : <button type="button" className={css.btnTxt} onClick={() => setConfirmar('excluir')}>{id ? 'Excluir este rascunho' : 'Descartar'}</button>
          )}
        </div>
      </div>

      <PainelLateral titulo={titulo.trim() || 'Comunicado'} subtitulo={`${autor || 'RH'} · como aparece no app`} aberto={previa} onFechar={() => setPrevia(false)} largura={440}>
        <div className={css.previa}><ComunicadoView blocos={conteudo} caminho={caminhoRH} /></div>
      </PainelLateral>
    </div>
  );
}

/** Texto com atalhos de formatação (**negrito**, *itálico*, lista com "- "). */
function BlocoTexto({ valor, onMudar }: { valor: string; onMudar: (t: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  function envolver(marca: string) {
    const el = ref.current; if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const sel = valor.slice(a, b) || 'texto';
    onMudar(valor.slice(0, a) + marca + sel + marca + valor.slice(b));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + marca.length, a + marca.length + sel.length); });
  }
  function lista() {
    const el = ref.current; if (!el) return;
    const ini = valor.lastIndexOf('\n', el.selectionStart - 1) + 1;
    onMudar(`${valor.slice(0, ini)}- ${valor.slice(ini)}`);
    requestAnimationFrame(() => el.focus());
  }
  return (<>
    <div className={css.fmt} role="toolbar" aria-label="Formatação">
      <button type="button" onClick={() => envolver('**')} aria-label="Negrito" title="Negrito"><b>B</b></button>
      <button type="button" onClick={() => envolver('*')} aria-label="Itálico" title="Itálico"><i>I</i></button>
      <button type="button" onClick={lista} aria-label="Lista" title="Lista">•</button>
    </div>
    <textarea ref={ref} className={css.inp} value={valor} maxLength={5000} aria-label="Texto do comunicado"
      placeholder="Escreva o recado. Links viram clicáveis no app." onChange={(e) => onMudar(e.target.value)} />
  </>);
}
