import 'reflect-metadata';
import webpush from 'web-push';
const chaves = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = chaves.publicKey;
process.env.VAPID_PRIVATE_KEY = chaves.privateKey;
process.env.NODE_ENV = 'test';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { schema, comoMaster, tenant, usuario, pushSubscription, pessoalNota } from '@ponto/db';
import { PushService } from '../src/notificacao/push.service';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { PessoalService } from '../src/pessoal/pessoal.service';
import { CriptoService } from '../src/common/cripto.service';
import { EmailService } from '../src/email/email.service';
import { TokenService } from '../src/auth/token';
import { AuthService } from '../src/auth/auth.service';
import { PortalService } from '../src/portal/portal.service';
import { ComunicacaoService } from '../src/comunicacao/comunicacao.service';

/** Portal do prestador: liberar, convite, login por CPF, contestar, enviar, conferir, pagar, lembrete, ZIP e avisos. */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };
const recebidas: { titulo: string; corpo: string; endpoint: string }[] = [];
(webpush as unknown as { sendNotification: unknown }).sendNotification = async (sub: { endpoint: string }, payload: string) => {
  const p = JSON.parse(payload); recebidas.push({ titulo: p.title, corpo: p.body, endpoint: sub.endpoint }); return { statusCode: 201 };
};
async function falha(p: Promise<unknown>) { try { await p; return null; } catch (e) { return (e as Error).message; } }
const b64 = (s: string) => Buffer.from(s).toString('base64');

async function main() {
  const push = new PushService(db);
  const pes = new PessoalService(db, new TratamentoService(db), new CriptoService());
  const tokens = new TokenService({ segredoAcesso: 'a', segredoRefresh: 'b', expiraAcesso: '15m', expiraRefresh: '7d' });
  const email = new EmailService();
  const auth = new AuthService(db, tokens, email);
  const portal = new PortalService(db, pes, push, email, auth);
  const com = new ComunicacaoService(db, push);

  const CNPJ = `61${String(Date.now()).slice(-12)}`;
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: CNPJ, razaoSocial: 'Auto Norte Maceió LTDA' }).returning()))[0]!;
  const t2 = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: `62${CNPJ.slice(2)}`, razaoSocial: 'Outra LTDA' }).returning()))[0]!;
  const COMP = '2026-09';
  const cpf = `3${CNPJ.slice(-10)}`;
  const carlos = await pes.criarPrestador(t.id, { tipo: 'MEI', nome: 'Carlos Andrade', documento: cpf, valorMensal: 2200, baseDias: 'SEG_SAB', competenciaInicio: COMP, funcao: 'Serviço de instalação', telefone: '(82) 99999-1234' });
  const paula = await pes.criarPrestador(t.id, { tipo: 'MEI', nome: 'Paula Santos', documento: null, valorMensal: 2100, baseDias: 'SEG_SAB', competenciaInicio: COMP });
  const renata = await pes.criarPrestador(t.id, { tipo: 'MOTORISTA', nome: 'Renata Lima', documento: `4${CNPJ.slice(-10)}`, valorMensal: 2652, baseDias: 'SEG_SAB', competenciaInicio: COMP });
  await pes.salvarLancamento(t.id, { pessoaTipo: 'MEI', pessoaId: carlos!.id, competencia: COMP, heMin: 360, faltas: 1, meta: 100 });

  // ── liberar MEI ──
  ok(!!(await falha(portal.liberar(t.id, { competencia: COMP, tipo: 'MEI' }))), 'MEI só libera com o mês fechado');
  await pes.fechar(t.id, COMP);
  let lib = await portal.liberar(t.id, { competencia: COMP, tipo: 'MEI', prazo: '2026-10-05', pedirConfirmacao: true });
  ok(lib.liberadas === 2 && lib.semAcesso === 2 && lib.notificados === 0, `liberou 2 MEI, nenhum com acesso ainda (${JSON.stringify(lib)})`);
  const snap = await pes.competencia(t.id, COMP);
  const liqCarlos = snap.mei.find((m) => m.id === carlos!.id)!.liquidoCent;

  // ── convite e primeiro acesso ──
  const conv = await portal.convidar(t.id, [carlos!.id, paula!.id]);
  const cc = conv.find((c) => c.prestadorId === carlos!.id)! as { codigo: string; whatsapp: string | null; mensagem: string };
  const cp = conv.find((c) => c.prestadorId === paula!.id)! as { erro?: string };
  ok(!!cp.erro, 'sem CPF/CNPJ não gera convite');
  ok(!!cc.whatsapp?.startsWith('https://wa.me/5582999991234') && cc.mensagem.includes('Auto Norte Maceió') && !cc.mensagem.includes('LTDA'), 'convite com WhatsApp e nome da empresa sem "LTDA"');
  const info = await portal.convite(cc.codigo.toLowerCase().replace('-', ''));
  ok(info.nome === 'Carlos' && info.tipoDocumento === 'CPF' && !info.expirado, 'link abre com o nome e pede o CPF (código sem hífen/minúsculo também vale)');
  ok(!!(await falha(portal.aceitarConvite(cc.codigo, { documento: '00000000000', senha: 'Senha123!' }))), 'CPF errado não cria acesso');
  const sess = await portal.aceitarConvite(cc.codigo, { documento: cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'), senha: 'Senha123!', telefone: '82 98888-7777' });
  ok(sess.perfil === 'PRESTADOR' && !!sess.accessToken && sess.tenantId === t.id, 'aceite cria a conta PRESTADOR e já entra');
  ok(!!(await falha(portal.aceitarConvite(cc.codigo, { documento: cpf, senha: 'Senha123!' }))), 'link é de uso único');
  const login = await auth.login(cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'), 'Senha123!');
  ok(login.perfil === 'PRESTADOR', 'login pelo CPF formatado');
  ok(!!(await falha(auth.login(cpf, 'errada123'))), 'senha errada recusa');
  const uCarlos = (await comoMaster(db, (tx) => tx.select().from(usuario).where(eq(usuario.prestadorId, carlos!.id))))[0]!;
  await comoMaster(db, (tx) => tx.insert(pushSubscription).values({ tenantId: t.id, usuarioId: uCarlos.id, endpoint: `https://push.exemplo/${CNPJ}/carlos`, p256dh: 'p', auth: 'a' }));

  lib = await portal.liberar(t.id, { competencia: COMP, tipo: 'MEI', prazo: '2026-10-05', pedirConfirmacao: true });
  ok(lib.mantidas === 2 && lib.notificados === 0, 'liberar de novo sem mudança não notifica');

  // ── app do prestador ──
  let eu = await portal.eu(t.id, uCarlos.id);
  const nota = eu.notas[0]!;
  const soma = nota.detalhe.reduce((a, l) => a + (l.tipo === 'MENOS' ? -l.valorCent : l.valorCent), 0);
  ok(eu.notas.length === 1 && nota.valorCent === liqCarlos && soma === liqCarlos, `valor da nota = líquido do fechamento (${nota.valorCent}) e o detalhe fecha`);
  ok(eu.tomador.nome === 'Auto Norte Maceió LTDA' && eu.tomador.cnpj === CNPJ && nota.descricao.startsWith('Serviço de instalação — competência 09/2026'), 'dados para emitir: tomador e descrição');
  ok(eu.prestador.telefone === '82988887777', 'celular do aceite atualiza o cadastro');
  ok(!!(await falha(portal.confirmar(t.id, uCarlos.id, nota.id, { confere: false }))), 'contestar exige motivo');
  await portal.confirmar(t.id, uCarlos.id, nota.id, { confere: false, motivo: 'Fiz 8h de extra, não 6h' });
  let painel = await portal.painel(t.id, COMP);
  ok(painel.linhas.find((l) => l.id === carlos!.id)!.situacao === 'CONTESTOU' && painel.totais.contestaram === 1, 'RH vê a contestação');
  const pdf = { arquivoBase64: b64('%PDF-1.4 nota'), arquivoNome: 'NFSe_127.pdf', arquivoMime: 'application/pdf', numero: '127', data: '2026-10-02', valor: liqCarlos / 100 };
  ok(!!(await falha(portal.enviarNota(t.id, uCarlos.id, nota.id, pdf))), 'contestou: não envia até o RH responder');
  recebidas.length = 0;
  await portal.responder(t.id, nota.id, 'Conferimos o ponto: foram 6h. Valor mantido.');
  ok(recebidas.some((r) => r.titulo.startsWith('O RH respondeu')), 'prestador recebe a resposta no celular');
  let env = await portal.enviarNota(t.id, uCarlos.id, nota.id, pdf);
  ok(env.status === 'ENVIADA' && env.conferencia.bate && env.conferencia.origem === 'INFORMADO', 'nota enviada (PDF), conferência: bate');
  const fila = await portal.filaConferir(t.id);
  ok(fila.length === 1 && fila[0]!.nome === 'Carlos Andrade' && fila[0]!.nf.numero === '127' && !!fila[0]!.nf.arquivo, 'fila de conferência com número e arquivo');
  const snap2 = await pes.competencia(t.id, COMP);
  ok(snap2.mei.find((m) => m.id === carlos!.id)!.lanc.nfNumero === '127' && !!snap2.mei.find((m) => m.id === carlos!.id)!.lanc.nfArquivo, 'a Gestão de pessoal já mostra a NF (mesmo lugar de sempre)');

  recebidas.length = 0;
  await portal.recusar(t.id, nota.id, 'Valor diferente', 'rh');
  eu = await portal.eu(t.id, uCarlos.id);
  ok(eu.notas[0]!.status === 'RECUSADA' && eu.notas[0]!.motivoRecusa === 'Valor diferente' && recebidas.some((r) => r.titulo.startsWith('O RH pediu outra nota')), 'recusa com motivo chega no app e no celular');
  const xml = `<NFSe><infNFSe><nNFSe>128</nNFSe><DPS><infDPS><dhEmi>2026-10-03T10:00:00-03:00</dhEmi><prest><CNPJ>${cpf}</CNPJ></prest><toma><CNPJ>${CNPJ}</CNPJ></toma>
    <valores><vServPrest><vServ>${((liqCarlos - 1000) / 100).toFixed(2)}</vServ></vServPrest></valores></infDPS></DPS></infNFSe></NFSe>`;
  env = await portal.enviarNota(t.id, uCarlos.id, nota.id, { arquivoBase64: b64(xml), arquivoNome: 'nota.xml', arquivoMime: 'text/xml', numero: '999', data: '2026-10-03' });
  ok(env.conferencia.origem === 'XML' && env.conferencia.valorBate === false && env.conferencia.tomadorOk === true && env.nf.numero === null, 'XML: lê a nota, aponta valor diferente e tomador certo');
  const snap3 = await pes.competencia(t.id, COMP);
  ok(snap3.mei.find((m) => m.id === carlos!.id)!.lanc.nfNumero === '128', 'número veio do XML (não do digitado)');
  recebidas.length = 0;
  await portal.aprovar(t.id, [nota.id], 'rh');
  ok(recebidas.some((r) => r.titulo.startsWith('Nota aprovada')), 'aprovação avisa o prestador');
  ok(!!(await falha(portal.enviarNota(t.id, uCarlos.id, nota.id, pdf))), 'nota aprovada não aceita reenvio');
  await portal.pagar(t.id, [nota.id]);
  eu = await portal.eu(t.id, uCarlos.id);
  ok(eu.notas[0]!.pago && eu.notas[0]!.valorPagoCent === liqCarlos, 'pagamento registrado aparece no app');

  // ── motorista por semana ──
  const sem = snap.semanas.find((s) => snap.motoristas.find((m) => m.id === renata!.id)!.semanas.some((x) => x.inicio === s.inicio && x.dias > 0))!;
  const libM = await portal.liberar(t.id, { competencia: COMP, tipo: 'MOTORISTA', semanas: [sem.inicio], prazo: null });
  ok(libM.liberadas === 1 && libM.semAcesso === 1, 'semana do motorista liberada');
  painel = await portal.painel(t.id, COMP);
  const lr = painel.linhas.find((l) => l.id === renata!.id)!;
  ok(lr.unidades.some((u) => u.periodo === sem.inicio && u.situacao === 'FALTA') && lr.situacao === 'FALTA' && lr.acesso.status === 'SEM', 'painel: motorista com a semana faltando nota, sem acesso');
  ok(painel.semanas.find((s) => s.inicio === sem.inicio)!.liberada, 'semana marcada como liberada');

  // ── valor corrigido depois de enviada ──
  await pes.reabrir(t.id, COMP);
  await pes.salvarLancamento(t.id, { pessoaTipo: 'MEI', pessoaId: carlos!.id, competencia: COMP, meta: 150 });
  await pes.fechar(t.id, COMP);
  recebidas.length = 0;
  lib = await portal.liberar(t.id, { competencia: COMP, tipo: 'MEI', prazo: '2026-10-05' });
  eu = await portal.eu(t.id, uCarlos.id);
  ok(lib.alteradas === 1 && eu.notas[0]!.status === 'RECUSADA' && eu.notas[0]!.versao === 2 && eu.notas[0]!.motivoRecusa!.includes('corrigido'), 'valor mudou após aprovada: pede outra nota (versão 2)');
  ok(recebidas.some((r) => r.titulo.includes('o valor mudou')), 'prestador é avisado que o valor mudou');

  // ── lembretes ──
  recebidas.length = 0;
  const lem = await portal.lembrar(t.id, { competencia: COMP });
  ok(lem.enviados === 1 && lem.semAcesso === 2, `lembrete manual: 1 com app, 2 sem (${JSON.stringify(lem)})`);
  await comoMaster(db, (tx) => tx.update(pessoalNota).set({ liberadoEm: new Date('2026-10-01T12:00:00Z'), lembreteEm: null }).where(eq(pessoalNota.id, nota.id)));
  const as10h = new Date('2026-10-03T13:00:00Z');
  const r1 = await portal.rotina(as10h);
  const r2 = await portal.rotina(new Date('2026-10-03T20:00:00Z'));
  const r0 = await portal.rotina(new Date('2026-10-04T10:00:00Z'));
  ok(r1.lembretes >= 1 && r2.lembretes === 0 && r0.lembretes === 0, 'rotina: 1 lembrete por dia, só a partir das 9h');
  const antes = (await comoMaster(db, (tx) => tx.select().from(pessoalNota).where(eq(pessoalNota.id, nota.id))))[0]!.lembretes;
  await portal.rotina(new Date('2026-10-20T13:00:00Z'));
  const depois = (await comoMaster(db, (tx) => tx.select().from(pessoalNota).where(eq(pessoalNota.id, nota.id))))[0]!.lembretes;
  ok(antes === depois, 'para de lembrar 7 dias depois do prazo');

  // ── ZIP ──
  const z = await portal.zip(t.id, COMP);
  ok(z.arquivos === 1 && z.buffer.subarray(0, 2).toString() === 'PK', 'ZIP com as notas do mês');

  // ── isolamento ──
  ok(!!(await falha(portal.notaRh(t2.id, nota.id))), 'outra empresa não enxerga a nota');
  ok(!!(await falha(portal.eu(t.id, (await comoMaster(db, (tx) => tx.insert(usuario).values({ tenantId: t.id, email: `x${CNPJ}@x.com`, senhaHash: 'x', perfil: 'RH' }).returning()))[0]!.id))), 'conta sem prestador não abre o portal');

  // ── comunicação interna para prestadores ──
  const base = { blocos: [{ tipo: 'TEXTO' as const, texto: 'Oi prestadores' }], pedirCiencia: true, fixado: false, notificar: false, lembrar: false, reacoes: true };
  const c1 = await com.salvar(t.id, null, { ...base, titulo: 'Só prestadores', publico: { tipo: 'TODOS', valores: [], grupo: 'PRESTADORES' } }, { id: uCarlos.id, nome: 'RH' });
  const p1 = await com.efetivarPublicacao(t.id, c1.id); await p1.envio;
  const c2 = await com.salvar(t.id, null, { ...base, titulo: 'Só CLT (antigo)', publico: { tipo: 'TODOS', valores: [] } }, { id: uCarlos.id, nome: 'RH' });
  const p2 = await com.efetivarPublicacao(t.id, c2.id); await p2.envio;
  ok(p1.destinatarios === 1 && p2.destinatarios === 0, 'público "prestadores" alcança quem tem app; o antigo "todos" continua só CLT');
  const pessoaCarlos = await com.empregadoDoUsuario(t.id, uCarlos.id);
  const meus = await com.meus(t.id, pessoaCarlos);
  ok(pessoaCarlos === carlos!.id && meus.itens.length === 1, 'prestador vê o comunicado em Avisos');
  await com.ciente(t.id, pessoaCarlos, c1.id);
  const det = await com.obter(t.id, c1.id);
  ok(det.destinatarios[0]!.nome === 'Carlos Andrade' && !!det.destinatarios[0]!.cienteEm, 'ciência do prestador aparece para o RH');
  const opc = await com.opcoesPublico(t.id);
  ok(opc.grupos.prestadores === 1 && opc.grupos.prestadoresTotal === 3, 'opções do público contam prestadores');
  const pdfC = await com.pdfCiencia(t.id, c1.id);
  ok(pdfC.buffer.length > 1000, 'PDF de ciência com prestador');

  // ── cortar acesso ──
  await portal.definirAcesso(t.id, carlos!.id, false);
  ok(!!(await falha(auth.login(cpf, 'Senha123!'))), 'acesso cortado: login recusado');
  painel = await portal.painel(t.id, COMP);
  ok(painel.linhas.find((l) => l.id === carlos!.id)!.acesso.status === 'BLOQUEADO', 'painel mostra bloqueado');

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo');
  await client.end();
  process.exit(falhas ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await client.end(); process.exit(1); });
