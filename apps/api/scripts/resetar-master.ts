import 'reflect-metadata';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { criarDb, comoMaster, usuario } from '@ponto/db';

/**
 * Lista os MASTER da plataforma e, se pedido, troca a senha de um deles.
 *
 * Só listar (descobrir o e-mail):
 *   DATABASE_URL=... pnpm --filter @ponto/api exec tsx scripts/resetar-master.ts
 *
 * Trocar a senha:
 *   DATABASE_URL=... MASTER_EMAIL=... MASTER_SENHA=... pnpm --filter @ponto/api exec tsx scripts/resetar-master.ts
 *
 * Use a URL do ADMIN: o MASTER não tem tenant e a RLS o esconderia.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  const email = process.env.MASTER_EMAIL;
  const senha = process.env.MASTER_SENHA;
  if (!url) {
    console.error('Defina DATABASE_URL (a do ADMIN).');
    process.exit(1);
  }

  const db = criarDb(url);
  await comoMaster(db, async (tx) => {
    const masters = await tx.select().from(usuario).where(eq(usuario.perfil, 'MASTER'));

    if (masters.length === 0) {
      console.log('Nenhum MASTER no banco. Use o criar-master.ts.');
      return;
    }

    console.log(`\nMASTER cadastrado${masters.length > 1 ? 's' : ''}:`);
    for (const m of masters) {
      console.log(`  · ${m.email}${m.ativo === false ? '  (INATIVO)' : ''}`);
    }

    if (!senha) {
      console.log('\nPara trocar a senha, rode de novo com MASTER_EMAIL e MASTER_SENHA.');
      return;
    }
    if (senha.length < 8) {
      console.error('\nSenha muito curta (mínimo 8).');
      process.exitCode = 1;
      return;
    }

    const alvo = email
      ? masters.find((m) => m.email === email)
      : masters.length === 1 ? masters[0] : undefined;

    if (!alvo) {
      console.error(email
        ? `\nNão achei o MASTER "${email}".`
        : '\nHá mais de um MASTER: informe MASTER_EMAIL.');
      process.exitCode = 1;
      return;
    }

    const senhaHash = await bcrypt.hash(senha, 12);
    // Reativa e não exige troca: é você mesmo definindo a senha agora.
    await tx.update(usuario)
      .set({ senhaHash, ativo: true, deveTrocarSenha: false })
      .where(eq(usuario.id, alvo.id));
    console.log(`\nSenha trocada para: ${alvo.email}`);
  });
  process.exit(process.exitCode ?? 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
