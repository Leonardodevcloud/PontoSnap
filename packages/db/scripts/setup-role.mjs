/**
 * Cria (ou atualiza) o role restrito da aplicação.
 *
 * Por que existe: a aba "Query" do Railway anexa um LIMIT ao comando e só
 * funciona para SELECT — não dá para criar role por lá.
 *
 * Rode com a URL do ADMIN (DATABASE_PUBLIC_URL do Railway), depois que as
 * migrations já criaram as tabelas:
 *
 *   DATABASE_URL=... PONTO_APP_SENHA=... node packages/db/scripts/setup-role.mjs
 *
 * É idempotente: se o role já existir, troca a senha e reforça os atributos.
 */
import postgres from 'postgres';

const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
const senha = process.env.PONTO_APP_SENHA;

if (!url || !senha) {
  console.error('Defina DATABASE_URL (do ADMIN) e PONTO_APP_SENHA.');
  process.exit(1);
}
// A credencial da app é a fronteira de segurança real: quem a tiver lê os dados
// de todos os clientes. Senha fraca aqui não é detalhe.
if (senha.length < 16 || /^[0-9]+$/.test(senha)) {
  console.error("Senha fraca. Gere com: node -e \"console.log(require('crypto').randomBytes(18).toString('base64url'))\"");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });
const ATRIBUTOS = 'LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT';

try {
  const existe = await sql`SELECT 1 FROM pg_roles WHERE rolname = 'ponto_app'`;

  if (existe.length) {
    await sql.unsafe(`ALTER ROLE ponto_app WITH ${ATRIBUTOS} PASSWORD ${literal(senha)}`);
    console.log('Role ponto_app já existia — senha e atributos atualizados.');
  } else {
    await sql.unsafe(`CREATE ROLE ponto_app WITH ${ATRIBUTOS} PASSWORD ${literal(senha)}`);
    console.log('Role ponto_app criado.');
  }

  await sql.unsafe(`GRANT USAGE ON SCHEMA public TO ponto_app`);
  await sql.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ponto_app`);
  await sql.unsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ponto_app`);
  await sql.unsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ponto_app`);
  await sql.unsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ponto_app`);
  console.log('Permissões concedidas (inclusive para tabelas futuras).');

  const [r] = await sql`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'ponto_app'`;
  const [t] = await sql`SELECT count(*)::int AS n FROM information_schema.table_privileges WHERE grantee = 'ponto_app'`;
  console.log('\nConferência:', r);
  console.log(`Tabelas acessíveis: ${t.n > 0 ? 'sim' : 'NENHUMA — rode as migrations antes!'}`);

  if (r.rolsuper || r.rolbypassrls) {
    console.error('\nPERIGO: o role ignora a RLS. NÃO use esta URL na API.');
    process.exitCode = 1;
  } else {
    console.log('\nOK — o role respeita a RLS. Pode usar na DATABASE_URL da API.');
  }
} catch (e) {
  console.error('FALHA:', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}

/** Escapa a senha como literal SQL (aspas simples duplicadas). */
function literal(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}
