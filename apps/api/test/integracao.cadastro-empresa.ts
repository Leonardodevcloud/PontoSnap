import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { schema, comoMaster, usuario } from '@ponto/db';
import { TenantService } from '../src/tenant/tenant.service';
import { AuthService } from '../src/auth/auth.service';
import { TokenService } from '../src/auth/token';
import { hashSenha } from '../src/auth/senha';

const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });

const enviados: { para: string; assunto: string; html: string }[] = [];
const emailFake = { enviar: async (e: { para: string; assunto: string; html: string }) => { enviados.push(e); return true; } };
const tenants = new TenantService(db, emailFake as never);
const tokens = new TokenService({ segredoAcesso: 'a'.repeat(40), segredoRefresh: 'r'.repeat(40), expiraAcesso: '15m', expiraRefresh: '7d' });
const auth = new AuthService(db, tokens, {} as never);

let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };

async function main() {
  // ---- Caminho A: cliente novo ----
  const r1 = await tenants.criar({
    cnpj: '40000000000101', razaoSocial: 'Transportes Alfa',
    adminEmail: 'marina@grupoalfa.com.br', adminNome: 'Marina Souza',
  });
  ok(!!r1.senhaProvisoria && r1.senhaProvisoria.length >= 8, `senha provisória gerada pelo sistema (${r1.senhaProvisoria?.length} chars)`);
  ok(r1.emailEnviado === true, 'e-mail de boas-vindas enviado');
  ok(enviados[0]?.para === 'marina@grupoalfa.com.br', `e-mail foi pro responsável (${enviados[0]?.para})`);
  ok(enviados[0]!.html.includes(r1.senhaProvisoria!), 'o e-mail leva a senha provisória junto');

  const empresas1 = await auth.empresasDoUsuario(r1.admin.id);
  ok(empresas1.length === 1 && empresas1[0]!.razaoSocial === 'Transportes Alfa', `cadastro já cria o vínculo (${empresas1.length})`);

  // ---- O BUG: ao ganhar a 2ª empresa, a 1ª não pode sumir ----
  const r2 = await tenants.criar({ cnpj: '40000000000202', razaoSocial: 'Alfa Logistica', adminEmail: 'temp@alfa.com.br' });
  await tenants.vincularEmpresa(r1.admin.id, r2.tenant.id, 'RH');
  const empresas2 = await auth.empresasDoUsuario(r1.admin.id);
  const nomes = empresas2.map((e) => e.razaoSocial).sort().join(' + ');
  ok(empresas2.length === 2, `com 2 empresas, as DUAS aparecem no seletor (${nomes})`);
  ok(empresas2.some((e) => e.razaoSocial === 'Transportes Alfa'), 'a PRIMEIRA empresa continua lá (bug corrigido)');

  // ---- Caminho B: nova empresa de um cliente que já existe ----
  const antes = enviados.length;
  const r3 = await tenants.criar({
    cnpj: '40000000000303', razaoSocial: 'Alfa Servicos',
    usuarioExistenteId: r1.admin.id, perfilNaEmpresa: 'ADMIN_CLIENTE',
  });
  ok(r3.senhaProvisoria === null, 'caminho B não cria senha nova');
  ok(enviados.length === antes, 'caminho B não manda e-mail novo');
  const empresas3 = await auth.empresasDoUsuario(r1.admin.id);
  ok(empresas3.length === 3, `a empresa nova entra no seletor dela (${empresas3.length} empresas)`);
  ok(empresas3.find((e) => e.razaoSocial === 'Alfa Servicos')?.perfil === 'ADMIN_CLIENTE', 'com o papel escolhido para aquela empresa');

  // ---- e-mail repetido no caminho A orienta o caminho B ----
  let msg = '';
  try { await tenants.criar({ cnpj: '40000000000404', razaoSocial: 'Outra', adminEmail: 'marina@grupoalfa.com.br' }); }
  catch (e) { msg = (e as Error).message; }
  ok(msg.includes('outra empresa de um cliente meu'), `e-mail repetido orienta o caminho certo ("${msg.slice(0, 60)}…")`);

  // ---- conserto automático de acesso legado (criado sem vínculo) ----
  const legado = (await comoMaster(db, async (tx) => tx.insert(usuario).values({
    tenantId: r1.tenant.id, email: 'legado@alfa.com.br', senhaHash: await hashSenha('Senha@123'), perfil: 'RH',
  }).returning()))[0]!;
  ok((await auth.empresasDoUsuario(legado.id)).length === 0, 'acesso legado começa sem vínculo nenhum');
  await tenants.vincularEmpresa(legado.id, r2.tenant.id, 'RH');
  const empLegado = await auth.empresasDoUsuario(legado.id);
  ok(empLegado.length === 2, `ao ganhar a 2ª, o legado recupera a de origem também (${empLegado.length})`);

  // ---- login do caminho A é obrigado a trocar a senha ----
  const ses = await auth.login('marina@grupoalfa.com.br', r1.senhaProvisoria!);
  ok(ses.deveTrocarSenha === true, 'primeiro login exige troca da senha provisória');
  ok(ses.empresas.length === 3, `o seletor já vem com as 3 empresas (${ses.empresas.length})`);
  void eq;

  console.log(falhas === 0 ? '\n>>> CADASTRO EMPRESA OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
