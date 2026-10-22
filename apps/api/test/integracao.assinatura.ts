import 'reflect-metadata';
import webpush from 'web-push';
const chaves = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = chaves.publicKey;
process.env.VAPID_PRIVATE_KEY = chaves.privateKey;
process.env.NODE_ENV = 'test';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { createHmac } from 'node:crypto';
import JSZip from 'jszip';
import { schema, comoMaster, tenant, empregado, usuario, pessoalFechamento, assinaturaDocumento } from '@ponto/db';
import { PushService } from '../src/notificacao/push.service';
import { CriptoService } from '../src/common/cripto.service';
import { AssinaturaService, identificarContracheque, idsDeDocumento } from '../src/assinatura/assinatura.service';
import type { AutentiqueApi, NovoDocumento, SituacaoAutentique } from '../src/assinatura/autentique.client';
import type { TratamentoService } from '../src/tratamento/tratamento.service';

/** Assinatura via Autentique (simulada): config, contracheque (único e lote), envio, webhook, recusa, lembrete, cancelar, app do funcionário. */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };
const pushes: string[] = [];
(webpush as unknown as { sendNotification: unknown }).sendNotification = async (_s: unknown, payload: string) => { pushes.push(JSON.parse(payload).title); return { statusCode: 201 }; };
async function falha(p: Promise<unknown>) { try { await p; return null; } catch (e) { return (e as Error).message; } }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('../../../packages/rep-core/node_modules/pdfkit');
const pdf = (texto: string): Promise<Buffer> => new Promise((res) => {
  const d = new PDFDocument(); const p: Buffer[] = []; d.on('data', (b: Buffer) => p.push(b)); d.on('end', () => res(Buffer.concat(p)));
  d.fontSize(10).text(texto); d.end();
});

/** Autentique falsa: guarda o que recebeu e devolve o status que o teste mandar. */
class AutentiqueFalsa implements AutentiqueApi {
  static docs = new Map<string, { n: NovoDocumento; s: SituacaoAutentique; cancelado: boolean }>();
  static reenvios: string[][] = [];
  static seq = 0;
  constructor(private token: string) {}
  async conta() { if (this.token !== 'tok-ok') throw new Error('Token da Autentique inválido.'); return { nome: 'Tuts RH', email: 'rh@tuts.com', documentos: 100, creditos: 0 }; }
  async criarDocumento(n: NovoDocumento) {
    const id = `doc-${++AutentiqueFalsa.seq}`;
    AutentiqueFalsa.docs.set(id, { n, s: { visualizadoEm: null, assinadoEm: null, recusadoEm: null, motivoRecusa: null, arquivoAssinadoUrl: null }, cancelado: false });
    return { id, publicId: `pub-${id}` };
  }
  async situacao(id: string) { const d = AutentiqueFalsa.docs.get(id); return d && !d.cancelado ? d.s : null; }
  async reenviar(p: string[]) { AutentiqueFalsa.reenvios.push(p); }
  async linkAssinatura(p: string) { return `https://assina.ae/${p}`; }
  async cancelar(id: string) { const d = AutentiqueFalsa.docs.get(id); if (d) d.cancelado = true; }
  async baixar(url: string) { return Buffer.from(`%PDF-1.4 ASSINADO ${url}`); }
}

async function main() {
  const cripto = new CriptoService();
  const tratFalso = { gerarEspelhoPdf: async (_t: string, emp: string) => ({ buffer: await pdf(`Espelho ${emp}`), nomeArquivo: `espelho_${emp.slice(0, 6)}.pdf` }) } as unknown as TratamentoService;
  const svc = new AssinaturaService(db, cripto, tratFalso, new PushService(db), (tok) => new AutentiqueFalsa(tok));
  svc.pausaMs = 0;

  const CNPJ = `64${String(Date.now()).slice(-12)}`;
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: CNPJ, razaoSocial: 'Tuts Assina LTDA' }).returning()))[0]!;
  const cpf = (n: number) => `${CNPJ.slice(-8)}${String(n).padStart(3, '0')}`;
  const mk = (n: number, nome: string, extra: Partial<typeof empregado.$inferInsert> = {}) =>
    comoMaster(db, async (tx) => (await tx.insert(empregado).values({ tenantId: t.id, cpf: cpf(n), nome, ...extra }).returning())[0]!);
  const ana = await mk(1, 'Ana Acumula', { emailPessoal: `Ana.${CNPJ}@Gmail.com` });
  const bruno = await mk(2, 'Bruno Paga', { celular: '(71) 98888-1234' });
  const caio = await mk(3, 'Caio Contrato');
  const uCaio = (await comoMaster(db, (tx) => tx.insert(usuario).values({ tenantId: t.id, email: `caio${CNPJ}@portal.pontosnap.app.br`, senhaHash: 'x', perfil: 'COLABORADOR', empregadoId: caio.id }).returning()))[0]!;
  const COMP = '2026-10';

  // ── puras ──
  const emps = [{ id: 'a', nome: 'Ana Acumula', cpf: '12345678900' }, { id: 'b', nome: 'Bruno Paga', cpf: '98765432100' }, { id: 'c', nome: 'Ana Souza', cpf: '11122233344' }];
  ok(identificarContracheque('HOLERITE_123.456.789-00.pdf', '', emps)?.como === 'CPF', 'identifica pelo CPF no nome do arquivo');
  ok(identificarContracheque('bruno paga - outubro.pdf', '', emps)?.empregadoId === 'b', 'identifica pelo nome no arquivo');
  ok(identificarContracheque('ana.pdf', '', emps) === null, '"ana" sozinho é ambíguo (duas Anas): não chuta');
  ok(identificarContracheque('recibo_0034.pdf', 'Funcionário: X CPF 987.654.321-00', emps)?.como === 'CPF_PDF', 'identifica pelo CPF dentro do PDF');
  ok(idsDeDocumento({ event: { type: 'signature.accepted', data: { document: { id: 'd1' } } } }).includes('d1')
    && idsDeDocumento({ event: { data: { object: { object: 'document', id: 'd2' } } } }).includes('d2'), 'acha o id do documento nos formatos de webhook');

  // ── configuração ──
  ok(!!(await falha(svc.salvarConfig(t.id, { token: 'tok-ruim' }))), 'token inválido não é gravado');
  const cfg = await svc.salvarConfig(t.id, { token: 'tok-ok', sandbox: true });
  ok(cfg.conectado && cfg.contaEmail === 'rh@tuts.com' && !!cfg.webhookUrl?.includes('/integracoes/autentique/retorno/'), 'conecta com o token válido e gera a URL do webhook');
  const tokenWebhook = cfg.webhookUrl!.split('/').pop()!;

  // ── contracheques ──
  ok(!!(await falha(svc.salvarContracheque(t.id, { competencia: COMP, empregadoId: ana.id, arquivoBase64: Buffer.from('não é pdf').toString('base64'), arquivoNome: 'x.txt' }))), 'só aceita PDF');
  await svc.salvarContracheque(t.id, { competencia: COMP, empregadoId: ana.id, arquivoBase64: (await pdf('Holerite Ana')).toString('base64'), arquivoNome: 'holerite_ana.pdf' });
  const zip = new JSZip();
  zip.file('bruno paga - outubro.pdf', await pdf('Holerite'));
  zip.file('recibo_0034.pdf', await pdf(`Recibo de pagamento CPF ${cpf(3).replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')}`));
  zip.file('scan_005.pdf', await pdf('ilegível'));
  zip.file('__MACOSX/._lixo.pdf', 'x');
  const lote = await svc.subirLote(t.id, { competencia: COMP, arquivoNome: 'contracheques.zip', arquivoBase64: (await zip.generateAsync({ type: 'nodebuffer' })).toString('base64') });
  const sug = (n: string) => lote.find((x) => x.arquivoNome === n);
  ok(lote.length === 3 && sug('bruno paga - outubro.pdf')?.empregadoId === bruno.id && sug('recibo_0034.pdf')?.empregadoId === caio.id && sug('recibo_0034.pdf')?.como === 'CPF_PDF'
    && sug('scan_005.pdf')?.empregadoId === null, 'ZIP: 3 PDFs (ignora __MACOSX), liga pelo nome e pelo CPF dentro do PDF, o ilegível fica sem dono');
  ok(!!(await falha(svc.confirmarLote(t.id, COMP, [{ uploadId: lote[0]!.id, empregadoId: bruno.id }, { uploadId: lote[1]!.id, empregadoId: bruno.id }]))), 'dois arquivos para a mesma pessoa: recusa');
  const conf = await svc.confirmarLote(t.id, COMP, lote.map((x) => ({ uploadId: x.id, empregadoId: x.empregadoId })));
  ok(conf.salvos === 2 && conf.descartados === 1 && (await svc.uploadsPendentes(t.id, COMP)).length === 0, 'confirmar lote: 2 salvos, o sem dono descartado');

  let p = await svc.painel(t.id, COMP);
  ok(!p.espelhoPronto && p.totais.faltaContracheque === 0 && p.linhas.find((l) => l.empregadoId === ana.id)!.canal === 'EMAIL'
    && p.linhas.find((l) => l.empregadoId === bruno.id)!.canal === 'WHATSAPP' && p.linhas.find((l) => l.empregadoId === caio.id)!.canal === 'APP', 'painel: canal por pessoa (e-mail, WhatsApp, só app)');

  // ── enviar (mês ainda aberto: só contracheque) ──
  let env = await svc.enviar(t.id, { competencia: COMP, empregadoIds: [ana.id] }, 'rh');
  p = await svc.painel(t.id, COMP);
  ok(env.enviados === 1 && !p.linhas.find((l) => l.empregadoId === ana.id)!.espelho, 'Folha aberta: espelho não vai; contracheque vai');
  await comoMaster(db, (tx) => tx.insert(pessoalFechamento).values({ tenantId: t.id, competencia: COMP, snapshot: {} }));
  env = await svc.enviar(t.id, { competencia: COMP, empregadoIds: [ana.id, bruno.id, caio.id], mensagem: 'Seguem seus documentos', lembrete: 'DAILY', prazo: '2026-11-10' }, 'rh');
  p = await svc.painel(t.id, COMP);
  const docsF = [...AutentiqueFalsa.docs.values()];
  const deAna = docsF.filter((d) => d.n.signatario.email === `ana.${CNPJ}@gmail.com`);
  ok(env.enviados === 5 && env.erros.length === 0, `mês fechado: 3 espelhos + 2 contracheques (o da Ana já tinha ido) (${JSON.stringify(env)})`);
  ok(deAna.length === 2 && deAna.every((d) => d.n.sandbox && d.n.signatario.canal === 'EMAIL'), 'Ana: por e-mail, em modo de teste');
  ok(docsF.some((d) => d.n.signatario.canal === 'WHATSAPP' && d.n.signatario.telefone === '+5571988881234'), 'Bruno: pelo WhatsApp (+55)');
  ok(docsF.some((d) => d.n.signatario.canal === 'APP' && d.n.lembrete === null), 'Caio: só app (sem lembrete por e-mail)');
  ok(p.linhas.every((l) => l.espelho?.status === 'ENVIADO' && l.contracheque?.status === 'ENVIADO'), 'todos os 6 documentos como ENVIADO');
  const env2 = await svc.enviar(t.id, { competencia: COMP, empregadoIds: [ana.id] }, 'rh');
  ok(env2.enviados === 0, 'enviar de novo não duplica o que já foi');

  // ── webhook: assinou ──
  const ccAna = p.linhas.find((l) => l.empregadoId === ana.id)!.contracheque!;
  const linhaAna = (await comoMaster(db, (tx) => tx.select().from(assinaturaDocumento).where(eq(assinaturaDocumento.id, ccAna.id))))[0]!;
  AutentiqueFalsa.docs.get(linhaAna.autentiqueId!)!.s = { visualizadoEm: '2026-11-04T18:40:00Z', assinadoEm: '2026-11-05T14:03:00Z', recusadoEm: null, motivoRecusa: null, arquivoAssinadoUrl: 'https://x/assinado.pdf' };
  const corpo = JSON.stringify({ event: { type: 'signature.accepted', data: { document: { id: linhaAna.autentiqueId } } } });
  ok(!!(await falha(svc.webhook('token-errado', corpo))), 'webhook com token errado é recusado');
  const w = await svc.webhook(tokenWebhook, corpo);
  p = await svc.painel(t.id, COMP);
  const ccAna2 = p.linhas.find((l) => l.empregadoId === ana.id)!.contracheque!;
  ok(w.ok && ccAna2.status === 'ASSINADO' && ccAna2.temAssinado && !!ccAna2.assinadoEm?.startsWith('2026-11-05'), 'webhook: contracheque da Ana ASSINADO, com o arquivo assinado guardado');
  ok((await svc.arquivo(t.id, ccAna2.id, true)).buffer.toString().includes('ASSINADO'), 'baixa o PDF assinado');

  // ── HMAC ──
  await svc.salvarConfig(t.id, { webhookSegredo: 'segredo123' });
  ok(!!(await falha(svc.webhook(tokenWebhook, corpo, 'abc'))), 'com segredo: assinatura errada é recusada');
  const assin = createHmac('sha256', 'segredo123').update(corpo).digest('hex');
  ok((await svc.webhook(tokenWebhook, corpo, assin)).ok, 'com segredo: assinatura certa passa');

  // ── recusa (pela conferência periódica) ──
  const esBruno = (await comoMaster(db, (tx) => tx.select().from(assinaturaDocumento).where(eq(assinaturaDocumento.id, p.linhas.find((l) => l.empregadoId === bruno.id)!.espelho!.id))))[0]!;
  AutentiqueFalsa.docs.get(esBruno.autentiqueId!)!.s = { visualizadoEm: '2026-11-04T10:00:00Z', assinadoEm: null, recusadoEm: '2026-11-04T10:05:00Z', motivoRecusa: 'Falta a hora extra do dia 12', arquivoAssinadoUrl: null };
  await comoMaster(db, (tx) => tx.update(assinaturaDocumento).set({ sincronizadoEm: null }).where(eq(assinaturaDocumento.tenantId, t.id)));
  await svc.rotina();
  p = await svc.painel(t.id, COMP);
  const esB = p.linhas.find((l) => l.empregadoId === bruno.id)!.espelho!;
  ok(esB.status === 'RECUSADO' && esB.motivoRecusa === 'Falta a hora extra do dia 12', 'conferência periódica pega a recusa com o motivo');

  // ── lembrar / cancelar / trocar ──
  const pendBruno = p.linhas.find((l) => l.empregadoId === bruno.id)!.contracheque!;
  const lem = await svc.lembrar(t.id, [pendBruno.id, ccAna2.id]);
  ok(lem.lembrados === 1 && AutentiqueFalsa.reenvios.at(-1)!.length === 1, 'lembrete só para quem ainda não assinou');
  ok(!!(await falha(svc.cancelar(t.id, ccAna2.id))), 'assinado não cancela');
  const antigo = (await comoMaster(db, (tx) => tx.select().from(assinaturaDocumento).where(eq(assinaturaDocumento.id, pendBruno.id))))[0]!.autentiqueId!;
  await svc.salvarContracheque(t.id, { competencia: COMP, empregadoId: bruno.id, arquivoBase64: (await pdf('Holerite corrigido')).toString('base64'), arquivoNome: 'holerite_bruno_v2.pdf' });
  p = await svc.painel(t.id, COMP);
  ok(AutentiqueFalsa.docs.get(antigo)!.cancelado && p.linhas.find((l) => l.empregadoId === bruno.id)!.contracheque!.status === 'RASCUNHO', 'trocar contracheque enviado: cancela o antigo na Autentique e volta a rascunho');
  env = await svc.enviar(t.id, { competencia: COMP, empregadoIds: [bruno.id] }, 'rh');
  ok(env.enviados === 2, 'reenvia o contracheque novo e o espelho recusado (regerado)');

  // ── app do funcionário ──
  const meus = await svc.meus(t.id, uCaio.id);
  ok(meus.documentos.length === 2 && meus.pendentes === 2, 'Caio vê os 2 documentos pendentes no app');
  const lk = await svc.linkMeu(t.id, uCaio.id, meus.documentos[0]!.id);
  ok(lk.link.startsWith('https://assina.ae/pub-'), 'gera o link de assinatura para o próprio funcionário');
  ok(!!(await falha(svc.linkMeu(t.id, uCaio.id, ccAna2.id))), 'não abre documento de outra pessoa');
  ok((await svc.arquivoMeu(t.id, uCaio.id, meus.documentos[0]!.id)).buffer.subarray(0, 5).toString() === '%PDF-', 'baixa o próprio PDF');
  await svc.salvarConfig(t.id, { mostrarApp: false });
  ok((await svc.meus(t.id, uCaio.id)).documentos.length === 0, '"mostrar no app" desligado: não aparece');

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo');
  await client.end();
  process.exit(falhas ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await client.end(); process.exit(1); });
