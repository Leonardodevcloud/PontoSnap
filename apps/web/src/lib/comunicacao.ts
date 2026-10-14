import { useEffect, useState } from 'react';
import { api } from './api';

/** Tipos e utilidades da Comunicação interna (RH e app). */
export type Bloco =
  | { tipo: 'TEXTO'; texto: string }
  | { tipo: 'FOTOS'; midias: string[] }
  | { tipo: 'AUDIO'; midiaId: string; duracaoSeg: number; picos: number[] }
  | { tipo: 'VIDEO'; url: string; provedor: 'YOUTUBE' | 'VIMEO' | 'DRIVE'; videoId: string; titulo: string | null }
  | { tipo: 'ARQUIVO'; midiaId: string; nome: string; bytes: number };
export interface Publico { tipo: 'TODOS' | 'CLIENTE' | 'ESCALA' | 'PESSOAS'; valores: string[] }
export type StatusComunicado = 'RASCUNHO' | 'AGENDADO' | 'PUBLICADO' | 'ARQUIVADO';
export const REACOES = ['👍', '❤️', '👏', '😂', '🙏'] as const;

// ───────── mídia protegida por token → URL de blob (com cache) ─────────
const cache = new Map<string, Promise<string>>();
export function urlDaMidia(path: string): Promise<string> {
  let p = cache.get(path);
  if (!p) {
    p = api.baixar(path).then((b) => URL.createObjectURL(b));
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}
/** Semeia o cache com o arquivo local (logo depois do envio, sem baixar de novo). */
export function semearMidia(path: string, blob: Blob) { cache.set(path, Promise.resolve(URL.createObjectURL(blob))); }

export function useMidia(path: string | null): { url: string | null; erro: boolean } {
  const [st, setSt] = useState<{ url: string | null; erro: boolean }>({ url: null, erro: false });
  useEffect(() => {
    if (!path) return;
    let vivo = true;
    setSt({ url: null, erro: false });
    urlDaMidia(path).then((url) => vivo && setSt({ url, erro: false })).catch(() => vivo && setSt({ url: null, erro: true }));
    return () => { vivo = false; };
  }, [path]);
  return st;
}

// ───────── preparo de arquivos no navegador ─────────
async function paraJpeg(fonte: ImageBitmap, max: number, q: number): Promise<Blob> {
  const esc = Math.min(1, max / Math.max(fonte.width, fonte.height));
  const c = document.createElement('canvas');
  c.width = Math.round(fonte.width * esc); c.height = Math.round(fonte.height * esc);
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(fonte, 0, 0, c.width, c.height);
  return new Promise((ok, falha) => c.toBlob((b) => (b ? ok(b) : falha(new Error('Não consegui processar a foto.'))), 'image/jpeg', q));
}
/** Foto até 1600px (JPEG ~80%) + miniatura de 360px para as listas. */
export async function prepararFoto(arquivo: File): Promise<{ foto: Blob; mini: Blob }> {
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(arquivo, { imageOrientation: 'from-image' } as ImageBitmapOptions); }
  catch { throw new Error(`Não consegui abrir "${arquivo.name}". Use JPG ou PNG.`); }
  let foto = await paraJpeg(bmp, 1600, 0.8);
  if (foto.size > 1.9 * 1024 * 1024) foto = await paraJpeg(bmp, 1280, 0.7);
  const mini = await paraJpeg(bmp, 360, 0.72);
  bmp.close();
  return { foto, mini };
}

/** Duração e o desenho da onda (48 barras de 0 a 100). */
export async function analisarAudio(blob: Blob, barras = 48): Promise<{ duracaoSeg: number; picos: number[] }> {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const dados = buf.getChannelData(0);
    const passo = Math.max(1, Math.floor(dados.length / barras));
    const brutos: number[] = [];
    for (let i = 0; i < barras; i++) {
      let pico = 0;
      for (let j = i * passo; j < Math.min(dados.length, (i + 1) * passo); j += 16) pico = Math.max(pico, Math.abs(dados[j]!));
      brutos.push(pico);
    }
    const max = Math.max(...brutos, 0.01);
    void ctx.close();
    return { duracaoSeg: Math.round(buf.duration), picos: brutos.map((v) => Math.max(8, Math.round((v / max) * 100))) };
  } catch {
    return { duracaoSeg: 0, picos: Array.from({ length: barras }, (_, i) => 30 + Math.round(Math.abs(Math.sin(i * 1.3)) * 50)) };
  }
}

export interface MidiaEnviada { id: string; tipo: string; nome: string | null; bytes: number; mime: string }
export async function enviarMidia(tipo: 'FOTO' | 'AUDIO' | 'ARQUIVO', arquivo: Blob, nome: string, mini?: Blob): Promise<MidiaEnviada> {
  const fd = new FormData();
  fd.append('arquivo', arquivo, nome);
  if (mini) fd.append('miniatura', mini, 'mini.jpg');
  const m = await api.enviarForm<MidiaEnviada>(`/comunicacao/midia?tipo=${tipo}`, fd);
  semearMidia(`/comunicacao/midia/${m.id}`, arquivo);
  if (mini) semearMidia(`/comunicacao/midia/${m.id}?mini=1`, mini);
  return m;
}

/** Melhor formato de gravação que o navegador tem (MP4/AAC toca em todo iPhone). */
export function formatoGravacao(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const t of ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

// ───────── formatação ─────────
export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export function quando(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso); const hoje = new Date();
  const ontem = new Date(); ontem.setDate(hoje.getDate() - 1);
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === hoje.toDateString()) return `hoje ${hora}`;
  if (d.toDateString() === ontem.toDateString()) return `ontem ${hora}`;
  const dif = (hoje.getTime() - d.getTime()) / 86_400_000;
  if (dif > 0 && dif < 6) return `${d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')} ${hora}`;
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora}`;
}
export const tamanho = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
export const miniaturaVideo = (b: { provedor: string; videoId: string }) => (b.provedor === 'YOUTUBE' ? `https://i.ytimg.com/vi/${b.videoId}/hqdefault.jpg` : null);
