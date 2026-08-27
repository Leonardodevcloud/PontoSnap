import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema } from '@ponto/db';
import { eq } from 'drizzle-orm';
import { TenantService } from '../src/tenant/tenant.service';

const client = postgres({ host: process.env.PGSOCKET!, database:'postgres', user:'app_user', password:'x', max:5 });
const db = drizzle(client, { schema });
const tenants = new TenantService(db, { enviar: async()=>true } as never);
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c?'OK  ':'FALHA'} — ${m}`); };

async function main() {
  // cria empresa (gera admin ADMIN_CLIENTE). Depois cria um RH.
  const { tenant:t, usuarioDono } = await tenants.criar({ cnpj:'12121212000199', razaoSocial:'IG', localPrestacao:'BA', adminEmail:'admin@ig.com' }) as any;

  // cria um usuário RH direto no banco (simula o que você fez)
  const rhId = crypto.randomUUID();
  const { comoMaster } = await import('@ponto/db');
  await comoMaster(db, (tx) => tx.insert(schema.usuario).values({
    id: rhId, tenantId: t.id, email:'rh@ig.com', senhaHash:'x', perfil:'RH', nome:'RH',
  } as never));
  await comoMaster(db, (tx) => tx.insert(schema.usuarioTenant).values({
    usuarioId: rhId, tenantId: t.id, perfil:'RH',
  } as never));

  // antes: é RH
  const antes = (await comoMaster(db, (tx) => tx.select({perfil:schema.usuario.perfil}).from(schema.usuario).where(eq(schema.usuario.id, rhId))))[0];
  ok(antes?.perfil === 'RH', `antes: conta é RH (${antes?.perfil})`);

  // TROCA pra ADMIN
  const r = await tenants.trocarPerfilConta(rhId, 'ADMIN_CLIENTE');
  ok(r.perfil === 'ADMIN_CLIENTE', 'retorno confirma ADMIN_CLIENTE');

  // depois: conta E vínculo viraram ADMIN
  const contaDepois = (await comoMaster(db, (tx) => tx.select({perfil:schema.usuario.perfil}).from(schema.usuario).where(eq(schema.usuario.id, rhId))))[0];
  const vincDepois = (await comoMaster(db, (tx) => tx.select({perfil:schema.usuarioTenant.perfil}).from(schema.usuarioTenant).where(eq(schema.usuarioTenant.usuarioId, rhId))))[0];
  ok(contaDepois?.perfil === 'ADMIN_CLIENTE', `conta virou ADMIN (${contaDepois?.perfil})`);
  ok(vincDepois?.perfil === 'ADMIN_CLIENTE', `vínculo virou ADMIN (${vincDepois?.perfil})`);

  // volta pra RH também funciona
  await tenants.trocarPerfilConta(rhId, 'RH');
  const voltou = (await comoMaster(db, (tx) => tx.select({perfil:schema.usuario.perfil}).from(schema.usuario).where(eq(schema.usuario.id, rhId))))[0];
  ok(voltou?.perfil === 'RH', 'volta pra RH funciona (reversível)');

  // colaborador NÃO pode ser convertido
  const colabId = crypto.randomUUID();
  await comoMaster(db, (tx) => tx.insert(schema.usuario).values({ id: colabId, tenantId: t.id, email:'c@ig.com', senhaHash:'x', perfil:'COLABORADOR', nome:'C' } as never));
  let bloqueou = false;
  try { await tenants.trocarPerfilConta(colabId, 'ADMIN_CLIENTE'); } catch { bloqueou = true; }
  ok(bloqueou, 'colaborador não pode virar admin (bloqueado)');

  console.log(falhas===0?'\n>>> TROCAR-PERFIL OK <<<':`\n>>> ${falhas} FALHA(S) <<<`);
  await client.end(); process.exit(falhas===0?0:1);
}
main().catch(e=>{console.error(e);process.exit(1);});
