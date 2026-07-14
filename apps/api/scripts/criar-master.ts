import 'reflect-metadata';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { criarDb, comoMaster, usuario } from '@ponto/db';

/**
 * Cria o primeiro usuário MASTER da plataforma (bootstrap).
 * Uso: DATABASE_URL=... MASTER_EMAIL=... MASTER_SENHA=... pnpm --filter @ponto/api exec tsx scripts/criar-master.ts
 */
async function main() {
  const url = process.env.DATABASE_URL;
  const email = process.env.MASTER_EMAIL;
  const senha = process.env.MASTER_SENHA;
  if (!url || !email || !senha) {
    console.error('Defina DATABASE_URL, MASTER_EMAIL e MASTER_SENHA.');
    process.exit(1);
  }
  const db = criarDb(url);
  await comoMaster(db, async (tx) => {
    const existe = await tx.select().from(usuario).where(eq(usuario.email, email)).limit(1);
    if (existe[0]) { console.log('MASTER já existe:', email); return; }
    const senhaHash = await bcrypt.hash(senha, 12);
    await tx.insert(usuario).values({ email, senhaHash, perfil: 'MASTER', tenantId: null });
    console.log('MASTER criado:', email);
  });
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
