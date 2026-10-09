import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema, comoMaster, tenant, empregado, pontoRep, pontoHorarioContratual, pontoMarcacao, pontoFeriado, pessoalNfArquivo } from '@ponto/db';
import { eq } from 'drizzle-orm';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { PessoalService } from '../src/pessoal/pessoal.service';
import { CriptoService } from '../src/common/cripto.service';
import { diasDoMes, diaSemana } from '../src/pessoal/calculo';

/**
 * Gestão de Pessoal contra Postgres real:
 *  - CLT vem do ponto (sem cadastro), valor do dia pelo mês, falta do ponto
 *  - benefício de outubro carregado no fechamento de setembro, com acerto
 *    (feriado pago + falta) — e outubro usa o que setembro gravou
 *  - MEI bruto/líquido com meta paga
 *  - tirar do mês não mexe nos outros meses; "daqui em diante" sim
 *  - mês fechado não aceita edição
 */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const trat = new TratamentoService(db);
const pes = new PessoalService(db, trat, new CriptoService());

let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };
const em = (data: string, hm: string) => new Date(`${data}T${hm}:00-0300`);
const erroDe = async (f: () => Promise<unknown>) => { try { await f(); return ''; } catch (e) { return (e as Error).message; } };

async function main() {
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: '44444444000155', razaoSocial: 'PESSOAL LTDA' }).returning()))[0]!;
  const rep = (await comoMaster(db, (tx) => tx.insert(pontoRep).values({
    tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: '44444444000155', razaoSocial: 'PESSOAL LTDA',
    numeroInpi: 'BR512024004444-4', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188',
  }).returning()))[0]!;
  const hor = (await comoMaster(db, (tx) => tx.insert(pontoHorarioContratual).values({
    tenantId: t.id, codigo: 'ADM', durJornadaMin: 480, diasSemana: [1, 2, 3, 4, 5], regime: 'normal',
    pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }],
  }).returning()))[0]!;
  await comoMaster(db, (tx) => tx.insert(pontoFeriado).values([
    { tenantId: t.id, data: '2026-09-07', nome: 'Independência' },
    { tenantId: t.id, data: '2026-10-12', nome: 'Nossa Senhora Aparecida' },
  ] as never));
  const ana = (await comoMaster(db, (tx) => tx.insert(empregado).values({
    tenantId: t.id, cpf: '40000000001', nome: 'Ana CLT', horarioContratualId: hor.id, salarioMensal: '2100.00',
  }).returning()))[0]!;

  // Setembro: trabalhou todo dia útil, menos o feriado 07/09 e a falta de 15/09.
  let nsr = 1;
  const batidas = diasDoMes('2026-09').filter((d) => { const w = diaSemana(d); return w >= 1 && w <= 5 && d !== '2026-09-07' && d !== '2026-09-15'; })
    .flatMap((d) => [em(d, '08:00'), em(d, '12:00'), em(d, '13:00'), em(d, '17:00')]);
  await comoMaster(db, (tx) => tx.insert(pontoMarcacao).values(batidas.map((b) => ({
    tenantId: t.id, repId: rep.id, nsr: nsr, cpf: ana.cpf, dtMarcacao: b, coletor: 1, hashRegistro: String(nsr++).padStart(64, '0'),
  }))));

  await pes.salvarConfigClt(t.id, ana.id, { cargo: 'Auxiliar', vrDia: 25, cestaMensal: 0, vtTipo: 'DIA', vtValor: 10, chavePix: null, vigenteDesde: '2026-09' });
  // Beto não tem valor próprio: segue o padrão da empresa.
  const beto = (await comoMaster(db, (tx) => tx.insert(empregado).values({
    tenantId: t.id, cpf: '40000000002', nome: 'Beto Padrão', horarioContratualId: hor.id, salarioMensal: '1800.00',
  }).returning()))[0]!;
  await pes.salvarPadrao(t.id, { vrDia: 20, cestaMensal: 0, vtTipo: 'DIA', vtValor: 8, vigenteDesde: '2026-09' });

  // ── setembro ──
  const set = await pes.competencia(t.id, '2026-09');
  const a = set.clt.find((c) => c.empregadoId === ana.id)!;
  ok(!!a, 'CLT aparece sem cadastro no módulo (veio do ponto)');
  ok(a.diasMes === 21, `valor do dia usa os dias úteis de setembro: 22 − feriado = 21 (${a.diasMes})`);
  ok(a.valorDiaMesCent === 10000, `R$ 2.100 ÷ 21 = R$ 100,00 (${a.valorDiaMesCent})`);
  ok(a.faltasDias.join() === '2026-09-15', `falta do ponto: 15/09 (${a.faltasDias.join()})`);
  ok(a.descontosCent > 0, `falta descontada pela regra do ponto (${a.descontosCent})`);
  ok(a.beneficios.pagosEstimado, 'primeiro mês: dias pagos estimados pelo calendário da escala');
  ok(a.beneficios.naoUsados.map((x) => `${x.data}:${x.motivo}`).join() === '2026-09-07:feriado,2026-09-15:falta',
    `acerto de setembro = feriado + falta (${a.beneficios.naoUsados.map((x) => x.motivo).join()})`);
  ok(a.beneficios.diasProx === 21, `carga de outubro: 22 dias úteis − 12/10 = 21 (${a.beneficios.diasProx})`);
  ok(a.beneficios.vrProxCent === 21 * 2500 && a.beneficios.vtProxCent === 21 * 1000, 'VR e VT de outubro por dia');
  ok(a.beneficios.acertoCent === 2 * 2500 + 2 * 1000, `acerto = 2 dias × (VR + VT) = R$ 70 (${a.beneficios.acertoCent})`);
  ok(a.beneficios.cargaCent === 21 * 3500 - 7000, `carga = R$ 735 − R$ 70 (${a.beneficios.cargaCent})`);
  ok(a.custoBrutoCent === 210000 + 0 - a.descontosCent + 21 * 3500, 'custo bruto não tira o acerto (já foi pago)');
  ok(a.config.origem === 'PROPRIO', `Ana usa valor próprio (${a.config.origem})`);
  const b = set.clt.find((c) => c.empregadoId === beto.id)!;
  ok(b.config.origem === 'PADRAO' && b.config.vrDiaCent === 2000 && b.config.vtValorCent === 800, 'Beto, sem valor próprio, herda o padrão da empresa');
  ok(set.padrao?.vrDiaCent === 2000, 'padrão vigente aparece na competência');

  // ── cesta básica: assiduidade + carência ──
  await pes.salvarConfigClt(t.id, ana.id, { cargo: 'Auxiliar', vrDia: 25, cestaMensal: 80, vtTipo: 'DIA', vtValor: 10, vigenteDesde: '2026-09' });
  const caio = (await comoMaster(db, (tx) => tx.insert(empregado).values({
    tenantId: t.id, cpf: '40000000003', nome: 'Caio Assíduo', horarioContratualId: hor.id, salarioMensal: '1800.00', dataInicioPonto: '2026-08-01',
  }).returning()))[0]!;
  const bsCaio = diasDoMes('2026-09').filter((d) => { const w = diaSemana(d); return w >= 1 && w <= 5 && d !== '2026-09-07'; })
    .flatMap((d) => [em(d, '08:00'), em(d, '12:00'), em(d, '13:00'), em(d, '17:00')]);
  await comoMaster(db, (tx) => tx.insert(pontoMarcacao).values(bsCaio.map((b) => ({
    tenantId: t.id, repId: rep.id, nsr: nsr, cpf: caio.cpf, dtMarcacao: b, coletor: 1, hashRegistro: String(nsr++).padStart(64, '0'),
  }))));
  await pes.salvarConfigClt(t.id, caio.id, { vrDia: 25, cestaMensal: 80, vtTipo: 'NENHUM', vtValor: 0, vigenteDesde: '2026-09' });
  let c1 = await pes.competencia(t.id, '2026-09');
  const anaC = c1.clt.find((c) => c.empregadoId === ana.id)!;
  ok(anaC.beneficios.cestaStatus === 'PERDIDA_FALTA' && anaC.beneficios.cestaCent === 0, `Ana faltou em 15/09: perde a cesta (${anaC.beneficios.cestaStatus})`);
  let caioC = c1.clt.find((c) => c.empregadoId === caio.id)!;
  ok(caioC.beneficios.cestaStatus === 'CARENCIA' && caioC.beneficios.cestaDesde === '2026-11' && caioC.beneficios.cestaDesdeOrigem === 'AUTO',
    `Caio começou em agosto: cesta só a partir de novembro (${caioC.beneficios.cestaStatus} / ${caioC.beneficios.cestaDesde})`);
  await pes.definirInicioCesta(t.id, caio.id, '2026-09');
  c1 = await pes.competencia(t.id, '2026-09');
  caioC = c1.clt.find((c) => c.empregadoId === caio.id)!;
  ok(caioC.beneficios.cestaStatus === 'PAGA' && caioC.beneficios.cestaCent === 8000 && caioC.beneficios.cestaDesdeOrigem === 'MANUAL',
    `início definido em setembro e sem falta: cesta paga (${caioC.beneficios.cestaCent})`);
  ok(caioC.beneficios.cargaCent === caioC.beneficios.vrProxCent + 8000 - caioC.beneficios.acertoCent, 'cesta entra na carga');
  await pes.definirInicioCesta(t.id, caio.id, null);
  ok((await pes.competencia(t.id, '2026-09')).clt.find((c) => c.empregadoId === caio.id)!.beneficios.cestaDesde === '2026-11', 'limpar volta ao automático (3 meses)');
  await pes.definirInicioCesta(t.id, caio.id, '2026-09');

  // ── MEI ──
  const mei = await pes.criarPrestador(t.id, { tipo: 'MEI', nome: 'Igor MEI', documento: '60.874.544/0001-04', funcao: 'Vendedor', empresa: ' Fiix Peças ', valorMensal: 2600, baseDias: 'SEG_SAB', competenciaInicio: '2026-09' });
  await pes.salvarLancamento(t.id, { pessoaTipo: 'MEI', pessoaId: mei!.id, competencia: '2026-09', meta: 500, metaPaga: true, metaPagaEm: '2026-09-05', faltas: 1 });
  await pes.criarDebito(t.id, { pessoaTipo: 'MEI', pessoaId: mei!.id, descricao: 'Notebook', valorTotal: 300, parcelas: 2, competenciaInicio: '2026-09' });
  const set2 = await pes.competencia(t.id, '2026-09');
  const m = set2.mei.find((x) => x.id === mei!.id)!;
  // setembro seg–sáb = 26, − 07/09 = 25 dias → dia = 104,00
  ok(m.diasMes === 25 && m.valorDiaCent === 10400, `MEI: 25 dias, dia R$ 104 (${m.diasMes} / ${m.valorDiaCent})`);
  ok(m.brutoCent === 260000 - 10400 + 50000, `bruto (NF) = 2.600 − falta + meta (${m.brutoCent})`);
  ok(m.liquidoCent === m.brutoCent - 15000 - 50000, `líquido = bruto − parcela 150 − meta já paga (${m.liquidoCent})`);
  ok(set2.debitos.some((d) => d.descricao === 'Notebook' && d.parcelaAtual === 1), 'débito aparece como parcela 1/2');
  ok(set2.pendencias.nfMei === 1, 'NF do MEI pendente sinalizada');

  // ── pagamento: valor e hora ──
  ok(m.empresa === 'Fiix Peças', `empresa gravada (${m.empresa})`);
  ok(m.lanc.valorPagoCent === null && m.lanc.pagoEm === null, 'sem pagamento registrado');
  ok((await erroDe(() => pes.registrarPagamento(t.id, { pessoaTipo: 'MEI', pessoaId: mei!.id, competencia: '2026-09', pago: true }))).includes('valor'),
    'marcar pago exige o valor');
  const reg = await pes.registrarPagamento(t.id, { pessoaTipo: 'MEI', pessoaId: mei!.id, competencia: '2026-09', pago: true, valorPago: 2000 });
  ok(reg.valorPagoCent === 200000 && !!reg.pagoEm, `pagamento registrado com valor e hora (${reg.pagoEm})`);
  let mp = (await pes.competencia(t.id, '2026-09')).mei.find((x) => x.id === mei!.id)!;
  ok(mp.lanc.pago && mp.lanc.valorPagoCent === 200000 && mp.lanc.pagoEm === reg.pagoEm, 'competência mostra pago, valor e hora');
  ok(mp.brutoCent === m.brutoCent && mp.lanc.metaCent === 50000 && mp.lanc.faltas === 1, 'registrar pagamento não mexe no lançamento');
  await pes.registrarPagamento(t.id, { pessoaTipo: 'MEI', pessoaId: mei!.id, competencia: '2026-09', pago: false });
  mp = (await pes.competencia(t.id, '2026-09')).mei.find((x) => x.id === mei!.id)!;
  ok(!mp.lanc.pago && mp.lanc.valorPagoCent === null && mp.lanc.pagoEm === null, 'desmarcar apaga valor e hora');
  // pelo painel (salvarLancamento): pago grava a hora uma vez só
  await pes.salvarLancamento(t.id, { pessoaTipo: 'MEI', pessoaId: mei!.id, competencia: '2026-09', pago: true, valorPago: 1000 });
  const h1 = (await pes.competencia(t.id, '2026-09')).mei.find((x) => x.id === mei!.id)!.lanc.pagoEm;
  await new Promise((r) => setTimeout(r, 30));
  await pes.salvarLancamento(t.id, { pessoaTipo: 'MEI', pessoaId: mei!.id, competencia: '2026-09', pago: true });
  const h2 = (await pes.competencia(t.id, '2026-09')).mei.find((x) => x.id === mei!.id)!.lanc;
  ok(!!h1 && h1 === h2.pagoEm && h2.valorPagoCent === 100000, 'salvar de novo mantém a hora do primeiro pagamento');
  await pes.salvarLancamento(t.id, { pessoaTipo: 'MEI', pessoaId: mei!.id, competencia: '2026-09', pago: false });
  // motorista: registra no mês e marca as semanas
  const mot = await pes.criarPrestador(t.id, { tipo: 'MOTORISTA', nome: 'Rui Mot', valorMensal: 2600, baseDias: 'SEG_SEX', competenciaInicio: '2026-09', empresa: 'IG Express' });
  const c0 = await pes.competencia(t.id, '2026-09');
  const mo = c0.motoristas.find((x) => x.id === mot!.id)!;
  const semDias = mo.semanas.filter((x) => x.dias > 0).map((x) => x.inicio);
  await pes.registrarPagamento(t.id, { pessoaTipo: 'MOTORISTA', pessoaId: mot!.id, competencia: '2026-09', pago: true, valorPago: mo.liquidoCent / 100, semanas: semDias });
  const mo2 = (await pes.competencia(t.id, '2026-09')).motoristas.find((x) => x.id === mot!.id)!;
  ok(mo2.pagamento.pago && mo2.pagamento.valorPagoCent === mo.liquidoCent && mo2.semanas.filter((x) => x.dias > 0).every((x) => x.pago),
    `motorista: pagamento do mês + semanas marcadas (${mo2.pagamento.valorPagoCent})`);
  ok(mo2.totalCent === mo.totalCent && mo2.empresa === 'IG Express', 'total do motorista não muda; empresa gravada');
  await pes.editarPrestador(t.id, mot!.id, { empresa: '' });
  ok((await pes.competencia(t.id, '2026-09')).motoristas.find((x) => x.id === mot!.id)!.empresa === null, 'empresa vazia vira nula');
  await pes.excluir(t.id, { pessoaTipo: 'MOTORISTA', pessoaId: mot!.id, competencia: '2026-09', escopo: 'DIANTE' });

  // ── tirar do mês ──
  const ex = await pes.excluir(t.id, { pessoaTipo: 'MEI', pessoaId: mei!.id, competencia: '2026-08', escopo: 'MES' });
  ok((await pes.competencia(t.id, '2026-09')).mei.length === 1, 'tirar de agosto não mexe em setembro');
  await pes.desfazerExclusao(t.id, ex!.id);

  // ── reajuste do contrato com vigência ──
  ok((await erroDe(() => pes.editarPrestador(t.id, mei!.id, { valorMensal: 3120 }))).includes('a partir de'), 'reajuste sem "a partir de" é recusado');
  await pes.editarPrestador(t.id, mei!.id, { valorMensal: 3120, vigenteDesde: '2026-11', nome: 'Igor MEI Lima' });
  const vSet = (await pes.competencia(t.id, '2026-09')).mei.find((x) => x.id === mei!.id)!;
  const vOut = (await pes.competencia(t.id, '2026-10')).mei.find((x) => x.id === mei!.id)!;
  const vNov = (await pes.competencia(t.id, '2026-11')).mei.find((x) => x.id === mei!.id)!;
  ok(vSet.valorCent === 260000 && vOut.valorCent === 260000, `setembro e outubro (abertos) continuam R$ 2.600 (${vSet.valorCent}/${vOut.valorCent})`);
  ok(vNov.valorCent === 312000 && vNov.valorDesde === '2026-11', `novembro em diante: R$ 3.120 (${vNov.valorCent})`);
  ok(vSet.nome === 'Igor MEI Lima', 'nome muda na hora (não é valor)');
  ok(vNov.historicoValores.length === 2, 'histórico guarda os dois valores');
  ok((await erroDe(() => pes.editarPrestador(t.id, mei!.id, { valorMensal: 1, vigenteDesde: '2026-08' }))).includes('começa em'), 'reajuste antes do início do contrato é recusado');

  // ── fechar setembro ──
  await pes.fechar(t.id, '2026-09');
  const fech = await pes.competencia(t.id, '2026-09');
  ok(fech.fechado, 'setembro fechado mostra o retrato');
  ok((await erroDe(() => pes.salvarLancamento(t.id, { pessoaTipo: 'MEI', pessoaId: mei!.id, competencia: '2026-09', meta: 1 }))).includes('fechada'),
    'mês fechado não aceita lançamento');
  ok((await erroDe(() => pes.editarPrestador(t.id, mei!.id, { valorMensal: 9999, vigenteDesde: '2026-09' }))).includes('fechada'),
    'reajuste não entra em mês fechado');

  // ── NF e pagamento chegam depois do fechamento ──
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
  ok((await erroDe(() => pes.salvarLancamento(t.id, { pessoaTipo: 'MEI', pessoaId: mei!.id, competencia: '2026-09', pago: true, nfNumero: '123', nfData: '2026-10-02' }))) === '',
    'mês fechado aceita pago + número da NF');
  const nf = await pes.salvarNf(t.id, { pessoaTipo: 'MEI', pessoaId: mei!.id, competencia: '2026-09', arquivoBase64: pdf.toString('base64'), arquivoNome: 'nf-123.pdf', arquivoMime: 'application/pdf' });
  await pes.registrarPagamento(t.id, { pessoaTipo: 'MEI', pessoaId: mei!.id, competencia: '2026-09', pago: true, valorPago: 2346 });
  const fech2 = await pes.competencia(t.id, '2026-09');
  ok(fech2.mei.find((x) => x.id === mei!.id)!.lanc.valorPagoCent === 234600, 'mês fechado: registrar pagamento funciona e aparece no retrato');
  const mf = fech2.mei.find((x) => x.id === mei!.id)!;
  ok(mf.lanc.pago && mf.lanc.nfNumero === '123', 'retrato fechado mostra pago e NF ao vivo');
  ok(mf.lanc.nfArquivo?.id === nf!.id && mf.lanc.nfArquivo.nome === 'nf-123.pdf', 'metadados do arquivo da NF aparecem no lançamento');
  ok(fech2.pendencias.nfMei === 0, 'NF enviada tira a pendência');
  ok(mf.brutoCent === fech.mei.find((x) => x.id === mei!.id)!.brutoCent, 'valores do retrato não mudam');
  const baixado = await pes.baixarNf(t.id, nf!.id);
  ok(baixado.bytes.equals(pdf) && baixado.mime === 'application/pdf', 'arquivo volta íntegro (cifrado em repouso)');
  const cru = await comoMaster(db, (tx) => tx.select().from(pessoalNfArquivo).where(eq(pessoalNfArquivo.id, nf!.id)));
  ok(!!cru[0] && !Buffer.from(cru[0].arquivo).includes(Buffer.from('%PDF')), 'no banco o arquivo está cifrado');
  const nf2 = await pes.salvarNf(t.id, { pessoaTipo: 'MEI', pessoaId: mei!.id, competencia: '2026-09', arquivoBase64: pdf.toString('base64'), arquivoNome: 'nf-123-v2.pdf', arquivoMime: 'application/pdf' });
  ok(nf2!.id === nf!.id && nf2!.nome === 'nf-123-v2.pdf', 'reenviar substitui o arquivo do mesmo mês');
  ok((await erroDe(() => pes.salvarNf(t.id, { pessoaTipo: 'MEI', pessoaId: mei!.id, competencia: '2026-09', arquivoBase64: 'AAAA', arquivoNome: 'x.exe', arquivoMime: 'application/x-msdownload' }))).includes('PDF'),
    'tipo de arquivo não aceito é recusado');
  ok((await erroDe(() => pes.baixarNf('00000000-0000-0000-0000-000000000000', nf!.id))) !== '', 'outra empresa não baixa a NF');
  await pes.removerNf(t.id, nf!.id);
  ok(!(await pes.competencia(t.id, '2026-09')).mei.find((x) => x.id === mei!.id)!.lanc.nfArquivo, 'remover tira o arquivo');
  ok(vSet.documento === '60874544000104', `documento salvo só com dígitos (${vSet.documento})`);

  // ── mudar valor não mexe no passado ──
  ok((await erroDe(() => pes.salvarConfigClt(t.id, ana.id, { vrDia: 99, cestaMensal: 0, vtTipo: 'DIA', vtValor: 10, vigenteDesde: '2026-10' }))).includes('já foi feita'),
    'não deixa mudar a carga de outubro depois que setembro fechou');
  await pes.salvarConfigClt(t.id, ana.id, { vrDia: 30, cestaMensal: 0, vtTipo: 'DIA', vtValor: 10, vigenteDesde: '2026-11' });
  await pes.salvarPadrao(t.id, { vrDia: 22, cestaMensal: 0, vtTipo: 'DIA', vtValor: 8, vigenteDesde: '2026-11' });
  const setDepois = await pes.competencia(t.id, '2026-09');
  ok(setDepois.clt.find((c) => c.empregadoId === ana.id)!.config.vrDiaCent === 2500, 'setembro fechado continua com VR R$ 25');

  // ── outubro: acerto parte do que setembro carregou (sem 12/10) ──
  await pes.excluir(t.id, { pessoaTipo: 'MEI', pessoaId: mei!.id, competencia: '2026-11', escopo: 'DIANTE' });
  const out = await pes.competencia(t.id, '2026-10');
  const a2 = out.clt.find((c) => c.empregadoId === ana.id)!;
  ok(!a2.beneficios.pagosEstimado, 'outubro usa os dias que o fechamento de setembro gravou');
  ok(!a2.beneficios.naoUsados.some((x) => x.motivo === 'feriado'), 'feriado de 12/10 já não foi pago, então não volta como acerto');
  ok(a2.config.vrDiaCent === 3000 && a2.beneficios.vrProxCent === a2.beneficios.diasProx * 3000, 'carga de novembro usa o VR novo (R$ 30, vigente desde novembro)');
  const diasAcerto = a2.beneficios.naoUsados.length;
  ok(a2.beneficios.acertoVrCent === diasAcerto * 2500, `acerto de outubro devolve pelo VR pago (R$ 25), não o novo (${a2.beneficios.acertoVrCent} / ${diasAcerto} dias)`);
  ok(out.clt.find((c) => c.empregadoId === beto.id)!.config.vrDiaCent === 2200, 'padrão novo vale pra quem segue o padrão');
  // volta a seguir o padrão a partir de dezembro
  await pes.salvarConfigClt(t.id, ana.id, { vrDia: 0, cestaMensal: 0, vtTipo: 'NENHUM', vtValor: 0, vigenteDesde: '2026-12', usaPadrao: true });
  const nov2 = await pes.competencia(t.id, '2026-11');
  ok(nov2.clt.find((c) => c.empregadoId === ana.id)!.config.origem === 'PADRAO', 'Ana volta ao padrão a partir de dezembro');
  ok((await pes.competencia(t.id, '2026-10')).clt.find((c) => c.empregadoId === ana.id)!.config.vrDiaCent === 3000, 'e novembro continua com o valor próprio dela');
  ok(out.mei.length === 1 && out.debitos.some((d) => d.parcelaAtual === 2), 'outubro: MEI segue e débito vira parcela 2/2');
  const nov = await pes.competencia(t.id, '2026-11');
  ok(nov.mei.length === 0 && nov.foraDoMes.some((f) => f.escopo === 'DIANTE'), 'desligado de novembro em diante');
  ok((await pes.competencia(t.id, '2026-12')).mei.length === 0, '… e continua fora em dezembro');

  ok((await erroDe(() => pes.reabrir(t.id, '2026-09'))) === '', 'reabrir setembro');
  ok(!(await pes.competencia(t.id, '2026-09')).fechado, 'setembro volta a ser calculado ao vivo');

  console.log(falhas === 0 ? '\n>>> PESSOAL OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
