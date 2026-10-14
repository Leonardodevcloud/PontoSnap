import 'reflect-metadata';
import webpush from 'web-push';
const chaves = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = chaves.publicKey;
process.env.VAPID_PRIVATE_KEY = chaves.privateKey;
process.env.NODE_ENV = 'test';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema, comoMaster, tenant, empregado, usuario, pushSubscription, type BlocoComunicado } from '@ponto/db';
import { PushService } from '../src/notificacao/push.service';
import { ComunicacaoService } from '../src/comunicacao/comunicacao.service';

/** Enquete: votar, mudar o voto, resultado visível ou não, anônima, encerrar, lembrete e PDF. */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };
const recebidas: { titulo: string; endpoint: string }[] = [];
(webpush as unknown as { sendNotification: unknown }).sendNotification = async (sub: { endpoint: string }, payload: string) => {
  recebidas.push({ titulo: JSON.parse(payload).title, endpoint: sub.endpoint }); return { statusCode: 201 };
};
async function falha(p: Promise<unknown>) { try { await p; return null; } catch (e) { return (e as Error).message; } }

async function main() {
  const push = new PushService(db);
  const svc = new ComunicacaoService(db, push);
  const CNPJ = `79${String(Date.now()).slice(-12)}`;
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: CNPJ, razaoSocial: 'Enquete LTDA' }).returning()))[0]!;
  const pessoas: { id: string; nome: string }[] = [];
  for (const [i, nome] of ['Ana', 'Bia', 'Caio', 'Davi'].entries()) {
    const e = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: `${i}${CNPJ.slice(1, 11)}`, nome }).returning()))[0]!;
    const u = (await comoMaster(db, (tx) => tx.insert(usuario).values({ tenantId: t.id, email: `${nome}${CNPJ}@x.com`, senhaHash: 'x', perfil: 'COLABORADOR', empregadoId: e.id }).returning()))[0]!;
    await comoMaster(db, (tx) => tx.insert(pushSubscription).values({ tenantId: t.id, usuarioId: u.id, endpoint: `https://push.exemplo/${CNPJ}/${nome}`, p256dh: 'p', auth: 'a' }));
    pessoas.push({ id: e.id, nome });
  }
  const [ana, bia, caio, davi] = pessoas as [typeof pessoas[0], typeof pessoas[0], typeof pessoas[0], typeof pessoas[0]];
  const autor = { id: ana.id, nome: 'RH' };
  const enq = (extra: Partial<Extract<BlocoComunicado, { tipo: 'ENQUETE' }>> = {}): BlocoComunicado => ({
    tipo: 'ENQUETE', pergunta: 'Qual dia você prefere?', multipla: false, mostrarResultado: true, anonima: false, encerraEm: null,
    opcoes: [{ id: 'sex', texto: 'Sexta' }, { id: 'sab', texto: 'Sábado' }, { id: 'dom', texto: 'Domingo' }], ...extra,
  });
  const base = { titulo: 'Confraternização', publico: { tipo: 'TODOS' as const, valores: [] }, pedirCiencia: false, fixado: false, notificar: true, lembrar: true, reacoes: true };

  // Validações do editor
  ok(!!(await falha(svc.salvar(t.id, null, { ...base, blocos: [enq({ opcoes: [{ id: 'a', texto: 'Só uma' }] })] }, autor))), 'enquete com 1 opção é recusada');
  ok(!!(await falha(svc.salvar(t.id, null, { ...base, blocos: [enq(), enq()] }, autor))), 'duas enquetes no mesmo comunicado são recusadas');
  ok(!!(await falha(svc.salvar(t.id, null, { ...base, blocos: [enq({ opcoes: [{ id: 'a', texto: 'Sim' }, { id: 'b', texto: 'sim' }] })] }, autor))), 'opção repetida é recusada');

  const { id } = await svc.salvar(t.id, null, { ...base, blocos: [{ tipo: 'TEXTO', texto: 'Vote!' }, enq()] }, autor);
  const pub = await svc.efetivarPublicacao(t.id, id);
  await pub.envio;
  ok(recebidas.length === 4, 'notificação para os 4');

  // Votar
  const antes = await svc.abrir(t.id, ana.id, id);
  ok(!!antes.enquete && antes.enquete.meuVoto === null && antes.enquete.opcoes.every((o) => o.votos === null), 'antes de votar: sem voto e sem resultado (não influencia)');
  ok(!!(await falha(svc.votar(t.id, ana.id, id, ['sex', 'sab']))), 'duas opções numa enquete de escolha única: recusado');
  ok(!!(await falha(svc.votar(t.id, ana.id, id, ['xpto']))), 'opção inexistente: recusado');
  let r = await svc.votar(t.id, ana.id, id, ['sab']);
  ok(r.meuVoto?.[0] === 'sab' && r.verResultado && r.opcoes.find((o) => o.id === 'sab')?.votos === 1, 'Ana votou Sábado e vê o resultado');
  await svc.votar(t.id, bia.id, id, ['sex']);
  r = await svc.votar(t.id, ana.id, id, ['sex']);
  ok(r.meuVoto?.[0] === 'sex' && r.opcoes.find((o) => o.id === 'sex')?.votos === 2 && r.opcoes.find((o) => o.id === 'sab')?.votos === 0, 'Ana mudou o voto para Sexta (fica só o último)');
  await svc.votar(t.id, ana.id, id, ['sex']);
  const det = await svc.obter(t.id, id);
  ok(det.enquete?.total === 2 && det.enquete.mudaram === 1, `RH: 2 votos, 1 pessoa mudou (${det.enquete?.total}/${det.enquete?.mudaram})`);
  ok(det.destinatarios.find((d) => d.nome === 'Ana')?.voto?.[0] === 'sex', 'RH vê o voto da Ana');
  ok(!!det.destinatarios.find((d) => d.nome === 'Bia')?.abertoEm, 'votar conta como lido');
  ok(det.destinatarios.filter((d) => d.pendente).length === 2, 'pendentes = quem não votou (Caio e Davi)');

  // Lembrete só para quem não votou
  const n0 = recebidas.length;
  const lem = await svc.lembrar(t.id, id);
  ok(lem.pessoas === 2 && recebidas.length === n0 + 2 && recebidas.at(-1)!.titulo.startsWith('Falta seu voto'), 'lembrete vai só para quem não votou, com "Falta seu voto"');

  // Lista do app
  const meus = await svc.meus(t.id, caio.id);
  ok(meus.faltaVoto === 1 && meus.itens[0]!.enquete?.meuVoto === null, 'app do Caio: falta voto');

  // Enquete publicada não muda as opções
  await svc.salvar(t.id, id, { ...base, blocos: [{ tipo: 'TEXTO', texto: 'Vote!' }, enq({ opcoes: [{ id: 'x', texto: 'Outra' }, { id: 'y', texto: 'Mais' }], mostrarResultado: false })] }, autor);
  const det2 = await svc.obter(t.id, id);
  ok(det2.enquete?.opcoes.map((o) => o.id).join() === 'sex,sab,dom' && det2.enquete.mostrarResultado === false, 'depois de publicada: opções travadas, "ver resultado" pode mudar');
  ok(!!(await falha(svc.salvar(t.id, id, { ...base, blocos: [{ tipo: 'TEXTO', texto: 'sem enquete' }] }, autor))), 'não dá para remover enquete publicada');
  r = await svc.votar(t.id, caio.id, id, ['dom']);
  ok(r.verResultado === false && r.opcoes.every((o) => o.votos === null), 'com resultado desligado, o funcionário vê só o próprio voto');

  // Encerrar
  await svc.encerrarEnquete(t.id, id);
  ok(!!(await falha(svc.votar(t.id, davi.id, id, ['sab']))), 'depois de encerrada não aceita voto');
  ok(!!(await falha(svc.votar(t.id, ana.id, id, ['sab']))), 'nem mudança de voto');
  const res = await svc.meus(t.id, davi.id);
  ok(res.itens[0]!.enquete?.encerrada === true && res.faltaVoto === 0, 'encerrada: não conta mais como falta voto');
  const det3 = await svc.obter(t.id, id);
  ok(det3.destinatarios.filter((d) => d.pendente).map((d) => d.nome).join() === 'Davi', 'encerrada: pendência volta a ser a leitura (só o Davi não abriu)');

  // Anônima + múltipla
  const r2 = await svc.salvar(t.id, null, { ...base, titulo: 'Brindes', blocos: [enq({ multipla: true, anonima: true, pergunta: 'Quais brindes?' })] }, autor);
  await (await svc.efetivarPublicacao(t.id, r2.id)).envio;
  const v = await svc.votar(t.id, bia.id, r2.id, ['dom', 'sex']);
  ok(v.meuVoto?.join() === 'sex,dom', 'múltipla: duas opções, na ordem da enquete');
  const det4 = await svc.obter(t.id, r2.id);
  ok(det4.destinatarios.find((d) => d.nome === 'Bia')?.voto === null && det4.destinatarios.find((d) => d.nome === 'Bia')?.votou === true, 'anônima: RH sabe que a Bia votou, mas não em quê');
  ok(det4.enquete?.opcoes.find((o) => o.id === 'sex')?.votos === 1, 'anônima: totais aparecem');

  const pdf = await svc.pdfCiencia(t.id, id);
  ok(pdf.buffer.subarray(0, 4).toString() === '%PDF' && pdf.buffer.length > 1500, `PDF com o resultado (${pdf.buffer.length} bytes)`);
  const pdf2 = await svc.pdfCiencia(t.id, r2.id);
  ok(pdf2.buffer.length > 1000, 'PDF da anônima');

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
  await client.end();
  process.exit(falhas ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await client.end(); process.exit(1); });
