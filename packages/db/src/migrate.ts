/**
 * Aplica as migrations em produção. Roda com o role ADMIN/owner do banco
 * (não com o role da aplicação, que é restrito e não cria tabelas).
 *
 * Uso: DATABASE_URL=... pnpm --filter @ponto/db migrate:prod
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

async function main() {
  // As migrations criam tabelas/policies → exigem o role ADMIN/owner.
  // A API roda com um role restrito (sem DDL), então aqui preferimos
  // DATABASE_URL_ADMIN quando ela existir.
  const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('Defina DATABASE_URL_ADMIN (ou DATABASE_URL) para aplicar as migrations.');
    process.exit(1);
  }

  const pasta = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  const client = postgres(url, { max: 1 });
  try {
    console.log(`Aplicando migrations de ${pasta}…`);
    await migrate(drizzle(client), { migrationsFolder: pasta });
    console.log('Migrations aplicadas com sucesso.');
  } catch (e) {
    console.error('Falha ao aplicar migrations:', e);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void main();
