/**
 * Fila de batidas capturadas sem rede.
 *
 * Guarda no IndexedDB (sobrevive a recarregar e a fechar o app) a batida com a
 * hora do RELÓGIO DO APARELHO no instante do toque. Quando a rede volta, envia
 * cada uma marcada como offline — o servidor decide a hora final e sinaliza
 * divergência. Nada é perdido, e o funcionário não fica refém do sinal.
 */

export interface BatidaPendente {
  id: string;
  /** ISO da hora do aparelho quando bateu. */
  dtAparelho: string;
  coletor: number;
  latitude?: number;
  longitude?: number;
  observacao?: string;
}

const DB = 'pontosnap', STORE = 'fila';

function abrir(): Promise<IDBDatabase> {
  return new Promise((ok, erro) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => erro(req.error);
  });
}

async function tx<T>(modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await abrir();
  return new Promise((ok, erro) => {
    const t = db.transaction(STORE, modo);
    const r = fn(t.objectStore(STORE));
    r.onsuccess = () => ok(r.result);
    r.onerror = () => erro(r.error);
  });
}

export async function enfileirar(b: BatidaPendente): Promise<void> {
  await tx('readwrite', (s) => s.put(b));
}

export async function pendentes(): Promise<BatidaPendente[]> {
  return (await tx<BatidaPendente[]>('readonly', (s) => s.getAll())) ?? [];
}

export async function remover(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

export async function contar(): Promise<number> {
  return (await tx<number>('readonly', (s) => s.count())) ?? 0;
}

/**
 * Tenta enviar tudo que está na fila. Devolve quantas subiram.
 * `enviar` deve lançar em falha de rede — aí a batida fica para a próxima.
 */
export async function sincronizar(
  enviar: (b: BatidaPendente) => Promise<void>,
): Promise<{ enviadas: number; restantes: number }> {
  const fila = await pendentes();
  let enviadas = 0;
  for (const b of fila) {
    try {
      await enviar(b);
      await remover(b.id);
      enviadas++;
    } catch {
      // Rede ainda instável: para na primeira falha e mantém a ordem.
      break;
    }
  }
  return { enviadas, restantes: await contar() };
}
