import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { schema, comoMaster, tenant, empregado, pontoRep, pontoHorarioContratual, pontoMarcacao } from '@ponto/db';
import { AjusteService } from '../src/ajuste/ajuste.service';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { FiscalService } from '../src/fiscal/fiscal.service';

const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const ajuste = new AjusteService(db);
const trat = new TratamentoService(db);
const fiscal = new FiscalService(db as never, {} as never);

let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };

const hoje = new Date();
const dia = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 10));
const DATA = dia.toISOString().slice(0, 10);
const emUTC = (h: number, m = 0) => new Date(`${DATA}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);

async function main() {
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: '22233344000155', razaoSocial: 'AJUSTE LTDA' }).returning()))[0]!;
  const rep = (await comoMaster(db, (tx) => tx.insert(pontoRep).values({ tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: '22233344000155', razaoSocial: 'AJUSTE LTDA', numeroInpi: 'BR512024002223-3', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188' }).returning()))[0]!;
  const hor = (await comoMaster(db, (tx) => tx.insert(pontoHorarioContratual).values({ tenantId: t.id, codigo: 'ADM', durJornadaMin: 480, pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }], diasSemana: [1, 2, 3, 4, 5, 6, 0], regime: 'normal' }).returning()))[0]!;
  const emp = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: '22200000001', nome: 'Zé Ajuste', horarioContratualId: hor.id }).returning()))[0]!;

  let nsr = 1;
  const bate = async (d: Date) => (await comoMaster(db, (tx) => tx.insert(pontoMarcacao).values({
    tenantId: t.id, repId: rep.id, nsr: nsr++, cpf: emp.cpf, dtMarcacao: d, coletor: 1,
    hashRegistro: nsr.toString(16).padStart(64, '0'),
  }).returning()))[0]!;

  // Dia com 5 batidas: 11:00, 15:00, 15:01(duplicada), 16:00, 20:00 UTC
  await bate(emUTC(11)); await bate(emUTC(15));
  const dup = await bate(emUTC(15, 1));
  await bate(emUTC(16)); await bate(emUTC(20));

  const antes = await trat.apurarPeriodoCLT(t.id, emp.id, DATA, DATA, []);
  const diaAntes = antes.resultado.dias.find((d) => d.data === DATA);
  ok(diaAntes?.paresIncompletos === true, `antes: 5 batidas → par incompleto (${diaAntes?.paresIncompletos})`);

  // ---- caso 1: DESCONSIDERAR a batida a mais ----
  const pedido = await ajuste.solicitar(t.id, {
    empregadoId: emp.id, tipo: 'DESCONSIDERAR', data: DATA,
    marcacaoId: dup.id, observacao: 'Bati duas vezes sem querer no almoço.',
  });
  ok(pedido!.status === 'EM_ANALISE', 'pedido nasce EM_ANALISE');

  const pend = await ajuste.pendentes(t.id);
  ok(pend.length === 1 && pend[0]!.nome === 'Zé Ajuste', `RH vê o pedido na fila (${pend.length})`);

  // enquanto não decide, a apuração NÃO muda
  const meio = await trat.apurarPeriodoCLT(t.id, emp.id, DATA, DATA, []);
  ok(meio.resultado.dias.find((d) => d.data === DATA)?.paresIncompletos === true, 'em análise não muda a apuração');

  await ajuste.decidir(t.id, pedido!.id, true, null, 'leonardo.santos@pontosnap.online');
  const depois = await trat.apurarPeriodoCLT(t.id, emp.id, DATA, DATA, []);
  const diaDepois = depois.resultado.dias.find((d) => d.data === DATA);
  ok(diaDepois?.paresIncompletos === false, `aprovado: batida a mais sai da conta (par completo=${!diaDepois?.paresIncompletos})`);

  // ---- caso 2: INCLUSAO de batida esquecida ----
  const emp2 = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: '22200000002', nome: 'Ana Esquecida', horarioContratualId: hor.id }).returning()))[0]!;
  await comoMaster(db, (tx) => tx.insert(pontoMarcacao).values({ tenantId: t.id, repId: rep.id, nsr: nsr++, cpf: emp2.cpf, dtMarcacao: emUTC(11), coletor: 1, hashRegistro: 'a'.repeat(64) }).returning());
  await comoMaster(db, (tx) => tx.insert(pontoMarcacao).values({ tenantId: t.id, repId: rep.id, nsr: nsr++, cpf: emp2.cpf, dtMarcacao: emUTC(15), coletor: 1, hashRegistro: 'b'.repeat(64) }).returning());
  await comoMaster(db, (tx) => tx.insert(pontoMarcacao).values({ tenantId: t.id, repId: rep.id, nsr: nsr++, cpf: emp2.cpf, dtMarcacao: emUTC(16), coletor: 1, hashRegistro: 'c'.repeat(64) }).returning());

  const p2 = await ajuste.solicitar(t.id, {
    empregadoId: emp2.id, tipo: 'INCLUSAO', data: DATA, hora: '17:05', tpMarc: 'S',
    observacao: 'Saí às 17:05 e o celular estava sem bateria.',
  });
  const recusaSemMotivo = await ajuste.decidir(t.id, p2!.id, false, null, 'rh').catch(() => 'recusou');
  ok(recusaSemMotivo === 'recusou', 'recusa sem motivo é bloqueada');

  await ajuste.decidir(t.id, p2!.id, true, null, 'leonardo.santos@pontosnap.online');
  const ap2 = await trat.apurarPeriodoCLT(t.id, emp2.id, DATA, DATA, []);
  const d2 = ap2.resultado.dias.find((d) => d.data === DATA);
  ok(d2?.paresIncompletos === false, `inclusão fecha o par (incompleto=${d2?.paresIncompletos})`);
  ok((d2?.minutosTrabalhados ?? 0) > 240, `inclusão soma jornada (${d2?.minutosTrabalhados}min)`);

  // ---- AFD intocado / AEJ com D e I ----
  const afd = (await fiscal.gerarAfd(t.id)).conteudo.toString('latin1');
  const marcAfd = afd.split('\r\n').filter((l) => l.length > 10 && l[9] === '7').length;
  ok(marcAfd === 8, `AFD mantém TODAS as 8 batidas originais, inclusive a desconsiderada (${marcAfd})`);

  await trat.apurarDia(t.id, emp.id, DATA);
  const aej = (await fiscal.gerarAej(t.id)).conteudo.toString('latin1');
  const l05 = aej.split('\r\n').filter((l) => l.startsWith('05|'));
  ok(l05.some((l) => l.split('|')[4] === 'D'), 'AEJ marca a batida a mais como D (desconsiderada)');
  await trat.apurarDia(t.id, emp2.id, DATA);
  const aej2 = (await fiscal.gerarAej(t.id)).conteudo.toString('latin1');
  ok(aej2.split('\r\n').some((l) => l.startsWith('05|') && l.split('|')[6] === 'I'), 'AEJ marca a batida esquecida como I (incluída)');

  // e-mail longo de verdade na trilha (regressão do 500 em decidido_por)
  const pend2 = await ajuste.solicitar(t.id, { empregadoId: emp2.id, tipo: 'INCLUSAO', data: DATA, hora: '18:00', tpMarc: 'S', observacao: 'Outro teste de decisão.' });
  const decidiu = await ajuste.decidir(t.id, pend2!.id, true, null, 'administrador.geral@empresa-com-nome-longo.com.br').then(() => true).catch(() => false);
  ok(decidiu, 'decidir grava e-mail longo sem estourar a coluna');

  // batidas do dia vêm só do dia pedido
  const bat = await ajuste.batidasDoDia(t.id, emp.id, DATA);
  ok(bat.length === 4, `dia efetivo do RH: 5 originais - 1 desconsiderada = ${bat.length}`);

  // ---- cenário do dia todo esquecido: 4 pedidos, aprovados um a um ----
  const emp3 = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: '22200000003', nome: 'Esqueceu Tudo', horarioContratualId: hor.id }).returning()))[0]!;
  const horas = ['08:00', '12:00', '13:00', '17:00'];
  const ids: string[] = [];
  for (const h of horas) {
    const p = await ajuste.solicitar(t.id, { empregadoId: emp3.id, tipo: 'INCLUSAO', data: DATA, hora: h, tpMarc: 'E', observacao: `Esqueci de bater ${h}.` });
    ids.push(p!.id);
  }
  ok((await ajuste.batidasDoDia(t.id, emp3.id, DATA)).length === 0, 'dia começa sem nenhuma batida');

  for (let i = 0; i < ids.length; i++) {
    await ajuste.decidir(t.id, ids[i]!, true, null, 'rh@empresa.com.br');
    const agora = await ajuste.batidasDoDia(t.id, emp3.id, DATA);
    ok(agora.length === i + 1, `após aprovar ${i + 1}º pedido, o dia mostra ${agora.length} batida(s)`);
  }

  const apEsq = await trat.apurarPeriodoCLT(t.id, emp3.id, DATA, DATA, []);
  const dEsq = apEsq.resultado.dias.find((d) => d.data === DATA);
  ok(dEsq?.paresIncompletos === false && (dEsq?.minutosTrabalhados ?? 0) === 480,
    `dia todo reconstruído por ajuste: ${dEsq?.minutosTrabalhados}min, par completo`);

  // ---- detalhe do dia pra gaveta da Apuração ----
  const apDet = await trat.apurarPeriodoCLT(t.id, emp.id, DATA, DATA, []);
  const detDia = (apDet as never as { batidas: Record<string, { origem: string }[]> }).batidas[DATA] ?? [];
  ok(detDia.length === 5, `gaveta recebe as 5 batidas do dia, inclusive a fora da conta (${detDia.length})`);
  ok(detDia.filter((b) => b.origem === 'DESCONSIDERADA').length === 1, 'a desconsiderada vem marcada');
  const apDet2 = await trat.apurarPeriodoCLT(t.id, emp2.id, DATA, DATA, []);
  const bat2 = (apDet2 as never as { batidas: Record<string, { origem: string }[]> }).batidas[DATA] ?? [];
  ok(bat2.some((b) => b.origem === 'INCLUIDA'), 'a incluída por ajuste vem marcada');
  ok((apDet as never as { esperadas: number }).esperadas === 4, 'gaveta sabe quantas batidas o dia previa');

  console.log(falhas === 0 ? '\n>>> AJUSTE OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
