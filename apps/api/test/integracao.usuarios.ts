import 'reflect-metadata';
process.env.NODE_ENV = 'test';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { schema, comoMaster, tenant, usuario, usuarioTenant, auditoria } from '@ponto/db';
import { EmailService } from '../src/email/email.service';
import { TokenService } from '../src/auth/token';
import { AuthService } from '../src/auth/auth.service';
import { hashSenha } from '../src/auth/senha';
import { UsuariosService, type Escopo } from '../src/usuarios/usuarios.service';
import { AuditoriaService } from '../src/auditoria/auditoria.service';

/** Vários usuários por empresa: criar, login, escopo do Admin, última Admin, desativar, auditoria por pessoa. */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };
async function falha(p: Promise<unknown>) { try { await p; return null; } catch (e) { return (e as Error).message; } }

async function main() {
  const email = new EmailService();
  const enviados: { para: string; assunto: string; html: string }[] = [];
  (email as unknown as { enviar: (m: { para: string; assunto: string; html: string }) => Promise<boolean> }).enviar = async (m) => { enviados.push(m); return true; };
  const tokens = new TokenService({ segredoAcesso: 'a', segredoRefresh: 'b', expiraAcesso: '15m', expiraRefresh: '7d' });
  const auth = new AuthService(db, tokens, email);
  const svc = new UsuariosService(db, email);
  const aud = new AuditoriaService(db);
  const MASTER: Escopo = { tipo: 'MASTER' };

  const S = String(Date.now()).slice(-10);
  const [A, B, C] = await comoMaster(db, (tx) => tx.insert(tenant).values([
    { cnpj: `71${S}01`, razaoSocial: `Tutts ${S} LTDA` }, { cnpj: `72${S}02`, razaoSocial: `Fiix ${S} LTDA` }, { cnpj: `73${S}03`, razaoSocial: `Fora ${S} LTDA` },
  ]).returning());
  const h = await hashSenha('Senha123!');
  // Admin "antigo": sem vínculo (conta de antes do multi-empresa), só na A.
  const [leo] = await comoMaster(db, (tx) => tx.insert(usuario).values({ tenantId: A!.id, email: `leo.santos.${S}@tutts.com`, senhaHash: h, perfil: 'ADMIN_CLIENTE' }).returning());

  // ── listar ──
  let l = await svc.listar(A!.id, MASTER);
  ok(l.usuarios.length === 1 && l.usuarios[0]!.nome === `Leo Santos ${S}` && !l.usuarios[0]!.nomeDefinido && l.usuarios[0]!.perfil === 'ADMIN_CLIENTE', `conta sem nome: nome vem do e-mail (${l.usuarios[0]?.nome})`);
  ok(l.empresasPossiveis[0]!.id === A!.id && l.empresasPossiveis[0]!.estaEmpresa, 'esta empresa vem primeiro nas opções');

  // ── criar ──
  enviados.length = 0;
  const per = await svc.criar(A!.id, MASTER, { nome: 'Pérola Andrade', email: ` Perola.${S}@Tutts.com `, perfil: 'RH', empresas: [B!.id] });
  ok(per.emailEnviado && per.senhaProvisoria === null && enviados[0]?.para === `perola.${S}@tutts.com` && enviados[0]!.html.includes('Pérola'), 'cria e manda o acesso por e-mail (e-mail normalizado)');
  const senhaP = enviados[0]!.html.match(/letter-spacing:\.02em;">([^<]+)</)![1]!;
  const sess = await auth.login(`perola.${S}@tutts.com`, senhaP);
  ok(sess.deveTrocarSenha && sess.empresas.length === 2 && sess.perfil === 'RH', `entra com a senha provisória e enxerga as 2 empresas (${sess.empresas.length})`);
  const pRow = (await comoMaster(db, (tx) => tx.select().from(usuario).where(eq(usuario.id, per.id))))[0]!;
  ok(!!pRow.ultimoAcessoEm && pRow.nome === 'Pérola Andrade', 'último acesso gravado no login');
  ok(!!(await falha(svc.criar(A!.id, MASTER, { nome: 'Outra', email: `PEROLA.${S}@tutts.com`, perfil: 'RH' }))), 'e-mail repetido (maiúsculas) é recusado');
  ok(!!(await falha(svc.criar(A!.id, MASTER, { nome: 'X', email: 'semarroba', perfil: 'RH' }))), 'e-mail inválido é recusado');
  const semEmail = await svc.criar(A!.id, MASTER, { nome: 'Mariane Oliveira', email: `mariane.${S}@tutts.com`, perfil: 'RH', enviar: false });
  ok(!!semEmail.senhaProvisoria && !semEmail.emailEnviado, 'sem enviar: a senha volta para passar manualmente');

  l = await svc.listar(A!.id, MASTER);
  const lp = l.usuarios.find((u) => u.id === per.id)!;
  ok(l.usuarios.length === 3 && lp.aguardandoPrimeiroAcesso && lp.empresas.length === 2 && lp.empresas[0]!.id === A!.id, 'lista: 3 pessoas, Pérola aguardando 1º acesso, com 2 empresas');
  ok((await svc.listar(B!.id, MASTER)).usuarios.some((u) => u.id === per.id), 'Pérola aparece também na outra empresa');

  // ── escopo do Admin do cliente ──
  const escLeo = await svc.escopoAdmin(leo!.id, A!.id);
  ok(escLeo.tipo === 'ADMIN' && escLeo.empresas.length === 1, 'Admin antigo (sem vínculo) administra só a empresa dele');
  ok(!!(await falha(svc.escopoAdmin(per.id, A!.id))), 'RH não gerencia usuários');
  ok(!!(await falha(svc.criar(A!.id, escLeo, { nome: 'Z', email: `z.${S}@x.com`, perfil: 'RH', empresas: [B!.id] }))), 'Admin não dá acesso a empresa que não administra');
  ok(!!(await falha(svc.listar(C!.id, escLeo))), 'Admin não lista outra empresa');
  const lAdm = await svc.listar(A!.id, escLeo);
  ok(lAdm.empresasPossiveis.length === 1 && lAdm.usuarios.find((u) => u.id === leo!.id)!.voce, 'Admin vê só as empresas dele e se reconhece ("você")');
  // Admin edita as empresas da Pérola: tirar a A (que ele administra) mexe; a B (que não administra) fica
  await svc.editar(A!.id, escLeo, per.id, { empresas: [] });
  ok((await svc.listar(B!.id, MASTER)).usuarios.some((u) => u.id === per.id) && !(await svc.listar(A!.id, MASTER)).usuarios.some((u) => u.id === per.id),
    'Admin tira o acesso à empresa dele; o da empresa que não é dele fica');
  await svc.editar(B!.id, MASTER, per.id, { empresas: [A!.id, B!.id] });

  // ── trava: última pessoa Admin ──
  ok(!!(await falha(svc.ativo(A!.id, escLeo, leo!.id, false))), 'Admin não desativa a si mesmo');
  ok(!!(await falha(svc.editar(A!.id, MASTER, leo!.id, { perfil: 'RH' }))), 'não rebaixa a última pessoa Admin');
  ok(!!(await falha(svc.ativo(A!.id, MASTER, leo!.id, false))), 'não desativa a última pessoa Admin');
  await svc.editar(A!.id, escLeo, per.id, { perfil: 'ADMIN_CLIENTE', nome: 'Pérola A. Andrade' });
  const vincs = await comoMaster(db, (tx) => tx.select().from(usuarioTenant).where(eq(usuarioTenant.usuarioId, per.id)));
  ok(vincs.find((v) => v.tenantId === A!.id)!.perfil === 'ADMIN_CLIENTE' && vincs.find((v) => v.tenantId === B!.id)!.perfil === 'RH', 'papel muda só nesta empresa (na outra continua RH)');
  await svc.editar(A!.id, MASTER, leo!.id, { perfil: 'RH' });
  const leoV = await comoMaster(db, (tx) => tx.select().from(usuarioTenant).where(eq(usuarioTenant.usuarioId, leo!.id)));
  ok(leoV.length === 1 && leoV[0]!.perfil === 'RH', 'conta antiga ganha o vínculo ao ser editada (e vira RH, com outra Admin)');
  ok(!!(await falha(svc.escopoAdmin(leo!.id, A!.id))), 'rebaixado: já não gerencia usuários');

  // ── empresas: tirar a padrão ──
  await svc.editar(A!.id, MASTER, semEmail.id, { empresas: [A!.id, B!.id] });
  await svc.editar(B!.id, MASTER, semEmail.id, { empresas: [B!.id] });
  const mar = (await comoMaster(db, (tx) => tx.select().from(usuario).where(eq(usuario.id, semEmail.id))))[0]!;
  ok(mar.tenantId === B!.id && !(await svc.listar(A!.id, MASTER)).usuarios.some((u) => u.id === mar.id), 'saiu da empresa padrão: a sessão passa a abrir na que sobrou');
  ok(!!(await falha(svc.editar(B!.id, MASTER, semEmail.id, { empresas: [] }))), 'não fica sem nenhuma empresa');

  // ── desativar / reativar ──
  const sessLeo = await auth.login(`leo.santos.${S}@tutts.com`, 'Senha123!');
  await svc.ativo(A!.id, MASTER, leo!.id, false);
  ok(!!(await falha(auth.login(`leo.santos.${S}@tutts.com`, 'Senha123!'))), 'desativado: login recusado');
  ok(!!(await falha(auth.refresh(sessLeo.refreshToken))), 'desativado: renovação de sessão recusada');
  ok((await svc.listar(A!.id, MASTER)).usuarios.find((u) => u.id === leo!.id)!.ativo === false, 'continua na lista (desativado), não é apagado');
  ok(!!(await falha(svc.senhaNova(A!.id, MASTER, leo!.id))), 'desativado: não gera senha');
  await svc.ativo(A!.id, MASTER, leo!.id, true);
  enviados.length = 0;
  const sn = await svc.senhaNova(A!.id, MASTER, leo!.id);
  ok(!!sn.senhaProvisoria && enviados[0]?.assunto.includes('senha nova') === true, 'reativado: senha nova por e-mail (Master vê a senha)');
  ok(!!(await falha(auth.login(`leo.santos.${S}@tutts.com`, 'Senha123!'))) && !!(await auth.login(`leo.santos.${S}@tutts.com`, sn.senhaProvisoria!)), 'senha antiga deixa de valer, a nova entra');
  const te = await svc.trocarEmail(A!.id, MASTER, leo!.id, `leonardo.${S}@tutts.com`, false);
  ok(te.email === `leonardo.${S}@tutts.com` && !!(await falha(svc.trocarEmail(A!.id, MASTER, leo!.id, `perola.${S}@tutts.com`, false))), 'troca o e-mail; e-mail de outra conta é recusado');

  // ── auditoria por pessoa ──
  await comoMaster(db, (tx) => tx.insert(auditoria).values([
    { tenantId: A!.id, usuarioId: per.id, usuarioEmail: `perola.${S}@tutts.com`, usuarioPerfil: 'ADMIN_CLIENTE', acao: 'POST /portal/rh/liberar', metodo: 'POST', rota: '/portal/rh/liberar' },
    { tenantId: A!.id, usuarioId: per.id, usuarioEmail: `perola.${S}@tutts.com`, usuarioPerfil: 'ADMIN_CLIENTE', acao: 'POST /portal/rh/aprovar', metodo: 'POST', rota: '/portal/rh/aprovar' },
    { tenantId: A!.id, usuarioId: leo!.id, usuarioEmail: `leo.santos.${S}@tutts.com`, usuarioPerfil: 'RH', acao: 'POST /ajustes', metodo: 'POST', rota: '/ajustes' },
  ]));
  const pes = (await aud.pessoas(A!.id, {})).pessoas;
  ok(pes[0]!.id === per.id && pes[0]!.acoes === 2 && pes[0]!.nome === 'Pérola A. Andrade' && pes.find((p) => p.id === leo!.id)!.acoes === 1, 'auditoria: quantas ações cada pessoa fez, com nome');
  ok(pes.some((p) => p.id === mar.id && p.acoes === 0) === false, 'quem saiu da empresa sem agir nela não aparece');
  const linhas = await aud.listar(A!.id, { usuarioId: per.id });
  ok(linhas.length === 2 && linhas.every((x) => x.usuarioNome === 'Pérola A. Andrade'), 'filtro por pessoa, linhas com o nome');

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK');
  await client.end();
  process.exit(falhas ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await client.end(); process.exit(1); });
