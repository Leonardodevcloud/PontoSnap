import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { schema, comoMaster, comTenant, tenant, pontoRep, empregado, pontoHorarioContratual } from '@ponto/db';
import { Coletor } from '@ponto/shared';
import { MarcacaoService } from '../src/marcacao/marcacao.service';
import { CertificadoService } from '../src/certificado/certificado.service';
import { CriptoService } from '../src/common/cripto.service';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { FiscalService } from '../src/fiscal/fiscal.service';
import { JobsService } from '../src/jobs/jobs.service';

const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const certs = new CertificadoService(db, new CriptoService());
const marc = new MarcacaoService(db, certs);
const trat = new TratamentoService(db);
const fisc = new FiscalService(db, certs);
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };

async function main() {
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: '11111111000111', razaoSocial: 'Cliente A', localPrestacao: 'Salvador/BA' }).returning()))[0]!;
  await comoMaster(db, (tx) => tx.insert(pontoRep).values({ tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: '11111111000111', razaoSocial: 'Cliente A', numeroInpi: 'BR512024001234-5', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188' }).returning());
  const e = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: '43461292850', nome: 'Maria A' }).returning()))[0]!;

  // horário contratual + vínculo
  const hor = await trat.criarHorario(t.id, { codigo: 'CH001', durJornadaMin: 480, pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }] });
  await comTenant(db, t.id, (tx) => tx.update(empregado).set({ horarioContratualId: hor!.id, salarioMensal: '2200.00' }).where(eq(empregado.id, e.id)));

  // 4 batidas no mesmo dia
  for (const hm of ['08:00', '12:00', '13:00', '17:00']) {
    const dt = new Date(`2026-07-13T${hm}:00-0300`);
    await marc.bater({ tenantId: t.id, cpf: '43461292850', coletor: Coletor.DISPOSITIVO, dtMarcacao: dt, declaradoOffline: true });
  }

  // apuração (pareamento E/S)
  const ap = await trat.apurarDia(t.id, e.id, '2026-07-13');
  ok(ap.tratamentosCriados === 4 && ap.avisoImpar === null, `apurou 4 batidas em pares (criou ${ap.tratamentosCriados})`);
  const trats = await trat.listarTratamentos(t.id, e.id);
  const seq = trats.map((x) => `${x.tpMarc}${x.seqEntSaida}`).join(' ');
  ok(seq === 'E1 S1 E2 S2', `pares corretos: ${seq}`);

  // espelho do dia (leitura, com apuração)
  const esp = await trat.espelhoDia(t.id, e.id, '2026-07-13');
  ok(esp.marcacoes.length === 4 && esp.resumo.minutosTrabalhados === 480 && esp.resumo.saldoMinutos === 0,
     `espelho: ${esp.marcacoes.length} batidas, ${esp.resumo.minutosTrabalhados}min trabalhados, saldo ${esp.resumo.saldoMinutos}`);

  // apuração CLT completa (motor de regras) — dia útil trabalhado (segunda 13/07)
  const clt = await trat.apurarPeriodoCLT(t.id, e.id, '2026-07-13', '2026-07-13');
  const r = clt.resultado;
  ok(r.totalTrabalhadoMin === 480 && r.totalExtrasMin === 0 && r.totalFaltaMin === 0,
     `apuração CLT (dia útil): ${r.totalTrabalhadoMin}min trab, ${r.totalExtrasMin} extra, ${r.totalFaltaMin} falta`);
  ok(r.dias.length === 1 && r.dias[0]!.intervaloGozadoMin === 60 && r.dias[0]!.penalidadeIntervaloMin === 0,
     `dia apurado com intervalo de 60min e sem penalidade`);
  ok(r.totalAtrasoMin === 0 && r.dias[0]!.atrasoMin === 0,
     `sem atraso ao cumprir a janela prevista (atraso ${r.totalAtrasoMin}min)`);
  ok(clt.valores !== null && clt.valores!.valorHoraCentavos === 1000,
     `valor-hora calculado: R$ ${((clt.valores?.valorHoraCentavos ?? 0) / 100).toFixed(2)} (salário 2200 / 220h)`);

  // falta de dia inteiro: terça 14/07 é dia útil sem marcação → falta = jornada
  const cltFalta = await trat.apurarPeriodoCLT(t.id, e.id, '2026-07-14', '2026-07-14');
  ok(cltFalta.resultado.totalFaltaMin === 480,
     `falta de dia inteiro detectada: ${cltFalta.resultado.totalFaltaMin}min`);

  // feriado suprime a falta: cadastra feriado em 15/07 (quarta) sem marcação
  await trat.criarFeriado(t.id, { data: '2026-07-15', nome: 'Feriado de teste', tipo: 'municipal' });
  const cltFer = await trat.apurarPeriodoCLT(t.id, e.id, '2026-07-15', '2026-07-15');
  ok(cltFer.resultado.totalFaltaMin === 0 && cltFer.resultado.dias[0]!.minutosContratados === 0,
     `feriado suprime a falta (contratado ${cltFer.resultado.dias[0]!.minutosContratados}min)`);

  // relatório de apuração em PDF
  const pdf = await trat.gerarApuracaoPdf(t.id, e.id, '2026-07-13', '2026-07-15');
  ok(pdf.buffer.length > 800 && pdf.buffer.subarray(0, 4).toString('latin1') === '%PDF' && pdf.nomeArquivo.endsWith('.pdf'),
     `PDF de apuração gerado: ${pdf.buffer.length} bytes, ${pdf.nomeArquivo}`);

  // AFD
  const afd = await fisc.gerarAfd(t.id);
  const laf = afd.conteudo.toString('latin1').split('\r\n').filter(Boolean);
  const tipo7 = laf.filter((l) => l.length === 137).length;
  ok(laf[0]!.length === 302 && tipo7 === 4 && laf[laf.length - 2]!.startsWith('999999999'),
     `AFD válido: cabeçalho 302, ${tipo7} marcações, trailer 999999999`);
  ok(afd.nomeArquivo.startsWith('AFD') && afd.nomeArquivo.endsWith('REP_P.txt'), `nome do AFD: ${afd.nomeArquivo}`);

  // AEJ
  const aej = await fisc.gerarAej(t.id);
  const lae = aej.conteudo.toString('latin1').split('\r\n').filter(Boolean);
  const t05 = lae.filter((l) => l.startsWith('05|')).length;
  const reg99 = lae.find((l) => l.startsWith('99|'))!;
  ok(lae.some((l) => l.startsWith('01|')) && lae.some((l) => l.startsWith('03|')) && lae.some((l) => l.startsWith('04|')) && t05 === 4,
     `AEJ válido: cabeçalho, vínculo, horário e ${t05} marcações tratadas`);
  ok(reg99.split('|')[5] === '4', `trailer do AEJ conta 4 tratamentos (tipo 05)`);

  // ---- Regime 12x36 com calendário de escala ----
  const hor12 = await trat.criarHorario(t.id, { codigo: 'CH-12x36', durJornadaMin: 660, regime: 'r12x36',
    pares: [{ entrada: '0700', saida: '1300' }, { entrada: '1400', saida: '1900' }] });
  const e2 = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: '52998224725', nome: 'João 12x36', salarioMensal: '3300.00' }).returning()))[0]!;
  await comTenant(db, t.id, (tx) => tx.update(empregado).set({ horarioContratualId: hor12!.id }).where(eq(empregado.id, e2.id)));

  // escala 12x36 a partir de 13/07 (trabalha 13, 15, 17...)
  const ger = await trat.gerarEscala12x36(t.id, e2.id, '2026-07-13', '2026-07-19', '2026-07-13');
  ok(ger.gerados === 4, `escala 12x36 gerada: ${ger.gerados} dias (13,15,17,19)`);

  // bate o dia 13 (trabalha) cumprindo 11h com 1h de intervalo
  for (const hm of ['07:00', '13:00', '14:00', '19:00']) {
    await marc.bater({ tenantId: t.id, cpf: '52998224725', coletor: Coletor.DISPOSITIVO, dtMarcacao: new Date(`2026-07-13T${hm}:00-0300`), declaradoOffline: true });
  }
  const clt12 = await trat.apurarPeriodoCLT(t.id, e2.id, '2026-07-13', '2026-07-15');
  const dia13 = clt12.resultado.dias.find((d) => d.data === '2026-07-13')!;
  const dia14 = clt12.resultado.dias.find((d) => d.data === '2026-07-14');
  const dia15 = clt12.resultado.dias.find((d) => d.data === '2026-07-15')!;
  ok(dia13.minutosTrabalhados === 660 && dia13.faltaMin === 0, `12x36 dia trabalhado: ${dia13.minutosTrabalhados}min, sem falta`);
  ok(dia14 === undefined, `12x36 folga (14/07) não gera apuração`);
  ok(dia15.faltaMin === 660, `12x36 dia de escala sem batida (15/07): falta de dia inteiro (${dia15.faltaMin}min)`);

  // ---- Painel e relatório gerencial ----
  const painel = await trat.painel(t.id);
  ok(painel.ativos === 2, `painel: ${painel.ativos} funcionários ativos`);

  const rel = await trat.relatorioCompetencia(t.id, '2026-07-13', '2026-07-15');
  ok(rel.linhas.length === 2, `relatório consolidado: ${rel.linhas.length} funcionários`);
  const maria = rel.linhas.find((l) => l.nome === 'Maria A')!;
  ok(maria.trabalhadoMin === 480 && maria.temSalario, `relatório: Maria com 480min e salário (${maria.trabalhadoMin})`);

  const relPdf = await trat.gerarRelatorioCompetenciaPdf(t.id, '2026-07-13', '2026-07-15');
  ok(relPdf.buffer.subarray(0, 4).toString('latin1') === '%PDF', `relatório PDF gerado (${relPdf.buffer.length} bytes)`);
  const relXlsx = await trat.gerarRelatorioCompetenciaXlsx(t.id, '2026-07-13', '2026-07-15');
  ok(relXlsx.buffer.subarray(0, 2).toString('latin1') === 'PK' && relXlsx.buffer.length > 1000, `relatório XLSX gerado (${relXlsx.buffer.length} bytes)`);

  // ---- Processamento em background (fila de jobs) ----
  const jobs = new JobsService(db, trat);
  const job = await jobs.enfileirar(t.id, 'relatorio-competencia', { inicio: '2026-07-13', fim: '2026-07-15' });
  ok(job.status === 'pendente', `job enfileirado com status "${job.status}"`);
  const n = await jobs.processarPendentes();
  ok(n >= 1, `processador rodou ${n} job(s) pendente(s)`);
  const done = await jobs.obter(t.id, job.id);
  const res = done.resultado as { linhas: unknown[] } | null;
  ok(done.status === 'concluido' && !!res && res.linhas.length === 2, `job concluído com resultado (${res?.linhas.length} linhas)`);

  await client.end();
  console.log(falhas === 0 ? '\n>>> FISCAL + TRATAMENTO OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  process.exit(falhas === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
