import 'reflect-metadata';
import webpush from 'web-push';
const chaves = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = chaves.publicKey;
process.env.VAPID_PRIVATE_KEY = chaves.privateKey;
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { schema, comoMaster, tenant, empregado, usuario, pushSubscription, pontoFeriado, pontoMarcacao, pontoRep, notificacaoEnvio } from '@ponto/db';
import { PushService } from '../src/notificacao/push.service';
import { NotificacaoCronService } from '../src/notificacao/notificacao-cron.service';
import { NotificacaoController } from '../src/notificacao/notificacao.controller';
import { TratamentoService } from '../src/tratamento/tratamento.service';

/** Lembretes/esqueceu: disparam no horário certo, uma vez só, e o painel do RH mostra. */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };

// Sem rede: o "navegador" aceita tudo, menos o endpoint marcado como revogado.
const recebidas: { endpoint: string; titulo: string }[] = [];
(webpush as unknown as { sendNotification: unknown }).sendNotification = async (sub: { endpoint: string }, payload: string) => {
  if (sub.endpoint.includes('revogado')) { const e = new Error('Gone') as Error & { statusCode: number }; e.statusCode = 410; throw e; }
  recebidas.push({ endpoint: sub.endpoint, titulo: JSON.parse(payload).title });
  return { statusCode: 201 };
};

async function main() {
  const push = new PushService(db);
  const cron = new NotificacaoCronService(db, push);
  const ctrl = new NotificacaoController(db, push);
  const trat = new TratamentoService(db);
  ok(push.ativo, 'servidor com chaves VAPID');

  const CNPJ = `76${String(Date.now()).slice(-12)}`;
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: CNPJ, razaoSocial: 'Notif LTDA' }).returning()))[0]!;
  const hor = (await trat.criarHorario(t.id, { codigo: 'COM', durJornadaMin: 480, diasSemana: [1, 2, 3, 4, 5], pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }] }))!;
  const ana = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: CNPJ.slice(0, 11), nome: 'Ana Souza', horarioContratualId: hor.id }).returning()))[0]!;
  const bia = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: `9${CNPJ.slice(1, 11)}`, nome: 'Bia Lima', horarioContratualId: hor.id }).returning()))[0]!;
  const uAna = (await comoMaster(db, (tx) => tx.insert(usuario).values({ tenantId: t.id, email: `ana${CNPJ}@x.com`, senhaHash: 'x', perfil: 'COLABORADOR', empregadoId: ana.id }).returning()))[0]!;
  await comoMaster(db, (tx) => tx.insert(usuario).values({ tenantId: t.id, email: `bia${CNPJ}@x.com`, senhaHash: 'x', perfil: 'COLABORADOR', empregadoId: bia.id }));
  const sub = { tenantId: t.id, usuarioId: uAna.id, p256dh: 'p', auth: 'a' };
  await comoMaster(db, (tx) => tx.insert(pushSubscription).values([
    { ...sub, endpoint: `https://push.exemplo/${CNPJ}/celular`, dispositivo: 'Mozilla/5.0 (Linux; Android 13; SM-A135M) Chrome/120.0 Mobile' },
    { ...sub, endpoint: `https://push.exemplo/${CNPJ}/revogado`, dispositivo: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1' },
  ]));

  const quarta = { hoje: '2026-10-14', dow: 3, offMin: -180 };
  // 07:52 → lembrete da entrada
  let r = await cron.tickTenant(t.id, '-0300', { ...quarta, min: 7 * 60 + 52 });
  ok(r.enviados === 1 && recebidas.at(-1)?.titulo === 'Hora de bater o ponto', `07:52: lembrete da entrada (${r.enviados})`);
  // Dois ticks seguidos (ou duas instâncias): não repete
  r = await cron.tickTenant(t.id, '-0300', { ...quarta, min: 7 * 60 + 54 });
  ok(r.enviados === 0, 'tick seguinte não manda o mesmo lembrete de novo');
  const subsDepois = await comoMaster(db, (tx) => tx.select().from(pushSubscription).where(eq(pushSubscription.tenantId, t.id)));
  ok(subsDepois.length === 1, 'aparelho que o navegador revogou (410) foi removido');

  // 08:20 sem batida → esqueceu a entrada
  r = await cron.tickTenant(t.id, '-0300', { ...quarta, min: 8 * 60 + 20 });
  ok(r.enviados === 1 && recebidas.at(-1)?.titulo === 'Esqueceu a entrada?', '08:20 sem batida: "Esqueceu a entrada?"');

  // Bateu a entrada às 08:25: no almoço lembra a saída do almoço, não cobra entrada
  const rep = (await comoMaster(db, (tx) => tx.insert(pontoRep).values({ tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: CNPJ, razaoSocial: 'Notif', numeroInpi: 'BR512024007777-7', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188' }).returning()))[0]!;
  await comoMaster(db, (tx) => tx.insert(pontoMarcacao).values({ tenantId: t.id, repId: rep.id, nsr: 1, cpf: ana.cpf, dtMarcacao: new Date('2026-10-14T08:25:00-03:00'), coletor: 1, hashRegistro: '1'.padStart(64, '0') }));
  r = await cron.tickTenant(t.id, '-0300', { ...quarta, min: 11 * 60 + 55 });
  ok(r.enviados === 1 && recebidas.at(-1)?.titulo === 'Hora do almoço', '11:55 com entrada batida: lembrete do almoço');

  // Feriado: nada
  await comoMaster(db, (tx) => tx.insert(pontoFeriado).values({ tenantId: t.id, data: '2026-10-15', nome: 'Feriado teste' }));
  r = await cron.tickTenant(t.id, '-0300', { hoje: '2026-10-15', dow: 4, offMin: -180, min: 7 * 60 + 55 });
  ok(r.enviados === 0, 'feriado: sem lembrete');
  // Sábado fora da escala: nada
  r = await cron.tickTenant(t.id, '-0300', { hoje: '2026-10-17', dow: 6, offMin: -180, min: 7 * 60 + 55 });
  ok(r.enviados === 0, 'sábado fora da escala: sem lembrete');

  // Painel do RH
  const p = await ctrl.painel({ sub: 'rh', tenantId: t.id, perfil: 'RH' } as never);
  const pa = p.pessoas.find((x) => x.empregadoId === ana.id)!;
  const pb = p.pessoas.find((x) => x.empregadoId === bia.id)!;
  ok(p.servidor.ativo && p.resumo.ativos === 2 && p.resumo.comApp === 2 && p.resumo.comNotificacao === 1, `painel: 2 ativos, 2 com app, 1 com notificação (${JSON.stringify(p.resumo)})`);
  ok(pa.aparelhos.length === 1 && pa.aparelhos[0]!.aparelho === 'Android · Chrome' && !!pa.aparelhos[0]!.ultimoSucessoEm, 'painel: aparelho "Android · Chrome" com última entrega');
  ok(pb.temApp && pb.aparelhos.length === 0, 'painel: Bia tem app mas não ativou notificação');
  ok(p.envios.length === 3 && p.envios.every((v) => v.entregues === 1 && v.nome === 'Ana Souza'), `painel: 3 envios registrados e entregues (${p.envios.length})`);

  // Teste do RH para quem não tem aparelho: registra que não chegou
  const tb = await ctrl.testeFuncionario({ sub: 'rh', tenantId: t.id, perfil: 'RH' } as never, bia.id);
  ok(tb.dispositivos === 0 && tb.entregues === 0, 'teste do RH para a Bia: nenhum aparelho');
  const env = await comoMaster(db, (tx) => tx.select().from(notificacaoEnvio).where(eq(notificacaoEnvio.empregadoId, bia.id)));
  ok(env[0]?.erro === 'nenhum aparelho com notificação ativa', 'envio sem aparelho fica registrado com o motivo');

  // Celular compartilhado: Bia loga no mesmo aparelho da Ana → o aparelho passa a ser só da Bia
  const uBia = (await comoMaster(db, (tx) => tx.select().from(usuario).where(eq(usuario.empregadoId, bia.id))))[0]!;
  await ctrl.salvarSubscription({ sub: uBia.id, tenantId: t.id, perfil: 'COLABORADOR' } as never, { endpoint: `https://push.exemplo/${CNPJ}/celular`, p256dh: 'p', auth: 'a' } as never);
  const donos = await comoMaster(db, (tx) => tx.select().from(pushSubscription).where(eq(pushSubscription.endpoint, `https://push.exemplo/${CNPJ}/celular`)));
  ok(donos.length === 1 && donos[0]!.usuarioId === uBia.id, 'aparelho compartilhado fica só com quem está logado');

  await client.end();
  if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
  console.log('\n>>> NOTIFICAÇÕES OK <<<');
}
main().catch(async (e) => { console.error(e); await client.end(); process.exit(1); });
