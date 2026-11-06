import { api } from '../../lib/api';

/** Grava o microfone e mede o volume (para a esfera reagir e parar no silêncio). */
export class Gravador {
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private partes: Blob[] = [];
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private amostras: Uint8Array<ArrayBuffer> | null = null;
  private nivelAtual = 0;
  private ruido = 0.02;
  private timer = 0;
  ultimaVoz = 0;
  falou = false;

  static suportado(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  }

  async iniciar(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m));
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.partes = [];
    this.rec.ondataavailable = (e) => { if (e.data.size) this.partes.push(e.data); };
    this.rec.start(250);
    this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => undefined);
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.6;
    src.connect(this.analyser);
    this.amostras = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
    this.ultimaVoz = performance.now();
    this.falou = false;
    this.ruido = 0.02;
    this.nivelAtual = 0;
    this.timer = window.setInterval(() => this.medir(), 50);
  }

  nivel(): number { return this.nivelAtual; }
  silencioMs(): number { return performance.now() - this.ultimaVoz; }

  private medir(): void {
    if (!this.analyser || !this.amostras) return;
    this.analyser.getByteTimeDomainData(this.amostras);
    let s = 0;
    for (const v of this.amostras) { const x = (v - 128) / 128; s += x * x; }
    const n = Math.min(1, Math.sqrt(s / this.amostras.length) * 6);
    this.nivelAtual = n;
    this.ruido = n < this.ruido ? this.ruido * 0.9 + n * 0.1 : this.ruido * 0.995 + n * 0.005;
    if (n > Math.max(0.05, this.ruido * 2)) { this.ultimaVoz = performance.now(); this.falou = true; }
  }

  async parar(): Promise<{ blob: Blob; mime: string }> {
    const g = this.rec;
    if (!g || g.state === 'inactive') { this.liberar(); return { blob: new Blob(), mime: 'audio/webm' }; }
    return new Promise((res) => {
      g.onstop = () => { const mime = g.mimeType || 'audio/webm'; const blob = new Blob(this.partes, { type: mime }); this.liberar(); res({ blob, mime }); };
      g.stop();
    });
  }

  cancelar(): void {
    if (this.rec && this.rec.state !== 'inactive') { this.rec.onstop = null; this.rec.stop(); }
    this.liberar();
  }

  private liberar(): void {
    window.clearInterval(this.timer);
    this.nivelAtual = 0;
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => undefined);
    this.stream = null; this.rec = null; this.ctx = null; this.analyser = null; this.amostras = null;
  }
}

// ───────────────────────── voz da Pri (playback) ─────────────────────────
let sessao = 0;
let tocador: HTMLAudioElement | null = null;
let urls: string[] = [];
let ouvinte: { ctx: AudioContext; analyser: AnalyserNode; amostras: Uint8Array<ArrayBuffer> } | null = null;
let nivelFalso = 0;
let ritmo = 0;

export function nivelDaFala(): number {
  if (ouvinte) {
    ouvinte.analyser.getByteTimeDomainData(ouvinte.amostras);
    let s = 0;
    for (const v of ouvinte.amostras) { const x = (v - 128) / 128; s += x * x; }
    return Math.min(1, Math.sqrt(s / ouvinte.amostras.length) * 5);
  }
  return nivelFalso;
}

function soltarOuvinte(): void { if (ouvinte) { void ouvinte.ctx.close().catch(() => undefined); ouvinte = null; } }

function medirTocador(a: HTMLAudioElement): void {
  soltarOuvinte();
  const cap = (a as HTMLAudioElement & { captureStream?: () => MediaStream }).captureStream;
  if (typeof cap !== 'function') return;
  try {
    const stream = cap.call(a);
    if (!stream.getAudioTracks().length) return;
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 512; an.smoothingTimeConstant = 0.55;
    ctx.createMediaStreamSource(stream).connect(an);
    ouvinte = { ctx, analyser: an, amostras: new Uint8Array(new ArrayBuffer(an.fftSize)) };
  } catch { ouvinte = null; }
}

export function pararFala(): void {
  sessao++;
  try { tocador?.pause(); } catch { /* ignore */ }
  if (tocador) { tocador.onended = null; tocador.onerror = null; }
  tocador = null;
  if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
  window.clearInterval(ritmo); nivelFalso = 0;
  for (const u of urls) URL.revokeObjectURL(u);
  urls = [];
  soltarOuvinte();
}

const mp3EmFluxo = () => {
  try { return typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mpeg'); } catch { return false; }
};

/** Fala o texto: voz do servidor (OpenAI) em fluxo se ligada; senão a voz do navegador. */
export async function falar(texto: string, falaNatural: boolean, aoFim: () => void, aoComecar?: () => void): Promise<void> {
  pararFala();
  const minha = sessao;
  const t = texto.trim();
  if (!t) { aoFim(); return; }
  if (falaNatural) {
    try {
      await falarServidor(t, minha, aoComecar);
      if (minha === sessao) aoFim();
      return;
    } catch (e) {
      if (minha !== sessao) return;
      // Já tocou algo: não emenda uma segunda voz na mesma resposta.
      if ((e as { comecou?: boolean })?.comecou) { aoFim(); return; }
    }
  }
  falarNavegador(t, minha, aoFim, aoComecar);
}

function aguardar(sb: SourceBuffer, pedaco: Uint8Array): Promise<void> {
  return new Promise((ok, err) => {
    sb.addEventListener('updateend', () => ok(), { once: true });
    sb.addEventListener('error', () => err(new Error('áudio inválido')), { once: true });
    sb.appendBuffer(pedaco as Uint8Array<ArrayBuffer>);
  });
}

async function falarServidor(texto: string, minha: number, aoComecar?: () => void): Promise<void> {
  const r = await api.fluxo('/argos/falar-fluxo', { texto });
  if (minha !== sessao) return;
  const a = new Audio(); tocador = a;
  let comecou = false;
  const comecar = () => { if (comecou || minha !== sessao) return; comecou = true; medirTocador(a); aoComecar?.(); };

  // Sem MediaSource (ou sem corpo): baixa o mp3 inteiro e toca.
  if (!mp3EmFluxo() || !r.body) {
    const url = URL.createObjectURL(await r.blob()); urls.push(url);
    if (minha !== sessao) return;
    await new Promise<void>((ok, err) => {
      a.onended = () => ok();
      a.onerror = () => err(Object.assign(new Error('áudio inválido'), { comecou }));
      a.src = url; a.play().then(comecar, () => err(Object.assign(new Error('não tocou'), { comecou })));
    });
    return;
  }

  const ms = new MediaSource();
  const url = URL.createObjectURL(ms); urls.push(url);
  a.src = url;
  await new Promise((ok) => ms.addEventListener('sourceopen', ok, { once: true }));
  if (minha !== sessao || ms.readyState !== 'open') throw Object.assign(new Error('fluxo não abriu'), { comecou });
  const sb = ms.addSourceBuffer('audio/mpeg');
  const fim = new Promise<void>((ok, err) => {
    a.onended = () => ok();
    a.onerror = () => err(Object.assign(new Error('áudio inválido'), { comecou }));
  });
  fim.catch(() => undefined);
  const leitor = r.body.getReader();
  let tocando: Promise<void> | null = null;
  try {
    for (;;) {
      const { done, value } = await leitor.read();
      if (minha !== sessao) { void leitor.cancel().catch(() => undefined); return; }
      if (done) break;
      if (!value?.byteLength) continue;
      await aguardar(sb, value);
      if (!tocando) { tocando = a.play().then(comecar); tocando.catch(() => undefined); }
    }
  } finally {
    if (ms.readyState === 'open') try { ms.endOfStream(); } catch { /* ignore */ }
  }
  if (!tocando) throw Object.assign(new Error('veio vazio'), { comecou: false });
  await tocando;
  if (!comecou) throw Object.assign(new Error('não começou'), { comecou: false });
  await fim;
}

function falarNavegador(texto: string, minha: number, aoFim: () => void, aoComecar?: () => void): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) { aoFim(); return; }
  const u = new SpeechSynthesisUtterance(texto);
  u.lang = 'pt-BR'; u.rate = 1.15;
  nivelFalso = 0;
  u.onstart = () => { if (minha === sessao) aoComecar?.(); };
  ritmo = window.setInterval(() => { nivelFalso = 0.3 + Math.random() * 0.5; }, 120);
  const fim = () => { window.clearInterval(ritmo); nivelFalso = 0; if (minha === sessao) aoFim(); };
  u.onend = fim;
  u.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') fim(); };
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

export async function blobParaBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
