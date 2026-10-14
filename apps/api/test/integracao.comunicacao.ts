import 'reflect-metadata';
import webpush from 'web-push';
const chaves = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = chaves.publicKey;
process.env.VAPID_PRIVATE_KEY = chaves.privateKey;
process.env.NODE_ENV = 'test';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { schema, comoMaster, tenant, empregado, usuario, pushSubscription, comunicado, comunicadoMidia } from '@ponto/db';
import { PushService } from '../src/notificacao/push.service';
import { ComunicacaoService } from '../src/comunicacao/comunicacao.service';

/** Comunicação interna: publicar, público, mídia protegida, ciência, lembrete, agendamento e PDF. */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };
const recebidas: { endpoint: string; titulo: string; url: string }[] = [];
(webpush as unknown as { sendNotification: unknown }).sendNotification = async (sub: { endpoint: string }, payload: string) => {
  const p = JSON.parse(payload); recebidas.push({ endpoint: sub.endpoint, titulo: p.title, url: p.url }); return { statusCode: 201 };
};
async function falha(p: Promise<unknown>) { try { await p; return null; } catch (e) { return (e as Error).message; } }

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 1)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 32)]);
const AUDIO = Buffer.alloc(4000, 7);

async function main() {
  const push = new PushService(db);
  const svc = new ComunicacaoService(db, push);
  const CNPJ = `77${String(Date.now()).slice(-12)}`;
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: CNPJ, razaoSocial: 'Comunica LTDA' }).returning()))[0]!;
  const mk = async (nome: string, cpf: string, cliente: string | null, app: boolean, pushOn: boolean) => {
    const e = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf, nome, cliente }).returning()))[0]!;
    if (!app) return { e, u: null };
    const u = (await comoMaster(db, (tx) => tx.insert(usuario).values({ tenantId: t.id, email: `${cpf}${CNPJ}@x.com`, senhaHash: 'x', perfil: 'COLABORADOR', empregadoId: e.id }).returning()))[0]!;
    if (pushOn) await comoMaster(db, (tx) => tx.insert(pushSubscription).values({ tenantId: t.id, usuarioId: u.id, endpoint: `https://push.exemplo/${CNPJ}/${nome}`, p256dh: 'p', auth: 'a' }));
    return { e, u };
  };
  const ana = await mk('Ana', CNPJ.slice(0, 11), 'Loja Centro', true, true);
  const bia = await mk('Bia', `1${CNPJ.slice(1, 11)}`, 'Loja Centro', true, false);
  const caio = await mk('Caio', `2${CNPJ.slice(1, 11)}`, 'Loja Norte', true, true);
  await mk('Davi sem app', `3${CNPJ.slice(1, 11)}`, 'Loja Norte', false, false);

  const op = await svc.opcoesPublico(t.id);
  ok(op.pessoas.length === 4 && op.pessoas.filter((p) => p.temApp).length === 3 && op.pessoas.filter((p) => p.temPush).length === 2, 'opções: 4 pessoas, 3 com app, 2 com notificação');
  ok(op.clientes.find((c) => c.valor === 'Loja Norte')?.pessoas === 1, 'Loja Norte conta só quem tem app (1)');

  // Mídia
  const foto = await svc.enviarMidia(t.id, 'FOTO', { buffer: JPEG, mimetype: 'image/jpeg', originalname: 'a.jpg', size: JPEG.length }, { buffer: JPEG, mimetype: 'image/jpeg', originalname: 'm.jpg', size: JPEG.length });
  const audio = await svc.enviarMidia(t.id, 'AUDIO', { buffer: AUDIO, mimetype: 'audio/webm', originalname: 'gravacao.webm', size: AUDIO.length });
  const pdf = await svc.enviarMidia(t.id, 'ARQUIVO', { buffer: PDF, mimetype: 'application/pdf', originalname: 'kit.pdf', size: PDF.length });
  ok(!!(await falha(svc.enviarMidia(t.id, 'ARQUIVO', { buffer: JPEG, mimetype: 'application/pdf', originalname: 'x.pdf', size: 1 }))), 'PDF falso é recusado');
  ok(!!(await falha(svc.enviarMidia(t.id, 'FOTO', { buffer: PDF, mimetype: 'image/jpeg', originalname: 'x.jpg', size: 1 }))), 'foto falsa é recusada');

  const base = {
    titulo: 'Novo uniforme', publico: { tipo: 'TODOS' as const, valores: [] }, pedirCiencia: true, fixado: true, notificar: true, lembrar: true, reacoes: true,
    blocos: [
      { tipo: 'TEXTO' as const, texto: 'A partir de segunda, uniforme novo.' },
      { tipo: 'VIDEO' as const, url: 'https://youtu.be/dQw4w9WgXcQ', provedor: 'YOUTUBE' as const, videoId: '', titulo: null },
      { tipo: 'FOTOS' as const, midias: [foto.id] },
      { tipo: 'AUDIO' as const, midiaId: audio.id, duracaoSeg: 23, picos: [10, 50, 90] },
      { tipo: 'ARQUIVO' as const, midiaId: pdf.id, nome: 'kit.pdf', bytes: PDF.length },
    ],
  };
  ok(!!(await falha(svc.salvar(t.id, null, { ...base, blocos: [{ tipo: 'VIDEO', url: 'https://example.com/v', provedor: 'YOUTUBE', videoId: '', titulo: null }] }, { id: ana.u!.id, nome: 'Joana' }))), 'link de vídeo desconhecido é recusado');
  const { id } = await svc.salvar(t.id, null, base, { id: ana.u!.id, nome: 'Joana' });
  const rasc = await svc.obter(t.id, id);
  ok(rasc.status === 'RASCUNHO' && rasc.midias.length === 3 && (rasc.blocos[1] as { videoId: string }).videoId === 'dQw4w9WgXcQ', 'rascunho salvo com 3 mídias vinculadas e vídeo reconhecido');

  // Funcionário não vê mídia de rascunho
  ok(!!(await falha(svc.midia(t.id, foto.id, ana.e.id, false))), 'funcionário não acessa mídia de rascunho');

  const pub = await svc.efetivarPublicacao(t.id, id);
  const notificados = await pub.envio;
  ok(pub.destinatarios === 3, `publicado para 3 (quem tem app) — ${pub.destinatarios}`);
  ok(notificados === 2 && recebidas.length === 2 && recebidas[0]!.url === `/avisos/${id}`, `notificação chegou para 2 pessoas, com link para o aviso (${notificados})`);
  ok(recebidas[0]!.titulo.includes('Novo uniforme'), 'título da notificação');
  const pub2 = await svc.efetivarPublicacao(t.id, id);
  ok(pub2.destinatarios === 0 && (await pub2.envio) === 0 && recebidas.length === 2, 'publicar de novo não duplica nem notifica');

  // Funcionário
  const meus = await svc.meus(t.id, ana.e.id);
  ok(meus.itens.length === 1 && meus.naoLidos === 1 && meus.pendentesCiencia === 1, 'app: 1 não lido, 1 pede ciência');
  ok(meus.itens[0]!.destaque === 'VIDEO' && meus.itens[0]!.outros.join(',') === 'áudio,1 foto,PDF', `cartão: destaque vídeo + "${meus.itens[0]!.outros.join(', ')}"`);
  const aberto = await svc.abrir(t.id, ana.e.id, id);
  ok(!!aberto.abertoEm && aberto.blocos.length === 5, 'abrir marca como lido e traz os blocos');
  ok((await svc.midia(t.id, foto.id, ana.e.id, true)).dados.length === JPEG.length, 'funcionário acessa a foto do comunicado dele');
  await svc.marcarMidia(t.id, ana.e.id, id);
  const c1 = await svc.ciente(t.id, ana.e.id, id);
  const c2 = await svc.ciente(t.id, ana.e.id, id);
  ok(c1.cienteEm === c2.cienteEm, 'ciência registrada uma vez (a segunda não muda a hora)');
  await svc.reagir(t.id, ana.e.id, id, '👍');
  ok(!!(await falha(svc.reagir(t.id, ana.e.id, id, '💩'))), 'reação fora da lista é recusada');
  const res = await svc.meuResumo(t.id, ana.e.id);
  ok(res.naoLidos === 0 && res.pendentesCiencia === 0, 'resumo da Ana zerado depois da ciência');

  // RH
  const det = await svc.obter(t.id, id);
  const dAna = det.destinatarios.find((d) => d.nome === 'Ana')!;
  ok(!!dAna.abertoEm && !!dAna.midiaEm && !!dAna.cienteEm && dAna.reacao === '👍', 'RH vê aberto, assistiu, ciência e reação da Ana');
  ok(det.porCliente.find((g) => g.nome === 'Loja Centro')?.ok === 1 && det.porCliente.find((g) => g.nome === 'Loja Centro')?.total === 2, 'agrupado por cliente');
  const lista = await svc.listar(t.id);
  ok(lista.resumo.pessoasPendentes === 2 && lista.itens[0]!.cientes === 1, `lista: 2 pessoas com ciência pendente (${lista.resumo.pessoasPendentes})`);

  // Lembrete manual: só Caio tem push entre os pendentes (Bia não ativou)
  const lem = await svc.lembrar(t.id, id);
  ok(lem.pessoas === 2 && lem.receberam === 1, `lembrete: 2 pendentes, 1 recebeu (${lem.pessoas}/${lem.receberam})`);
  ok(recebidas.at(-1)!.titulo.startsWith('Falta sua ciência'), 'texto do lembrete de ciência');

  // Lembrete automático de 24h: uma vez só
  await comoMaster(db, (tx) => tx.update(comunicado).set({ publicadoEm: new Date(Date.now() - 25 * 3600_000) }).where(eq(comunicado.id, id)));
  const antes = recebidas.length;
  await svc.rotina();
  await svc.rotina();
  ok(recebidas.length === antes + 1, `lembrete de 24h saiu uma vez (${recebidas.length - antes})`);

  // Público por cliente + agendamento
  const r2 = await svc.salvar(t.id, null, { ...base, titulo: 'Só Loja Norte', pedirCiencia: false, fixado: false, publico: { tipo: 'CLIENTE', valores: ['Loja Norte'] }, blocos: [{ tipo: 'TEXTO', texto: 'Oi Norte' }] }, { id: ana.u!.id, nome: 'Joana' });
  const ag = await svc.publicar(t.id, r2.id, new Date(Date.now() + 3600_000).toISOString());
  ok(ag.status === 'AGENDADO', 'agendado para daqui 1h');
  ok((await svc.rotina()).publicados === 0, 'rotina não publica antes da hora');
  ok((await svc.rotina(new Date(Date.now() + 2 * 3600_000))).publicados === 1, 'rotina publica quando chega a hora');
  ok((await svc.meus(t.id, caio.e.id)).itens.length === 2 && (await svc.meus(t.id, bia.e.id)).itens.length === 1, 'Caio (Norte) recebeu os 2; Bia (Centro) só o primeiro');
  ok(!!(await falha(svc.abrir(t.id, bia.e.id, r2.id))), 'Bia não abre comunicado que não é para ela');
  ok(!!(await falha(svc.excluir(t.id, id))), 'publicado não pode ser excluído');

  // Arquivar some do app
  await svc.arquivar(t.id, r2.id, true);
  ok((await svc.meus(t.id, caio.e.id)).itens.length === 1, 'arquivado some do app');

  // PDF
  const p = await svc.pdfCiencia(t.id, id);
  ok(p.buffer.subarray(0, 4).toString() === '%PDF' && p.buffer.length > 1000, `PDF de ciência gerado (${p.buffer.length} bytes)`);

  // Mídia órfã antiga é limpa
  const orfa = await svc.enviarMidia(t.id, 'FOTO', { buffer: JPEG, mimetype: 'image/jpeg', originalname: 'o.jpg', size: JPEG.length });
  await comoMaster(db, (tx) => tx.update(comunicadoMidia).set({ criadoEm: new Date(Date.now() - 2 * 86_400_000) }).where(eq(comunicadoMidia.id, orfa.id)));
  await svc.rotina();
  ok((await comoMaster(db, (tx) => tx.select().from(comunicadoMidia).where(eq(comunicadoMidia.id, orfa.id)))).length === 0, 'mídia órfã de mais de 1 dia é apagada');

  // Isolamento entre empresas
  const t2 = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: `78${CNPJ.slice(2)}`, razaoSocial: 'Outra' }).returning()))[0]!;
  ok(!!(await falha(svc.obter(t2.id, id))) && !!(await falha(svc.midia(t2.id, foto.id, null, false))), 'outra empresa não vê comunicado nem mídia');

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
  await client.end();
  process.exit(falhas ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await client.end(); process.exit(1); });
