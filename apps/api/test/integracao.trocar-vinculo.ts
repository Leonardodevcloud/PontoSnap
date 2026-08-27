import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema } from '@ponto/db';
import { eq, and } from 'drizzle-orm';
import { TenantService } from '../src/tenant/tenant.service';

const client = postgres({ host: process.env.PGSOCKET!, database:'postgres', user:'app_user', password:'x', max:5 });
const db = drizzle(client, { schema });
const tenants = new TenantService(db, { enviar: async()=>true } as never);
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c?'OK  ':'FALHA'} — ${m}`); };

async function main() {
  const { comoMaster } = await import('@ponto/db');
  // duas empresas
  const { tenant:tIG } = await tenants.criar({ cnpj:'11111111000191', razaoSocial:'IG', localPrestacao:'BA', adminEmail:'ig@x.com' }) as any;
  const { tenant:tFIIX } = await tenants.criar({ cnpj:'22222222000191', razaoSocial:'FIIX', localPrestacao:'BA', adminEmail:'fiix@x.com' }) as any;

  // uma conta admin com vínculo RH nas duas
  const uid = crypto.randomUUID();
  await comoMaster(db, (tx) => tx.insert(schema.usuario).values({ id: uid, tenantId: tIG.id, email:'adm@x.com', senhaHash:'x', perfil:'ADMIN_CLIENTE', nome:'Adm' } as never));
  const vIG = crypto.randomUUID(), vFIIX = crypto.randomUUID();
  await comoMaster(db, (tx) => tx.insert(schema.usuarioTenant).values({ id: vIG, usuarioId: uid, tenantId: tIG.id, perfil:'RH' } as never));
  await comoMaster(db, (tx) => tx.insert(schema.usuarioTenant).values({ id: vFIIX, usuarioId: uid, tenantId: tFIIX.id, perfil:'RH' } as never));

  // troca SÓ o vínculo da IG pra Admin
  await tenants.trocarPerfilVinculo(vIG, 'ADMIN_CLIENTE');

  const ig = (await comoMaster(db, (tx) => tx.select({p:schema.usuarioTenant.perfil}).from(schema.usuarioTenant).where(eq(schema.usuarioTenant.id, vIG))))[0];
  const fiix = (await comoMaster(db, (tx) => tx.select({p:schema.usuarioTenant.perfil}).from(schema.usuarioTenant).where(eq(schema.usuarioTenant.id, vFIIX))))[0];

  ok(ig?.p === 'ADMIN_CLIENTE', `IG virou Admin (${ig?.p})`);
  ok(fiix?.p === 'RH', `FIIX continua RH — não foi afetado (${fiix?.p})`);

  // agora troca FIIX também
  await tenants.trocarPerfilVinculo(vFIIX, 'ADMIN_CLIENTE');
  const fiix2 = (await comoMaster(db, (tx) => tx.select({p:schema.usuarioTenant.perfil}).from(schema.usuarioTenant).where(eq(schema.usuarioTenant.id, vFIIX))))[0];
  ok(fiix2?.p === 'ADMIN_CLIENTE', `FIIX agora também Admin (${fiix2?.p})`);

  // reversível: IG volta pra RH
  await tenants.trocarPerfilVinculo(vIG, 'RH');
  const igVolta = (await comoMaster(db, (tx) => tx.select({p:schema.usuarioTenant.perfil}).from(schema.usuarioTenant).where(eq(schema.usuarioTenant.id, vIG))))[0];
  ok(igVolta?.p === 'RH', `IG reversível pra RH (${igVolta?.p})`);

  console.log(falhas===0?'\n>>> TROCAR-VINCULO OK <<<':`\n>>> ${falhas} FALHA(S) <<<`);
  await client.end(); process.exit(falhas===0?0:1);
}
main().catch(e=>{console.error(e);process.exit(1);});
