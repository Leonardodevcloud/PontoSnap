import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { schema, comoMaster, tenant, empregado, pontoRep, pontoHorarioContratual, pontoMarcacao } from '@ponto/db';
import { CctService } from '../src/cct/cct.service';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { BancoService } from '../src/banco/banco.service';

const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const trat = new TratamentoService(db);
const cctSvc = new CctService(db);
const banco = new BancoService(db, trat);

let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };

const base = {
  extraDomingoFeriadoPct: 100, extraLimiteDiarioMin: 120, toleranciaDiariaMin: 10, toleranciaPorMarcacaoMin: 5,
  noturnoAdicionalPct: 20, noturnoReduzida: true, noturnoInicioMin: 1320, noturnoFimMin: 300,
  jornadaSemanalMin: 2640, interjornadaMinimaMin: 660, intervaloMaior6hMin: 60,
};

async function main() {
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({
    cnpj: '33333333000133', razaoSocial: 'CCT LTDA', bancoTipoAcordo: 'INDIVIDUAL', bancoPrazoMeses: 6,
  }).returning()))[0]!;
  await comoMaster(db, (tx) => tx.insert(pontoRep).values({
    tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: '33333333000133', razaoSocial: 'CCT LTDA',
    numeroInpi: 'BR512024002222-2', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188',
  }).returning());
  const hor = (await comoMaster(db, (tx) => tx.insert(pontoHorarioContratual).values({
    tenantId: t.id, codigo: 'COML', durJornadaMin: 480,
    pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }], diasSemana: [1, 2, 3, 4, 5], regime: 'normal',
  }).returning()))[0]!;

  // Convenção dos motoristas: extra a 60%, banco de 12 meses.
  const cct = await cctSvc.criar(t.id, {
    nome: 'Motoristas Carga RS', uf: 'RS', vigencia: '2025/2026',
    extraDiaUtilPct: 60, bancoPrazoMeses: 12, ...base,
  } as never);
  if (!cct) { console.log('FALHA — criar não retornou convenção'); await client.end(); process.exit(1); }
  ok(cct.extraDiaUtilPct === 60, 'convenção criada com extra 60%');

  const pedro = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: '30000000001', nome: 'Pedro Motorista', horarioContratualId: hor.id, cctId: cct.id }).returning()))[0]!;
  const joao = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: '30000000002', nome: 'João Admin', horarioContratualId: hor.id }).returning()))[0]!;

  // Ambos trabalham 9h numa segunda (jornada 8h) → 1h extra. -0300: +3h no UTC.
  let nsr = 1;
  const rep = (await comoMaster(db, (tx) => tx.select().from(pontoRep).where(eq(pontoRep.tenantId, t.id)).limit(1)))[0]!;
  const bate = (cpf: string, isoUtc: string) => comoMaster(db, (tx) => tx.insert(pontoMarcacao).values({
    tenantId: t.id, repId: rep.id, nsr: nsr++, cpf, dtMarcacao: new Date(isoUtc), coletor: 1,
    hashRegistro: nsr.toString(16).padStart(64, '0'),
  }).returning());
  for (const cpf of [pedro.cpf, joao.cpf]) {
    await bate(cpf, '2026-07-13T11:00:00Z'); // 08:00
    await bate(cpf, '2026-07-13T15:00:00Z'); // 12:00
    await bate(cpf, '2026-07-13T16:00:00Z'); // 13:00
    await bate(cpf, '2026-07-13T21:00:00Z'); // 18:00 → 9h
  }

  const apPedro = await trat.apurarPeriodoCLT(t.id, pedro.id, '2026-07-13', '2026-07-13', []);
  const apJoao = await trat.apurarPeriodoCLT(t.id, joao.id, '2026-07-13', '2026-07-13', []);
  const extraPedro = apPedro.resultado.dias.find((d) => d.data === '2026-07-13')?.extras[0];
  const extraJoao = apJoao.resultado.dias.find((d) => d.data === '2026-07-13')?.extras[0];

  ok(!!extraPedro && extraPedro.adicionalPct === 60, `Pedro (CCT) apura extra a 60% (${extraPedro?.adicionalPct})`);
  ok(!!extraJoao && extraJoao.adicionalPct === 50, `João (CLT) apura extra a 50% (${extraJoao?.adicionalPct})`);
  ok((extraPedro?.min ?? 0) === (extraJoao?.min ?? -1), 'mesma quantidade de extra, só muda o percentual');

  const sPedro = await banco.saldo(t.id, pedro.id, '2026-07-20');
  const sJoao = await banco.saldo(t.id, joao.id, '2026-07-20');
  ok(sPedro.prazoMeses === 12, `banco do Pedro usa 12 meses da convenção (${sPedro.prazoMeses})`);
  ok(sJoao.prazoMeses === 6, `banco do João usa 6 meses da empresa (${sJoao.prazoMeses})`);

  // Listagem conta funcionários por convenção.
  const lista = await cctSvc.listar(t.id);
  ok(lista.find((c) => c.id === cct.id)?.funcionarios === 1, 'listagem conta 1 funcionário na convenção');

  console.log(falhas === 0 ? '\n>>> CCT OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
