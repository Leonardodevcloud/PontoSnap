import 'reflect-metadata';
process.env.NODE_ENV = 'test';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { schema, comoMaster, pontoRep, pontoEventoRep, usuario } from '@ponto/db';
import { TenantService } from '../src/tenant/tenant.service';
import { EmailService } from '../src/email/email.service';
import { AuthService } from '../src/auth/auth.service';
import { TokenService } from '../src/auth/token';

/** MASTER corrige o cadastro do cliente: razão/CNPJ/local (registro 2 no AFD) e o e-mail do admin. */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };
async function falha(p: Promise<unknown>) { try { await p; return null; } catch (e) { return (e as Error).message; } }

async function main() {
  const email = new EmailService();
  const svc = new TenantService(db, email);
  const auth = new AuthService(db, new TokenService({ segredoAcesso: 'a', segredoRefresh: 'b', expiraAcesso: '15m', expiraRefresh: '7d' }), email);
  const base = String(Date.now()).slice(-12);
  const c1 = `11${base}`, c2 = `12${base}`, c3 = `13${base}`;
  const a = await svc.criar({ cnpj: c1, razaoSocial: 'Empresa Erada LTDA', adminEmail: `errado.${base}@x.com` });
  const b = await svc.criar({ cnpj: c2, razaoSocial: 'Outra LTDA', adminEmail: `outra.${base}@x.com` });
  const id = a.tenant.id;
  const eventos = async () => (await comoMaster(db, (tx) => tx.select().from(pontoEventoRep).where(eq(pontoEventoRep.tenantId, id)))).length;
  const antes = await eventos();

  const d = await svc.dadosParaEditar(id);
  ok(d.admin?.email === `errado.${base}@x.com`, 'dados para editar trazem o e-mail do admin');
  ok(!!(await falha(svc.editarDados(id, { cnpj: c2 }))), 'CNPJ de outro cliente é recusado');
  const r = await svc.editarDados(id, { cnpj: c3, razaoSocial: 'Empresa Certa LTDA', localPrestacao: 'SALVADOR/BA' });
  const rep = (await comoMaster(db, (tx) => tx.select().from(pontoRep).where(eq(pontoRep.tenantId, id))))[0]!;
  ok(r.cnpj === c3 && r.razaoSocial === 'Empresa Certa LTDA' && r.eventoAfd, 'razão social e CNPJ corrigidos');
  ok(rep.documentoEmpregador === c3 && rep.razaoSocial === 'Empresa Certa LTDA', 'REP-P acompanha a correção');
  ok((await eventos()) === antes + 1, 'alteração gravada como registro tipo 2 no AFD');
  const r2 = await svc.editarDados(id, { cnpj: c3 });
  ok(!r2.eventoAfd && (await eventos()) === antes + 1, 'salvar sem mudança não gera evento');

  ok(!!(await falha(svc.alterarEmailAdmin(id, `outra.${base}@x.com`, false))), 'e-mail já usado por outro acesso é recusado');
  const e1 = await svc.alterarEmailAdmin(id, `Certo.${base}@X.com`, true);
  ok(e1.email === `certo.${base}@x.com` && !!e1.senhaProvisoria, 'e-mail do admin trocado e acesso reenviado com senha nova');
  const login = await auth.login(`certo.${base}@x.com`, e1.senhaProvisoria!);
  ok(login.tenantId === id, 'admin entra com o e-mail novo e a senha provisória');
  const u = (await comoMaster(db, (tx) => tx.select().from(usuario).where(eq(usuario.email, `errado.${base}@x.com`))));
  ok(u.length === 0 && !!b, 'e-mail antigo deixou de existir');

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo');
  await client.end(); process.exit(falhas ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await client.end(); process.exit(1); });
