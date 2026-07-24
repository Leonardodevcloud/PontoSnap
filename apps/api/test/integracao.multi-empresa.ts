import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { schema, comoMaster, tenant, usuario, usuarioTenant, empregado } from '@ponto/db';
import { AuthService } from '../src/auth/auth.service';
import { TokenService } from '../src/auth/token';
import { TenantService } from '../src/tenant/tenant.service';
import { EmpregadoService } from '../src/empregado/empregado.service';
import { hashSenha } from '../src/auth/senha';

const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const tokens = new TokenService({ segredoAcesso: 'a'.repeat(40), segredoRefresh: 'r'.repeat(40), expiraAcesso: '15m', expiraRefresh: '7d' });
const auth = new AuthService(db, tokens, {} as never);
const tenants = new TenantService(db, { enviar: async () => true } as never);
const empSvc = new EmpregadoService(db as never, {} as never);

let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };

async function main() {
  const senha = await hashSenha('Senha@123');
  const mk = async (cnpj: string, nome: string) =>
    (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj, razaoSocial: nome }).returning()))[0]!;

  const A = await mk('30000000000101', 'Transportes Alfa');
  const B = await mk('30000000000202', 'Alfa Logistica');
  const C = await mk('30000000000303', 'Outro Cliente Gama');

  // um funcionário em cada, pra provar o isolamento dos dados
  await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: A.id, cpf: '30000000001', nome: 'Func A' }).returning());
  await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: B.id, cpf: '30000000002', nome: 'Func B' }).returning());
  await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: C.id, cpf: '30000000003', nome: 'Func C' }).returning());

  // Marina: RH na Alfa (padrão) e ADMIN na Logistica. NADA na Gama.
  const marina = (await comoMaster(db, (tx) => tx.insert(usuario).values({
    tenantId: A.id, email: 'marina@grupoalfa.com.br', senhaHash: senha, perfil: 'RH',
  }).returning()))[0]!;
  await tenants.vincularEmpresa(marina.id, A.id, 'RH');
  await tenants.vincularEmpresa(marina.id, B.id, 'ADMIN_CLIENTE');

  // ---- login abre na empresa padrão e lista as empresas ----
  const ses = await auth.login('marina@grupoalfa.com.br', 'Senha@123');
  ok(ses.tenantId === A.id, `login abre na empresa padrão (${ses.tenantId === A.id ? 'Alfa' : ses.tenantId})`);
  ok(ses.empresas.length === 2, `seletor recebe as 2 empresas (${ses.empresas.length})`);
  ok(ses.perfil === 'RH', `papel na Alfa é RH (${ses.perfil})`);

  // ---- troca de empresa: papel muda junto ----
  const naB = await auth.trocarEmpresa(marina.id, B.id);
  ok(naB.tenantId === B.id, 'trocou para a Logistica');
  ok(naB.perfil === 'ADMIN_CLIENTE', `papel na Logistica é ADMIN (${naB.perfil})`);

  // ---- A TRAVA: empresa de outro cliente é recusada ----
  let recusou = false;
  try { await auth.trocarEmpresa(marina.id, C.id); } catch { recusou = true; }
  ok(recusou, 'trocar para empresa SEM vínculo (Gama) é RECUSADO');

  // ---- isolamento real dos dados, empresa por empresa ----
  const naA = tokens.verificarAcesso(ses.accessToken);
  const emB = tokens.verificarAcesso(naB.accessToken);
  const listaA = await empSvc.listar(naA.tenantId!);
  const listaB = await empSvc.listar(emB.tenantId!);
  ok(listaA.length === 1 && listaA[0]!.nome === 'Func A', `na Alfa vê só o funcionário da Alfa (${listaA.map((e) => e.nome).join()})`);
  ok(listaB.length === 1 && listaB[0]!.nome === 'Func B', `na Logistica vê só o da Logistica (${listaB.map((e) => e.nome).join()})`);
  ok(!listaA.some((e) => e.nome === 'Func C') && !listaB.some((e) => e.nome === 'Func C'), 'em nenhuma delas aparece dado da Gama');

  // ---- refresh lembra a empresa ativa ----
  const ref = await auth.refresh(naB.refreshToken);
  ok(ref.tenantId === B.id, `refresh mantém a empresa ativa (${ref.tenantId === B.id ? 'Logistica' : 'voltou pra padrão'})`);

  // ---- retirar o acesso derruba na renovação ----
  const vinculos = await comoMaster(db, (tx) => tx.select().from(usuarioTenant).where(eq(usuarioTenant.usuarioId, marina.id)));
  const vB = vinculos.find((v) => v.tenantId === B.id)!;
  await tenants.desvincularEmpresa(vB.id);
  const depois = await auth.refresh(naB.refreshToken);
  ok(depois.tenantId === A.id, `acesso retirado: renovação já não devolve a Logistica (caiu em ${depois.tenantId === A.id ? 'Alfa' : depois.tenantId})`);

  // ---- colaborador não circula entre empresas ----
  const pedro = (await comoMaster(db, (tx) => tx.insert(usuario).values({
    tenantId: A.id, email: 'pedro@grupoalfa.com.br', senhaHash: senha, perfil: 'COLABORADOR',
  }).returning()))[0]!;
  let barrou = false;
  try { await tenants.vincularEmpresa(pedro.id, B.id, 'RH'); } catch { barrou = true; }
  ok(barrou, 'colaborador NÃO pode ser vinculado a outra empresa');

  // ---- quem tem uma empresa só continua igual ----
  const joao = (await comoMaster(db, (tx) => tx.insert(usuario).values({
    tenantId: C.id, email: 'joao@gama.com.br', senhaHash: senha, perfil: 'ADMIN_CLIENTE',
  }).returning()))[0]!;
  const sesJoao = await auth.login('joao@gama.com.br', 'Senha@123');
  ok(sesJoao.tenantId === C.id && sesJoao.empresas.length === 0, `usuário de empresa única entra normal, sem seletor (${sesJoao.empresas.length} empresas)`);
  void joao;

  console.log(falhas === 0 ? '\n>>> MULTI-EMPRESA OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
