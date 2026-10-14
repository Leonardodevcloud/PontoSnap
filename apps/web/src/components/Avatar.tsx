import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';

/**
 * Rosto da pessoa nas listas: a foto (miniatura) de quem já fez a atualização
 * cadastral; quem ainda não tem (ou é prestador) aparece com uma caricatura
 * desenhada aqui, sempre a mesma para a mesma pessoa. O RH pode trocar o
 * desenho (semente).
 */
export type TipoPessoa = 'CLT' | 'PRESTADOR';
export interface InfoAvatarClt {
  foto: string | null; status: 'REVISAR' | 'APROVADA' | 'RECUSADA' | null; motivo: string | null;
  enviadaEm: string | null; origem: string | null; semente: number | null; temApp: boolean; cadastroEm: string | null;
}
export interface RespAvatares {
  empregados: Record<string, InfoAvatarClt>;
  prestadores: Record<string, { semente: number | null }>;
  resumo: { ativos: number; comFoto: number; revisar: number; recusadas: number };
}

interface Ctx { dados: RespAvatares | null; recarregar: () => Promise<void>; trocarDesenho: (tipo: TipoPessoa, id: string) => Promise<void> }
const AvatarCtx = createContext<Ctx>({ dados: null, recarregar: async () => {}, trocarDesenho: async () => {} });

export function ProvedorAvatares({ children }: { children: ReactNode }) {
  const [dados, setDados] = useState<RespAvatares | null>(null);
  const recarregar = useCallback(async () => {
    try { setDados(await api.get<RespAvatares>('/cadastro/avatares')); } catch { /* sem rosto, ficam as caricaturas */ }
  }, []);
  useEffect(() => { void recarregar(); }, [recarregar]);
  const trocarDesenho = useCallback(async (tipo: TipoPessoa, id: string) => {
    const atual = tipo === 'CLT' ? dados?.empregados[id]?.semente : dados?.prestadores[id]?.semente;
    const nova = ((atual ?? hash(id)) + 1 + Math.floor(Math.random() * 97)) % 100000;
    // Otimista: troca na hora e grava em seguida.
    setDados((d) => d && (tipo === 'CLT'
      ? { ...d, empregados: { ...d.empregados, [id]: { ...(d.empregados[id] ?? vazio()), semente: nova } } }
      : { ...d, prestadores: { ...d.prestadores, [id]: { semente: nova } } }));
    await api.put('/cadastro/avatar', { tipo, id, semente: nova });
  }, [dados]);
  const v = useMemo(() => ({ dados, recarregar, trocarDesenho }), [dados, recarregar, trocarDesenho]);
  return <AvatarCtx.Provider value={v}>{children}</AvatarCtx.Provider>;
}
const vazio = (): InfoAvatarClt => ({ foto: null, status: null, motivo: null, enviadaEm: null, origem: null, semente: null, temApp: false, cadastroEm: null });
export const useAvatares = () => useContext(AvatarCtx);

/** Número estável a partir do id (FNV-1a). */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const FUNDOS = ['#CFE3DD', '#FFE2D1', '#E7F0C8', '#DDE6F5', '#F3E3F0', '#FCEFCE', '#E2EEF0', '#EFE6DA'];
const PELES = ['#F3D0B4', '#E8B993', '#D9A27C', '#C68B63', '#A5704E', '#8A5A3E', '#6E4630'];
const CABELOS = ['#1E120C', '#3A2418', '#5E3A1E', '#8A6A44', '#B5391F', '#2B2B2B', '#B9AE9E'];
const ROUPAS = ['#10403F', '#FF6B4A', '#5C4F49', '#2F5B8A', '#0B7A4B', '#8A5A12', '#7A4FA0'];

function escurecer(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (x: number) => Math.max(0, Math.round(x * f)).toString(16).padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/** Desenho do rosto a partir da semente: fundo, pele, cabelo, roupa e penteado. */
export function Caricatura({ semente }: { semente: number }) {
  let s = semente >>> 0 || 1;
  const prox = (n: number) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s >>> 8) % n; };
  const fundo = FUNDOS[prox(FUNDOS.length)]!;
  const pele = PELES[prox(PELES.length)]!;
  const cabelo = CABELOS[prox(CABELOS.length)]!;
  const roupa = ROUPAS[prox(ROUPAS.length)]!;
  const estilo = prox(7);
  const sorriso = prox(3);
  const oculos = prox(6) === 0;
  const olho = escurecer(pele, 0.25);
  const boca = escurecer(pele, 0.45);
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <rect width="100" height="100" fill={fundo} />
      {estilo === 1 && <path d="M28 50c-3-24 8-34 22-34s26 10 22 34v26H28z" fill={cabelo} />}
      {estilo === 4 && <path d="M27 56c-4-26 8-38 23-38s27 12 23 38c2 10-2 20-8 22H35c-6-2-10-12-8-22z" fill={cabelo} />}
      {estilo === 6 && <circle cx="50" cy="18" r="10" fill={cabelo} />}
      <path d="M14 104c2-20 17-30 36-30s34 10 36 30z" fill={roupa} />
      <rect x="42" y="58" width="16" height="16" rx="6" fill={escurecer(pele, 0.9)} />
      <ellipse cx="50" cy="44" rx="19" ry="22" fill={pele} />
      {estilo === 0 && <path d="M30 42c0-16 9-24 20-24s21 8 21 22c-5-6-13-9-21-9s-14 4-20 11z" fill={cabelo} />}
      {estilo === 1 && <path d="M31 40c2-13 10-20 19-20s17 7 19 20c-6-6-12-8-19-8s-13 2-19 8z" fill={cabelo} />}
      {estilo === 2 && <path d="M31 38c2-12 10-18 19-18s17 6 19 18c-6-4-12-6-19-6s-13 2-19 6z" fill={cabelo} />}
      {estilo === 3 && <path d="M31 36c3-10 10-15 19-15s16 5 19 15c-6-2-12-3-19-3s-13 1-19 3z" fill={cabelo} />}
      {estilo === 4 && <path d="M30 42c1-14 9-22 20-22s19 8 20 22c-4-8-11-12-20-12s-16 4-20 12z" fill={cabelo} />}
      {estilo === 5 && <path d="M32 33c4-7 10-10 18-10s14 3 18 10c-5-1-11-2-18-2s-13 1-18 2z" fill={cabelo} opacity=".85" />}
      {estilo === 6 && <path d="M31 40c1-13 9-21 19-21s18 8 19 21c-5-7-11-10-19-10s-14 3-19 10z" fill={cabelo} />}
      <circle cx="43" cy="44" r="2.1" fill={olho} />
      <circle cx="57" cy="44" r="2.1" fill={olho} />
      {oculos && <g fill="none" stroke="#2B2B2B" strokeWidth="1.8"><circle cx="43" cy="44" r="5.5" /><circle cx="57" cy="44" r="5.5" /><path d="M48.5 44h3" /></g>}
      {sorriso === 0 && <path d="M42 53c4 4 12 4 16 0" stroke={boca} strokeWidth="2.4" fill="none" strokeLinecap="round" />}
      {sorriso === 1 && <path d="M42 52c4 6 12 6 16 0z" fill={boca} />}
      {sorriso === 2 && <path d="M43 54c3 2 11 2 14 0" stroke={boca} strokeWidth="2.4" fill="none" strokeLinecap="round" />}
    </svg>
  );
}

/** Rosto pronto: foto se houver, senão a caricatura da pessoa. */
export function Avatar({ id, nome, tipo = 'CLT', tamanho = 36, className, titulo, trocavel }: {
  id: string; nome: string; tipo?: TipoPessoa; tamanho?: number; className?: string; titulo?: boolean;
  /** Sem foto, clicar no desenho sorteia outro (RH). */
  trocavel?: boolean;
}) {
  const { dados, trocarDesenho } = useAvatares();
  const info = tipo === 'CLT' ? dados?.empregados[id] : dados?.prestadores[id];
  const foto = tipo === 'CLT' ? (info as InfoAvatarClt | undefined)?.foto ?? null : null;
  const semente = info?.semente ?? hash(id);
  const estilo = { width: tamanho, height: tamanho, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', background: '#E2EEF0' } as const;
  if (trocavel && !foto) {
    return (
      <button type="button" className={className} style={{ ...estilo, border: 'none', padding: 0, cursor: 'pointer' }}
        title="Trocar desenho" aria-label={`Trocar o desenho de ${nome}`}
        onClick={(ev) => { ev.stopPropagation(); void trocarDesenho(tipo, id); }} onKeyDown={(ev) => ev.stopPropagation()}>
        <Caricatura semente={semente} />
      </button>
    );
  }
  return (
    <span className={className} style={estilo} title={titulo ? nome : undefined} role="img" aria-label={foto ? `Foto de ${nome}` : `Desenho de ${nome}`}>
      {foto
        ? <img src={foto} alt="" width={tamanho} height={tamanho} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        : <Caricatura semente={semente} />}
    </span>
  );
}
