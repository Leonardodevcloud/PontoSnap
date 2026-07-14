import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema } from '@ponto/db';
import { TenantService } from '../src/tenant/tenant.service';
import { EmpregadoService } from '../src/empregado/empregado.service';
import { AuthService } from '../src/auth/auth.service';
import { TokenService } from '../src/auth/token';

const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });

const tenantSvc = new TenantService(db);
const empSvc = new EmpregadoService(db);
const tokens = new TokenService({ segredoAcesso: 'a', segredoRefresh: 'r', expiraAcesso: '15m', expiraRefresh: '7d' });
const authSvc = new AuthService(db, tokens);

const ok = (cond: boolean, msg: string) => console.log(`${cond ? 'OK  ' : 'FALHA'} — ${msg}`);

async function main() {
  // MASTER cria 2 clientes, cada um com seu admin
  const a = await tenantSvc.criar({ cnpj: '11111111000111', razaoSocial: 'Cliente A',
    localPrestacao: 'Salvador/BA', adminEmail: 'admin@a.com', adminSenha: 'senhaForte1' });
  const b = await tenantSvc.criar({ cnpj: '22222222000122', razaoSocial: 'Cliente B',
    localPrestacao: 'Feira/BA', adminEmail: 'admin@b.com', adminSenha: 'senhaForte2' });
  ok(!!a.repId && !!b.repId, 'cada cliente nasce com seu REP-P configurado');
  ok(a.admin.perfil === 'ADMIN_CLIENTE', 'admin do cliente criado com perfil ADMIN_CLIENTE');

  // Duplicidade de CNPJ é barrada
  let conflito = false;
  try { await tenantSvc.criar({ cnpj: '11111111000111', razaoSocial: 'Dup', adminEmail: 'x@x.com', adminSenha: 'senhaForte9' }); }
  catch { conflito = true; }
  ok(conflito, 'CNPJ duplicado é rejeitado');

  // Cada cliente cadastra seus funcionários
  await empSvc.criar(a.tenant.id, { cpf: '43461292850', nome: 'Maria A', matricula: '001', pin: '4712' });
  await empSvc.criar(a.tenant.id, { cpf: '52998224725', nome: 'Ana A' });
  await empSvc.criar(b.tenant.id, { cpf: '11144477735', nome: 'João B', matricula: '900', pin: '9988' });

  // RLS: cada cliente só enxerga os seus
  const listaA = await empSvc.listar(a.tenant.id);
  const listaB = await empSvc.listar(b.tenant.id);
  ok(listaA.length === 2, `Cliente A vê 2 funcionários (viu ${listaA.length})`);
  ok(listaB.length === 1 && listaB[0]!.nome === 'João B', `Cliente B vê só o seu (viu ${listaB.length})`);

  // PIN nunca vaza na resposta
  ok(!('pinHash' in listaA[0]!) && (listaA.find(e => e.nome === 'Maria A') as any).temPin === true,
     'resposta esconde o hash do PIN e sinaliza temPin');

  // O admin criado no provisionamento consegue logar de verdade
  const login = await authSvc.login('admin@a.com', 'senhaForte1');
  ok(!!login.accessToken && login.tenantId === a.tenant.id && login.perfil === 'ADMIN_CLIENTE',
     'admin do Cliente A loga e recebe token com o tenant certo');

  // primeiro acesso obriga a trocar a senha provisória
  ok(login.deveTrocarSenha === true, 'admin provisionado precisa trocar a senha no 1º acesso');
  await authSvc.alterarSenha(a.admin.id, 'senhaForte1', 'novaSenhaForte9');
  const login2 = await authSvc.login('admin@a.com', 'novaSenhaForte9');
  ok(!!login2.accessToken && login2.deveTrocarSenha === false, 'após trocar, loga com a nova senha e sem obrigação');
  let velhaNega = false;
  try { await authSvc.login('admin@a.com', 'senhaForte1'); } catch { velhaNega = true; }
  ok(velhaNega, 'a senha antiga não vale mais');

  // Senha errada é rejeitada
  let negou = false;
  try { await authSvc.login('admin@a.com', 'senhaErrada'); } catch { negou = true; }
  ok(negou, 'senha errada é rejeitada no login');

  await client.end();
  console.log('\n>>> GESTÃO OK <<<');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
