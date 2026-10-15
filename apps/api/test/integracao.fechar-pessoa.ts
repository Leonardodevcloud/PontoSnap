import 'reflect-metadata';
import webpush from 'web-push';
const chaves = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = chaves.publicKey;
process.env.VAPID_PRIVATE_KEY = chaves.privateKey;
process.env.NODE_ENV = 'test';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { schema, comoMaster, tenant, usuario, pessoalNota } from '@ponto/db';
import { PushService } from '../src/notificacao/push.service';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { PessoalService } from '../src/pessoal/pessoal.service';
import { CriptoService } from '../src/common/cripto.service';
import { EmailService } from '../src/email/email.service';
import { TokenService } from '../src/auth/token';
import { AuthService } from '../src/auth/auth.service';
import { PortalService } from '../src/portal/portal.service';

/** Fechar UMA pessoa com o mês aberto: desligamento (proporcional, débitos futuros), antecipado, motorista, reabrir, cortar acesso. */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };
(webpush as unknown as { sendNotification: unknown }).sendNotification = async () => ({ statusCode: 201 });
async function falha(p: Promise<unknown>) { try { await p; return null; } catch (e) { return (e as Error).message; } }

async function main() {
  const pes = new PessoalService(db, new TratamentoService(db), new CriptoService());
  const email = new EmailService();
  const auth = new AuthService(db, new TokenService({ segredoAcesso: 'a', segredoRefresh: 'b', expiraAcesso: '15m', expiraRefresh: '7d' }), email);
  const portal = new PortalService(db, pes, new PushService(db), email, auth);

  const CNPJ = `63${String(Date.now()).slice(-12)}`;
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: CNPJ, razaoSocial: 'Tuts Teste LTDA' }).returning()))[0]!;
  const COMP = '2026-10', PROX = '2026-11';
  const giulia = (await pes.criarPrestador(t.id, { tipo: 'MEI', nome: 'Giulia Gomes', documento: `5${CNPJ.slice(-10)}`, valorMensal: 2600, baseDias: 'SEG_SAB', competenciaInicio: '2026-09', email: `g${CNPJ}@x.com` }))!;
  const ana = (await pes.criarPrestador(t.id, { tipo: 'MEI', nome: 'Ana Souza', documento: null, valorMensal: 2200, baseDias: 'SEG_SAB', competenciaInicio: '2026-09' }))!;
  const bruno = (await pes.criarPrestador(t.id, { tipo: 'MOTORISTA', nome: 'Bruno Teles', documento: null, valorMensal: 2500, baseDias: 'SEG_SAB', competenciaInicio: '2026-09' }))!;
  // Adiantamento de 900 em 3x a partir de outubro: 300 em out, 600 iam cair em nov/dez.
  await pes.criarDebito(t.id, { pessoaTipo: 'MEI', pessoaId: giulia.id, descricao: 'Adiantamento', valorTotal: 900, parcelas: 3, competenciaInicio: COMP });
  await pes.criarDebito(t.id, { pessoaTipo: 'MOTORISTA', pessoaId: bruno.id, descricao: 'Vale', valorTotal: 400, parcelas: 2, competenciaInicio: COMP });
  // Giulia tem app (para liberar e cortar acesso)
  const conv = await portal.convidar(t.id, [giulia.id], false);
  await portal.aceitarConvite((conv[0] as { codigo: string }).codigo, { senha: 'Senha123!' });

  // ── prévia (não grava) ──
  const prev = await portal.previaFecharPessoa(t.id, { pessoaTipo: 'MEI', pessoaId: giulia.id, competencia: COMP, motivo: 'DESLIGAMENTO', ultimoDia: '2026-10-15', proporcional: true });
  const cg = prev.congelada as { proporcional?: { dias: number; diasMes: number; contratoCent: number }; liquidoCent: number; debitosCent: number };
  ok(cg.proporcional?.dias === 13 && cg.proporcional.contratoCent === Math.round(260000 * 13 / cg.proporcional.diasMes), `prévia: contrato proporcional 13 de ${cg.proporcional?.diasMes} dias (1 a 15/10, seg–sáb)`);
  ok(prev.futurosCent === 60000 && cg.debitosCent === 90000 && cg.liquidoCent === cg.proporcional!.contratoCent - 90000, 'prévia: parcelas futuras (600) + do mês (300) saem do líquido');
  ok(!(await pes.competencia(t.id, COMP)).mei.find((m) => m.id === giulia.id)!.fechadoIndividual, 'prévia não grava');
  ok(!!(await falha(portal.previaFecharPessoa(t.id, { pessoaTipo: 'MEI', pessoaId: giulia.id, competencia: COMP, motivo: 'DESLIGAMENTO', ultimoDia: null, proporcional: true }))), 'desligamento exige o último dia');
  ok(!!(await falha(portal.previaFecharPessoa(t.id, { pessoaTipo: 'MEI', pessoaId: giulia.id, competencia: COMP, motivo: 'DESLIGAMENTO', ultimoDia: '2026-11-02', proporcional: true }))), 'último dia precisa estar no mês');

  // ── fechar Giulia (desligamento) com o mês aberto, liberando a nota ──
  const f = await portal.fecharPessoa(t.id, { pessoaTipo: 'MEI', pessoaId: giulia.id, competencia: COMP, motivo: 'DESLIGAMENTO', ultimoDia: '2026-10-15', proporcional: true, liberarNota: true, cortarAcesso: true, prazo: '2026-10-20' }, 'rh');
  ok(!!f.id && f.liberacao?.liberadas === 1, 'fechou só a Giulia e liberou a nota dela (mês aberto)');
  let c = await pes.competencia(t.id, COMP);
  const g = c.mei.find((m) => m.id === giulia.id)!;
  ok(!c.fechado && g.fechadoIndividual?.motivo === 'DESLIGAMENTO' && g.liquidoCent === cg.liquidoCent, 'mês segue aberto; Giulia aparece congelada com o valor da prévia');
  const nota = (await comoMaster(db, (tx) => tx.select().from(pessoalNota).where(and(eq(pessoalNota.tenantId, t.id), eq(pessoalNota.pessoaId, giulia.id)))))[0]!;
  ok(nota.valorCent === g.liquidoCent && nota.detalhe.some((d) => d.rotulo.startsWith('Contrato proporcional (13 de')) && nota.detalhe.some((d) => d.rotulo.startsWith('Parcelas restantes')),
    'nota liberada com o detalhe: contrato proporcional e parcelas restantes');
  ok(!!(await falha(pes.salvarLancamento(t.id, { pessoaTipo: 'MEI', pessoaId: giulia.id, competencia: COMP, heMin: 120 }))), 'lançamento de quem foi fechado fica travado');
  ok(!(await falha(pes.salvarLancamento(t.id, { pessoaTipo: 'MEI', pessoaId: ana.id, competencia: COMP, heMin: 120 }))), 'os outros continuam editáveis');
  ok(!!(await falha(portal.liberar(t.id, { competencia: COMP, tipo: 'MEI', prestadorIds: [ana.id] }))), 'quem não foi fechado não libera com o mês aberto');
  ok(!(await pes.competencia(t.id, PROX)).mei.some((m) => m.id === giulia.id), 'desligada some do mês seguinte');
  ok(!(await pes.competencia(t.id, PROX)).debitos.some((d) => d.pessoaId === giulia.id), 'e as parcelas de novembro não aparecem mais');

  // ── reabrir e fechar de novo ──
  const reab = await portal.reabrirPessoa(t.id, f.id);
  c = await pes.competencia(t.id, COMP);
  ok(reab.reaberto && !c.mei.find((m) => m.id === giulia.id)!.fechadoIndividual, 'reabrir volta a calcular ao vivo');
  ok((await pes.competencia(t.id, PROX)).mei.some((m) => m.id === giulia.id), 'reabrir desfaz o desligamento (volta em novembro)');
  ok((await comoMaster(db, (tx) => tx.select().from(pessoalNota).where(eq(pessoalNota.pessoaId, giulia.id)))).length === 0, 'nota ainda não enviada some ao reabrir');
  const f2 = await portal.fecharPessoa(t.id, { pessoaTipo: 'MEI', pessoaId: giulia.id, competencia: COMP, motivo: 'DESLIGAMENTO', ultimoDia: '2026-10-15', proporcional: false, liberarNota: true, cortarAcesso: true }, 'rh');
  c = await pes.competencia(t.id, COMP);
  ok(c.mei.find((m) => m.id === giulia.id)!.liquidoCent === 260000 - 90000, 'fechar de novo com "mês cheio": contrato inteiro − débitos');

  // ── pagar: corta o acesso pedido ──
  const n2 = (await comoMaster(db, (tx) => tx.select().from(pessoalNota).where(eq(pessoalNota.pessoaId, giulia.id))))[0]!;
  await portal.pagar(t.id, [n2.id]);
  const u = (await comoMaster(db, (tx) => tx.select().from(usuario).where(eq(usuario.prestadorId, giulia.id))))[0]!;
  ok(!u.ativo, 'depois do pagamento, o acesso ao app foi cortado');
  ok(!!(await falha(portal.reabrirPessoa(t.id, f2.id))), 'pago: não reabre');

  // ── antecipado (continua ativa) ──
  await portal.fecharPessoa(t.id, { pessoaTipo: 'MEI', pessoaId: ana.id, competencia: COMP, motivo: 'ANTECIPADO', ultimoDia: null, proporcional: false }, 'rh');
  c = await pes.competencia(t.id, COMP);
  ok(c.mei.find((m) => m.id === ana.id)!.fechadoIndividual?.motivo === 'ANTECIPADO' && (await pes.competencia(t.id, PROX)).mei.some((m) => m.id === ana.id), 'antecipado: congela e continua ativa no mês seguinte');

  // ── motorista desligado: semanas até o último dia e débito restante na última semana ──
  const fm = await portal.fecharPessoa(t.id, { pessoaTipo: 'MOTORISTA', pessoaId: bruno.id, competencia: COMP, motivo: 'DESLIGAMENTO', ultimoDia: '2026-10-15', proporcional: false, liberarNota: true }, 'rh');
  c = await pes.competencia(t.id, COMP);
  const b = c.motoristas.find((m) => m.id === bruno.id)!;
  const ultima = [...b.semanas].reverse().find((s) => s.dias > 0)!;
  ok(b.semanas.filter((s) => s.inicio > '2026-10-15').every((s) => s.dias === 0) && ultima.inicio <= '2026-10-15', 'motorista: semanas depois do último dia zeradas');
  if (process.env.DEBUG) console.log('DEBUG', JSON.stringify({ semanas: b.semanas.map((s) => [s.inicio, s.dias, s.totalCent, s.debitoAplicadoCent]), deb: b.debitosCent, pend: b.debitoPendenteCent, lib: fm.liberacao }));
  ok(b.semanas.reduce((a, s) => a + s.debitoAplicadoCent, 0) === 40000 && b.debitoPendenteCent === 0 && ultima.debitoAplicadoCent > 0,
    'débito do mês + parcela futura (400) descontados nas últimas semanas, sem sobrar pendente');
  ok((fm.liberacao?.liberadas ?? 0) === b.semanas.filter((s) => s.dias > 0 && s.totalCent - s.debitoAplicadoCent > 0).length, 'liberou as semanas trabalhadas com valor a receber');
  ok(Math.abs((fm.liberacao?.valorCent ?? 0) - b.liquidoCent) <= 2, 'o total liberado é o líquido do motorista (± centavo de arredondamento por semana)');

  // ── fechar o mês inteiro: congelados entram como estão ──
  await pes.fechar(t.id, COMP);
  c = await pes.competencia(t.id, COMP);
  ok(c.fechado && c.mei.find((m) => m.id === giulia.id)!.liquidoCent === 260000 - 90000 && c.mei.find((m) => m.id === giulia.id)!.lanc.pago, 'fechamento do mês usa a linha congelada (e o pagamento ao vivo)');
  ok(!!(await falha(portal.reabrirPessoa(t.id, fm.id))), 'mês fechado: não reabre a pessoa');

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo');
  await client.end();
  process.exit(falhas ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await client.end(); process.exit(1); });
