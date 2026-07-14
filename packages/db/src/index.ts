import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema/index';

export * from './schema/index';
export { schema };

export type Db = ReturnType<typeof criarDb>;

/** Cria o cliente Drizzle. A conexão deve usar um role com RLS aplicada. */
export function criarDb(url: string) {
  const client = postgres(url, { max: 10 });
  return drizzle(client, { schema });
}

/**
 * Executa uma função dentro de uma transação COM o tenant fixado na sessão.
 * As policies de RLS leem `app.current_tenant` para isolar os dados.
 *
 * Uso: await comTenant(db, tenantId, (tx) => tx.select().from(empregado));
 */
export async function comTenant<T>(
  db: Db,
  tenantId: string,
  fn: (tx: Parameters<Parameters<Db['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`);
    return fn(tx);
  });
}

/** Executa como MASTER (ignora o isolamento de tenant nas policies). */
export async function comoMaster<T>(
  db: Db,
  fn: (tx: Parameters<Parameters<Db['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.is_master', 'on', true)`);
    return fn(tx);
  });
}
