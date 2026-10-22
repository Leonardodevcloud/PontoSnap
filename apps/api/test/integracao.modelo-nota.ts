import 'reflect-metadata';
import webpush from 'web-push';
const chaves = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = chaves.publicKey;
process.env.VAPID_PRIVATE_KEY = chaves.privateKey;
process.env.NODE_ENV = 'test';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { schema, comoMaster, tenant, usuario, pessoalNota } from '@ponto/db';
import { PushService } from '../src/notificacao/push.service';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { PessoalService } from '../src/pessoal/pessoal.service';
import { CriptoService } from '../src/common/cripto.service';
import { EmailService } from '../src/email/email.service';
import { TokenService } from '../src/auth/token';
import { AuthService } from '../src/auth/auth.service';
import { PortalService } from '../src/portal/portal.service';
import { ModeloNotaService } from '../src/portal/modelo-nota.service';

/** Modelos de nota: CRUD, padrão por tipo, aplicar, dias marcados, pedido congelado e conferência de código/descrição. */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };
(webpush as unknown as { sendNotification: unknown }).sendNotification = async () => ({ statusCode: 201 });
async function falha(p: Promise<unknown>) { try { await p; return null; } catch (e) { return (e as Error).message; } }
const b64 = (s: string) => Buffer.from(s).toString('base64');

const TOMADOR = '42246432000127';
const TPL = 'Nota fiscal referente ao serviço prestado de coleta e entrega sob demanda prestado no mês de {mes} ({dias})';
const ESPERADA = 'Nota fiscal referente ao serviço prestado de coleta e entrega sob demanda prestado no mês de Outubro (13/10 e 16/10)';

async function main() {
  const push = new PushService(db);
  const pes = new PessoalService(db, new TratamentoService(db), new CriptoService());
  const tokens = new TokenService({ segredoAcesso: 'a', segredoRefresh: 'b', expiraAcesso: '15m', expiraRefresh: '7d' });
  const email = new EmailService();
  const auth = new AuthService(db, tokens, email);
  const portal = new PortalService(db, pes, push, email, auth);
  const mod = new ModeloNotaService(db);

  const CNPJ = `63${String(Date.now()).slice(-12)}`;
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: CNPJ, razaoSocial: 'Loja Autopeças LTDA' }).returning()))[0]!;
  const t2 = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: `64${CNPJ.slice(2)}`, razaoSocial: 'Outra LTDA' }).returning()))[0]!;
  const COMP = '2026-10';
  const SEM = '2026-10-12';
  const emailR = `renata.${CNPJ}@gmail.com`;
  const renata = (await pes.criarPrestador(t.id, { tipo: 'MOTORISTA', nome: 'Renata Lima', documento: `4${CNPJ.slice(-10)}`, valorMensal: 2652, baseDias: 'SEG_SAB', competenciaInicio: COMP, email: emailR }))!;
  const joao = (await pes.criarPrestador(t.id, { tipo: 'MOTORISTA', nome: 'João Souza', documento: null, valorMensal: 2652, baseDias: 'SEG_SAB', competenciaInicio: COMP }))!;
  const carlos = (await pes.criarPrestador(t.id, { tipo: 'MEI', nome: 'Carlos Andrade', documento: null, valorMensal: 2200, baseDias: 'SEG_SAB', competenciaInicio: COMP, funcao: 'Operador' }))!;

  // ── CRUD e validação ──
  ok(!!(await falha(mod.salvar(t.id, null, { nome: 'X', tomadorCnpj: '123', tomadorRazao: 'Tuts', descricao: 'd' }))), 'CNPJ inválido é recusado');
  ok(!!(await falha(mod.salvar(t.id, null, { nome: 'X', tomadorCnpj: TOMADOR, tomadorRazao: 'Tuts', descricao: 'd', codigoServico: '2601011' }))), 'código fora do formato é recusado');
  const mot = await mod.salvar(t.id, null, {
    nome: 'Motoristas — coleta e entrega', padraoTipo: 'MOTORISTA', tomadorCnpj: '42.246.432/0001-27', tomadorRazao: 'Tuts Intermediação de Serviços de Entregas Rápidas LTDA',
    tomadorEndereco: 'Rio Negro, 1030 - Alphaville, Barueri - SP', tomadorTelefone: '(71) 98213-8159', tomadorEmail: 'contato@tutts.com.br',
    codigoServico: '260101', codigoDescricao: 'Serviços de coleta, remessa ou entrega', descricao: TPL,
  });
  ok(mot.codigoServico === '26.01.01' && mot.tomadorCnpj === TOMADOR, 'salva com código e CNPJ normalizados');
  const op = await mod.salvar(t.id, null, { nome: 'Operadores', padraoTipo: 'MEI', tomadorCnpj: CNPJ, tomadorRazao: 'Loja Autopeças LTDA', descricao: '{funcao} — {periodo}' });
  const outro = await mod.salvar(t.id, null, { nome: 'Motoristas — outra operação', tomadorCnpj: TOMADOR, tomadorRazao: 'Tuts', codigoServico: '26.01.01', descricao: 'Entregas da semana {semana}' });

  let lista = await mod.listar(t.id);
  ok(lista.modelos.length === 3 && lista.semModelo.length === 0, 'todos cobertos pelos padrões');
  ok(lista.modelos.find((m) => m.id === mot.id)!.usadoPor === 2 && lista.modelos.find((m) => m.id === op.id)!.usadoPor === 1, 'padrão conta as pessoas do tipo');
  ok((await mod.listar(t2.id)).modelos.length === 0, 'outra empresa não vê os modelos');

  // ── aplicar a pessoas ──
  await mod.aplicar(t.id, outro.id, [joao.id]);
  lista = await mod.listar(t.id);
  ok(lista.modelos.find((m) => m.id === outro.id)!.escolhidoPor === 1 && lista.modelos.find((m) => m.id === mot.id)!.usadoPor === 1, 'João usa o modelo escolhido, não o padrão');
  // novo padrão de motorista tira o anterior
  await mod.salvar(t.id, outro.id, { nome: outro.nome, padraoTipo: 'MOTORISTA', tomadorCnpj: TOMADOR, tomadorRazao: 'Tuts', codigoServico: '26.01.01', descricao: outro.descricao });
  lista = await mod.listar(t.id);
  ok(lista.modelos.find((m) => m.id === mot.id)!.padraoTipo === null && lista.modelos.find((m) => m.id === outro.id)!.padraoTipo === 'MOTORISTA', 'um padrão por tipo');
  await mod.salvar(t.id, mot.id, { ...mot, padraoTipo: 'MOTORISTA' } as never);
  await mod.aplicar(t.id, null, [joao.id]);
  await mod.aplicar(t.id, mot.id, [renata.id]);

  // ── dias marcados na semana ──
  ok(!!(await falha(pes.salvarLancamento(t.id, { pessoaTipo: 'MOTORISTA', pessoaId: renata.id, competencia: COMP, periodo: SEM, diasDatas: ['2026-10-20'] }))), 'dia fora da semana é recusado');
  await pes.salvarLancamento(t.id, { pessoaTipo: 'MOTORISTA', pessoaId: renata.id, competencia: COMP, periodo: SEM, diasDatas: ['2026-10-16', '2026-10-13'] });
  let snap = await pes.competencia(t.id, COMP);
  let sR = snap.motoristas.find((m) => m.id === renata.id)!.semanas.find((s) => s.inicio === SEM)!;
  ok(sR.dias === 2 && sR.diasDatas?.join() === '2026-10-13,2026-10-16' && (sR.diasPossiveis?.length ?? 0) >= 6, 'dias marcados viram a quantidade da semana');
  await pes.salvarLancamento(t.id, { pessoaTipo: 'MOTORISTA', pessoaId: joao.id, competencia: COMP, periodo: SEM, dias: 3 });
  snap = await pes.competencia(t.id, COMP);
  ok(snap.motoristas.find((m) => m.id === joao.id)!.semanas.find((s) => s.inicio === SEM)!.diasDatas == null, 'só a quantidade: sem datas');

  // ── liberar congela o pedido ──
  await pes.fechar(t.id, COMP);
  const lib = await portal.liberar(t.id, { competencia: COMP, tipo: 'MOTORISTA', semanas: [SEM], prazo: null });
  ok(lib.liberadas === 2, `liberou as 2 semanas (${JSON.stringify(lib)})`);
  const notas = await comoMaster(db, (tx) => tx.select().from(pessoalNota).where(eq(pessoalNota.tenantId, t.id)));
  const nR = notas.find((n) => n.pessoaId === renata.id)!;
  const nJ = notas.find((n) => n.pessoaId === joao.id)!;
  ok(nR.instrucoes?.descricao === ESPERADA, `descrição da Renata com os dias: "${nR.instrucoes?.descricao}"`);
  ok(nR.instrucoes?.tomador.cnpj === TOMADOR && nR.instrucoes?.codigoServico === '26.01.01' && nR.instrucoes.valorCent === nR.valorCent, 'tomador, código e valor no pedido');
  ok(nJ.instrucoes?.descricao.includes('(12/10 a 18/10)') === true, `sem dias marcados, vai o período da semana: "${nJ.instrucoes?.descricao}"`);

  // modelo editado depois: a nota já liberada (ainda aguardando) só muda se liberar de novo
  await mod.salvar(t.id, mot.id, { nome: mot.nome, padraoTipo: 'MOTORISTA', tomadorCnpj: TOMADOR, tomadorRazao: mot.tomadorRazao, codigoServico: '26.01.01', descricao: `${TPL}.` });
  const nR1 = (await comoMaster(db, (tx) => tx.select().from(pessoalNota).where(eq(pessoalNota.id, nR.id))))[0]!;
  ok(nR1.instrucoes?.descricao === ESPERADA, 'editar o modelo não mexe no pedido já liberado');
  await portal.liberar(t.id, { competencia: COMP, tipo: 'MOTORISTA', semanas: [SEM], prazo: null });
  const nR2 = (await comoMaster(db, (tx) => tx.select().from(pessoalNota).where(eq(pessoalNota.id, nR.id))))[0]!;
  ok(nR2.instrucoes?.descricao === `${ESPERADA}.`, 'liberar de novo (sem nota enviada) atualiza o pedido');

  // ── app do prestador ──
  const conv = await portal.convidar(t.id, [renata.id]);
  await portal.aceitarConvite((conv[0] as { codigo: string }).codigo, { senha: 'Senha123!' });
  const uR = (await comoMaster(db, (tx) => tx.select().from(usuario).where(eq(usuario.prestadorId, renata.id))))[0]!;
  const eu = await portal.eu(t.id, uR.id);
  const nota = eu.notas.find((n) => n.periodo === SEM)!;
  ok(!!nota.pedido && nota.descricao === nota.pedido.descricao && eu.tomador.cnpj === TOMADOR, 'app mostra o pedido e o tomador do modelo');
  ok(!!nota.textoPedido?.includes('* CNPJ: 42.246.432/0001-27') && nota.textoPedido.includes('* CNAE: 26.01.01') && nota.textoPedido.includes('(13/10 e 16/10)'), '"Copiar tudo" no formato do RH');

  // ── conferência: código e descrição ──
  const xml = (cod: string, desc: string, valor = nota.valorCent) => b64(`<NFSe><infNFSe><nNFSe>55</nNFSe><DPS><infDPS><dhEmi>2026-10-20T10:00:00-03:00</dhEmi>
    <prest><CPF>${renata.documento}</CPF></prest><toma><CNPJ>${TOMADOR}</CNPJ></toma><serv><cServ><cTribNac>${cod}</cTribNac><xDescServ>${desc}</xDescServ></cServ></serv>
    <valores><vServPrest><vServ>${(valor / 100).toFixed(2)}</vServ></vServPrest></valores></infDPS></DPS></infNFSe></NFSe>`);
  const bom = await portal.lerNota(t.id, uR.id, nota.id, { arquivoBase64: xml('260101', `${ESPERADA}.`), arquivoMime: 'application/xml' });
  ok(bom.conferencia?.codigoOk === true && bom.conferencia?.descricaoOk === true && bom.conferencia.tomadorOk === true && bom.conferencia.bate, 'nota certa: código, descrição e tomador conferem');
  const codErr = await portal.lerNota(t.id, uR.id, nota.id, { arquivoBase64: xml('170201', `${ESPERADA}.`), arquivoMime: 'application/xml' });
  ok(codErr.conferencia?.codigoOk === false && !codErr.conferencia.bate, 'código errado reprova');
  const descErr = await portal.lerNota(t.id, uR.id, nota.id, { arquivoBase64: xml('260101', 'Serviço de entrega'), arquivoMime: 'application/xml' });
  ok(descErr.conferencia?.descricaoOk === false && descErr.conferencia.bate, 'descrição diferente só avisa (não reprova)');
  ok(descErr.lido?.codigoServico === '26.01.01' && descErr.lido?.descricao === 'Serviço de entrega', 'prévia devolve o que leu');

  const env = await portal.enviarNota(t.id, uR.id, nota.id, { arquivoBase64: xml('260101', `${ESPERADA}.`), arquivoNome: 'nota.xml', arquivoMime: 'application/xml', numero: '55', data: '2026-10-20' });
  ok(env.status === 'ENVIADA', 'nota enviada');
  const fila = await portal.filaConferir(t.id);
  const f = fila.find((x) => x.nome === 'Renata Lima')!;
  ok(!!f && f.pedido?.codigoServico === '26.01.01' && f.conferencia?.codigoOk === true, 'fila de conferência traz o pedido');
  // enviada: liberar de novo não troca o pedido
  await mod.salvar(t.id, mot.id, { nome: mot.nome, padraoTipo: 'MOTORISTA', tomadorCnpj: TOMADOR, tomadorRazao: mot.tomadorRazao, codigoServico: '26.01.01', descricao: 'Outro texto' });
  await portal.liberar(t.id, { competencia: COMP, tipo: 'MOTORISTA', semanas: [SEM], prazo: null });
  const nR3 = (await comoMaster(db, (tx) => tx.select().from(pessoalNota).where(eq(pessoalNota.id, nR.id))))[0]!;
  ok(nR3.instrucoes?.descricao === `${ESPERADA}.`, 'nota já enviada: pedido fica como estava');

  // ── painel e excluir ──
  const painel = await portal.painel(t.id, COMP);
  ok(painel.linhas.find((l) => l.id === renata.id)!.modeloNota?.padrao === false && painel.linhas.find((l) => l.id === joao.id)!.modeloNota?.padrao === true, 'painel mostra o modelo (escolhido × padrão)');
  await mod.excluir(t.id, op.id);
  lista = await mod.listar(t.id);
  ok(lista.semModelo.some((p) => p.id === carlos.id), 'sem o modelo de MEI, o Carlos aparece como "sem modelo"');

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK');
  await client.end();
  process.exit(falhas ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await client.end(); process.exit(1); });
