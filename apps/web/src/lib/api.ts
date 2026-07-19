const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';
const CHAVE_REFRESH = 'pontosnap.refresh';

let acesso: string | null = null;

export function definirAcesso(token: string | null) { acesso = token; }
export function definirRefresh(token: string | null) {
  if (token) localStorage.setItem(CHAVE_REFRESH, token);
  else localStorage.removeItem(CHAVE_REFRESH);
}
export function obterRefresh(): string | null { return localStorage.getItem(CHAVE_REFRESH); }

// --- Sinal de "tem requisição em voo" para a barra de progresso global ---
let emVoo = 0;
const ouvintes = new Set<(ativo: boolean) => void>();
function notificar() { const ativo = emVoo > 0; for (const f of ouvintes) f(ativo); }
/** Inscreve-se no estado de carregamento. Devolve a função de cancelamento. */
export function aoCarregar(f: (ativo: boolean) => void): () => void { ouvintes.add(f); return () => { ouvintes.delete(f); }; }
async function rastrear<T>(p: Promise<T>): Promise<T> {
  emVoo++; if (emVoo === 1) notificar();
  try { return await p; }
  finally { emVoo = Math.max(0, emVoo - 1); if (emVoo === 0) notificar(); }
}

async function tentarRefresh(): Promise<boolean> {
  const rt = obterRefresh();
  if (!rt) return false;
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    acesso = data.accessToken;
    return true;
  } catch { return false; }
}

interface Opts { method?: string; body?: unknown; }

async function req<T>(path: string, opts: Opts = {}, retry = true): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(acesso ? { Authorization: `Bearer ${acesso}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && retry && (await tentarRefresh())) return req<T>(path, opts, false);

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message ?? 'Não rolou. Tenta de novo.');
  }
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('application/json') ? res.json() : (res as unknown)) as T;
}

export const api = {
  get: <T>(p: string) => rastrear(req<T>(p)),
  post: <T>(p: string, body?: unknown) => rastrear(req<T>(p, { method: 'POST', body })),
  patch: <T>(p: string, body?: unknown) => rastrear(req<T>(p, { method: 'PATCH', body })),
  del: <T>(p: string) => rastrear(req<T>(p, { method: 'DELETE' })),
  /** Baixa binário (ex.: comprovante PDF) já com o token. */
  baixar(path: string): Promise<Blob> { return rastrear(this._baixar(path)); },
  async _baixar(path: string): Promise<Blob> {
    const res = await fetch(`${BASE}${path}`, { headers: acesso ? { Authorization: `Bearer ${acesso}` } : {} });
    if (res.status === 401 && (await tentarRefresh())) return this._baixar(path);
    if (!res.ok) {
      const msg = await res.json().then((j) => j.message).catch(() => null);
      throw new Error(msg ?? 'Não consegui baixar o arquivo.');
    }
    return res.blob();
  },
  /** Envia um arquivo (multipart). Não seta Content-Type: o browser põe o boundary. */
  enviarArquivo<T>(path: string, arquivo: File, campo = 'arquivo'): Promise<T> { return rastrear(this._enviarArquivo<T>(path, arquivo, campo)); },
  async _enviarArquivo<T>(path: string, arquivo: File, campo = 'arquivo'): Promise<T> {
    const fd = new FormData();
    fd.append(campo, arquivo);
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: acesso ? { Authorization: `Bearer ${acesso}` } : {},
      body: fd,
    });
    if (res.status === 401 && (await tentarRefresh())) return this._enviarArquivo<T>(path, arquivo, campo);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Falha no envio.');
    }
    return res.json() as Promise<T>;
  },
};

export { BASE };
