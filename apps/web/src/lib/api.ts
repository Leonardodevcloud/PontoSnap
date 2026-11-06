const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';
const CHAVE_REFRESH = 'pontosnap.refresh';

let acesso: string | null = null;

export function definirAcesso(token: string | null) { acesso = token; limparCacheGet(); }
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

// --- Cache de GET: deixa a navegação instantânea. ---
// Guarda a resposta de cada GET por alguns segundos e junta chamadas idênticas em voo.
// Qualquer escrita (POST/PATCH/PUT/DELETE) limpa o cache, então depois de editar algo os
// próximos GET voltam a buscar do servidor. Telas que precisam de dado ao vivo seguem
// pedindo normalmente — o cache é curto.
const TTL_GET = 15_000;
const cacheGet = new Map<string, { quando: number; dado: unknown }>();
const emVooGet = new Map<string, Promise<unknown>>();

/** Esquece o que estiver no cache (por prefixo, ou tudo). Chamado em toda escrita. */
export function limparCacheGet(prefixo?: string) {
  if (!prefixo) { cacheGet.clear(); return; }
  for (const k of cacheGet.keys()) if (k.startsWith(prefixo)) cacheGet.delete(k);
}

function obterGet<T>(p: string): Promise<T> {
  const c = cacheGet.get(p);
  if (c && Date.now() - c.quando < TTL_GET) return Promise.resolve(c.dado as T);
  const voo = emVooGet.get(p);
  if (voo) return voo as Promise<T>;
  const prom = rastrear(req<T>(p)).then(
    (d) => { cacheGet.set(p, { quando: Date.now(), dado: d }); emVooGet.delete(p); return d; },
    (e) => { emVooGet.delete(p); throw e; },
  );
  emVooGet.set(p, prom as Promise<unknown>);
  return prom;
}

export const api = {
  get: <T>(p: string) => obterGet<T>(p),
  post: <T>(p: string, body?: unknown) => { limparCacheGet(); return rastrear(req<T>(p, { method: 'POST', body })); },
  patch: <T>(p: string, body?: unknown) => { limparCacheGet(); return rastrear(req<T>(p, { method: 'PATCH', body })); },
  del: <T>(p: string, body?: unknown) => { limparCacheGet(); return rastrear(req<T>(p, { method: 'DELETE', body })); },
  put: <T>(p: string, body?: unknown) => { limparCacheGet(); return rastrear(req<T>(p, { method: 'PUT', body })); },
  /** POST que devolve a resposta crua (para ler o corpo em fluxo, ex.: a voz da Pri). */
  async fluxo(path: string, body: unknown, retry = true): Promise<Response> {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(acesso ? { Authorization: `Bearer ${acesso}` } : {}) },
      body: JSON.stringify(body),
    });
    if (res.status === 401 && retry && (await tentarRefresh())) return this.fluxo(path, body, false);
    if (!res.ok) throw new Error(`voz ${res.status}`);
    return res;
  },
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
  /** Como baixar(), mas via POST com corpo JSON (ex.: gerar ZIP em lote). */
  baixarPost(path: string, body: unknown): Promise<Blob> { return rastrear(this._baixarPost(path, body)); },
  async _baixarPost(path: string, body: unknown): Promise<Blob> {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(acesso ? { Authorization: `Bearer ${acesso}` } : {}) },
      body: JSON.stringify(body),
    });
    if (res.status === 401 && (await tentarRefresh())) return this._baixarPost(path, body);
    if (!res.ok) {
      const msg = await res.json().then((j) => j.message).catch(() => null);
      throw new Error(msg ?? 'Não consegui gerar o arquivo.');
    }
    return res.blob();
  },
  /** Envia um FormData pronto (vários arquivos/campos). */
  enviarForm<T>(path: string, fd: FormData): Promise<T> { return rastrear(this._enviarForm<T>(path, fd)); },
  async _enviarForm<T>(path: string, fd: FormData): Promise<T> {
    const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: acesso ? { Authorization: `Bearer ${acesso}` } : {}, body: fd });
    if (res.status === 401 && (await tentarRefresh())) return this._enviarForm<T>(path, fd);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Falha no envio.');
    }
    return res.json() as Promise<T>;
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
