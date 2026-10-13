import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema, comoMaster, tenant, empregado, pontoRep, pontoMarcacao } from '@ponto/db';
import { TratamentoService } from '../src/tratamento/tratamento.service';

/**
 * Escala "compensa na semana": estica seg–sex e folga o sábado sem virar falta;
 * a semana que vira o mês é apurada inteira e fecha no mês em que termina.
 */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const trat = new TratamentoService(db);
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };

async function main() {
  const CNPJ = `79${String(Date.now()).slice(-12)}`;
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: CNPJ, razaoSocial: 'Semana LTDA' }).returning()))[0]!;
  const rep = (await comoMaster(db, (tx) => tx.insert(pontoRep).values({
    tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: CNPJ, razaoSocial: 'Semana LTDA',
    numeroInpi: 'BR512024007777-7', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188',
  }).returning()))[0]!;
  const hor = (await trat.criarHorario(t.id, {
    codigo: '6X1 COMPENSA', durJornadaMin: 480, diasSemana: [1, 2, 3, 4, 5, 6], jornadaPorDia: { 6: 240 }, compensaSemana: true,
    pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }],
  }))!;
  const emp = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: CNPJ.slice(0, 11), nome: 'Bianca', horarioContratualId: hor.id, dataInicioPonto: '2026-09-01' }).returning()))[0]!;
  let nsr = 1;
  const bate = async (data: string, hs: string[]) => { for (const h of hs) await comoMaster(db, (tx) => tx.insert(pontoMarcacao).values({
    tenantId: t.id, repId: rep.id, nsr: nsr++, cpf: emp.cpf, dtMarcacao: new Date(`${data}T${h}:00-03:00`), coletor: 1, hashRegistro: nsr.toString(16).padStart(64, '0'),
  })); };
  // semana 28/09–04/10: 5 × 8h48, sábado 03 sem batida
  for (const d of ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']) await bate(d, ['08:00', '12:00', '13:00', '17:48']);
  // semana 05–11/10: vem no sábado e sai mais cedo na terça
  await bate('2026-10-05', ['08:00', '12:00', '13:00', '17:48']);
  await bate('2026-10-06', ['08:00', '12:00', '13:00', '16:00']);
  for (const d of ['2026-10-07', '2026-10-08', '2026-10-09']) await bate(d, ['08:00', '12:00', '13:00', '17:00']);
  await bate('2026-10-10', ['08:00', '13:12']);

  const out = await trat.apurarPeriodoCLT(t.id, emp.id, '2026-10-01', '2026-10-31', []);
  const r = out.resultado;
  const sab = r.dias.find((d) => d.data === '2026-10-03')!;
  ok(r.dias[0]!.data === '2026-10-01', `outubro começa em 01/10 (dias de setembro só fecham a semana) (${r.dias[0]!.data})`);
  ok(sab.faltaMin === 0 && !!sab.semana?.compensado && sab.semana.estado === 'FECHADA', `sábado 03 compensado na semana, não é falta (${sab.faltaMin})`);
  ok(sab.semana?.feitoMin === 5 * 528 && sab.semana.cargaMin === 44 * 60, `semana 28/09–04/10: feito 44h, carga 44h (${sab.semana?.feitoMin}/${sab.semana?.cargaMin})`);
  // semana 05–11: 8h48 + 7h + 3×8h + 5h12 = 45h00 → +1h extra da semana
  const s10 = r.dias.find((d) => d.data === '2026-10-10')!;
  ok(s10.semana?.resultadoMin === 60 && s10.extras.some((e) => e.motivo === 'extra da semana' && e.min === 60), `semana 05–11: +1h extra lançada no sábado (${s10.semana?.resultadoMin})`);
  ok(r.totalFaltaMin === 0 && r.dsrPerdidoSemanas === 0, `sem faltas no mês (${r.totalFaltaMin})`);
  const terca = r.dias.find((d) => d.data === '2026-10-06')!;
  ok(terca.atrasoMin === 0, `terça curta não é atraso: compensou no sábado (${terca.atrasoMin})`);

  // setembro: a semana 28/09–04/10 termina em outubro → fica aberta lá
  const set = (await trat.apurarPeriodoCLT(t.id, emp.id, '2026-09-01', '2026-09-30', [])).resultado;
  const d30 = set.dias.find((d) => d.data === '2026-09-30')!;
  ok(d30.semana?.estado === 'PROXIMO_MES' && d30.extrasTotalMin === 0 && d30.saldoMin === 0, `setembro: 30/09 fica "fecha em outubro" (${d30.semana?.estado})`);
  // setembro sem batidas antes do dia 28: semanas fechadas sem nada → faltas (comportamento esperado)
  ok(set.dias.some((d) => d.faltaMin > 0), 'semanas de setembro sem batida viram falta (nada compensado)');

  console.log(falhas === 0 ? '\n>>> COMPENSA NA SEMANA OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
