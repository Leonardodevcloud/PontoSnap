import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema, comoMaster, tenant, empregado, pontoRep, pontoHorarioContratual, pontoMarcacao } from '@ponto/db';
import { TratamentoService } from '../src/tratamento/tratamento.service';

/**
 * Cobre os três ajustes de 2026-10:
 *  1) contratado do MÊS INTEIRO (inclui dias que ainda não chegaram);
 *  2) batida em aberto / hoje em andamento ficam PENDENTES — não viram falta nem atraso;
 *  3) com banco ativo, a extra vai pro banco e NÃO aparece em R$ (sem contar duas vezes).
 */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const trat = new TratamentoService(db);

let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };
const em = (data: string, hm: string) => new Date(`${data}T${hm}:00-0300`);

async function empresa(cnpj: string, bancoTipoAcordo: 'INDIVIDUAL' | 'NENHUM') {
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({
    cnpj, razaoSocial: `EMP ${cnpj}`, bancoTipoAcordo, bancoPrazoMeses: bancoTipoAcordo === 'NENHUM' ? null : 6,
  }).returning()))[0]!;
  const rep = (await comoMaster(db, (tx) => tx.insert(pontoRep).values({
    tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: cnpj, razaoSocial: `EMP ${cnpj}`,
    numeroInpi: 'BR512024009999-9', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188',
  }).returning()))[0]!;
  const hor = (await comoMaster(db, (tx) => tx.insert(pontoHorarioContratual).values({
    tenantId: t.id, codigo: 'ADM', durJornadaMin: 480,
    pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }], diasSemana: [1, 2, 3, 4, 5], regime: 'normal',
  }).returning()))[0]!;
  return { t, rep, hor };
}

let nsr = 1;
async function bater(tenantId: string, repId: string, cpf: string, datas: Date[]) {
  for (const d of datas) {
    await comoMaster(db, (tx) => tx.insert(pontoMarcacao).values({
      tenantId, repId, nsr: nsr++, cpf, dtMarcacao: d, coletor: 1, hashRegistro: String(nsr).padStart(64, '0'),
    }).returning());
  }
}

/** Dias úteis (seg–sex) de uma competência YYYY-MM. */
function diasUteis(comp: string): string[] {
  const [a, m] = comp.split('-').map(Number);
  const ult = new Date(Date.UTC(a!, m!, 0)).getUTCDate();
  const out: string[] = [];
  for (let d = 1; d <= ult; d++) {
    const iso = `${comp}-${String(d).padStart(2, '0')}`;
    const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
    if (dow >= 1 && dow <= 5) out.push(iso);
  }
  return out;
}

async function main() {
  const A = await empresa('77777777000177', 'INDIVIDUAL'); // com banco
  const B = await empresa('88888888000188', 'NENHUM');     // sem banco
  const ana = (await comoMaster(db, (tx) => tx.insert(empregado).values({
    tenantId: A.t.id, cpf: '70000000001', nome: 'Ana Banco', horarioContratualId: A.hor.id, salarioMensal: '2200.00',
  }).returning()))[0]!;
  const beto = (await comoMaster(db, (tx) => tx.insert(empregado).values({
    tenantId: B.t.id, cpf: '80000000001', nome: 'Beto Folha', horarioContratualId: B.hor.id, salarioMensal: '2200.00',
  }).returning()))[0]!;

  // ── 1) contratado do mês inteiro (competência corrente) ───────────────────
  const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const comp = hoje.slice(0, 7);
  const ultimo = new Date(Date.UTC(Number(comp.slice(0, 4)), Number(comp.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const apMes = await trat.apurarPeriodoCLT(A.t.id, ana.id, `${comp}-01`, ultimo, []);
  const esperadoMes = diasUteis(comp).length * 480;
  const esperadoAteHoje = diasUteis(comp).filter((d) => d <= hoje).length * 480;
  ok(apMes.resultado.totalContratadoMesMin === esperadoMes,
    `contratado do mês inteiro = ${esperadoMes / 60}h (veio ${(apMes.resultado.totalContratadoMesMin ?? 0) / 60}h)`);
  ok(apMes.resultado.totalContratadoMin === esperadoAteHoje,
    `contratado apurado (até hoje) continua ${esperadoAteHoje / 60}h (veio ${apMes.resultado.totalContratadoMin / 60}h)`);

  // hoje sem batida não é falta (se hoje for dia útil)
  const diaHoje = apMes.resultado.dias.find((d) => d.data === hoje);
  if (diaHoje && diaHoje.minutosContratados > 0) {
    ok(diaHoje.faltaMin === 0 && diaHoje.pendente, `hoje sem batida: pendente, sem falta (falta ${diaHoje.faltaMin})`);
  }

  // ── 2) batida em aberto num dia passado fica pendente ─────────────────────
  // 13/07/2026 (seg): esqueceu a saída da tarde. 14/07 (ter): 1h extra.
  for (const [emp, E] of [[ana, A], [beto, B]] as const) {
    await bater(E.t.id, E.rep.id, emp.cpf, [em('2026-07-13', '08:00'), em('2026-07-13', '12:00'), em('2026-07-13', '13:00')]);
    await bater(E.t.id, E.rep.id, emp.cpf, [em('2026-07-14', '08:00'), em('2026-07-14', '12:00'), em('2026-07-14', '13:00'), em('2026-07-14', '18:00')]);
  }
  const apA = await trat.apurarPeriodoCLT(A.t.id, ana.id, '2026-07-13', '2026-07-14', []);
  const d13 = apA.resultado.dias.find((d) => d.data === '2026-07-13')!;
  ok(d13.pendente && d13.atrasoMin === 0 && d13.faltaMin === 0,
    `batida em aberto: pendente, sem atraso/falta (atraso ${d13.atrasoMin}, falta ${d13.faltaMin})`);
  ok(d13.minutosTrabalhados === 240, `trabalhado do par completo aparece (240 → ${d13.minutosTrabalhados})`);
  ok(apA.resultado.totalAtrasoMin === 0, `nenhum atraso inventado no período (${apA.resultado.totalAtrasoMin})`);
  ok(apA.resultado.diasPendentes.includes('2026-07-13'), 'dia listado em diasPendentes');

  // ── 3) com banco a extra não é paga; sem banco é ──────────────────────────
  ok(apA.resultado.totalExtrasMin === 60, `Ana fez 1h extra (${apA.resultado.totalExtrasMin})`);
  ok(apA.valores!.extrasCentavos === 0, `Ana (banco): extra NÃO entra em R$ (${apA.valores!.extrasCentavos})`);
  ok(apA.valores!.extrasNoBancoMin === 60, `Ana (banco): 60min marcados como "foi pro banco" (${apA.valores!.extrasNoBancoMin})`);
  const apB = await trat.apurarPeriodoCLT(B.t.id, beto.id, '2026-07-13', '2026-07-14', []);
  ok(apB.valores!.extrasCentavos === 1500, `Beto (sem banco): 1h × R$10 × 1,5 = R$15,00 (${apB.valores!.extrasCentavos})`);

  // relatório da competência expõe o contratado do mês
  const rel = await trat.relatorioCompetencia(A.t.id, `${comp}-01`, ultimo, hoje);
  const linha = rel.linhas.find((l) => l.empregadoId === ana.id)!;
  ok(linha.contratadoMesMin === esperadoMes, `relatório: contratadoMesMin = ${linha.contratadoMesMin / 60}h`);
  ok(rel.totais.contratadoMesMin >= linha.contratadoMesMin, 'relatório: total do mês somado');

  console.log(falhas === 0 ? '\n>>> CONTRATADO-PENDENTE OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
