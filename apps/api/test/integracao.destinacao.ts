import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema, comoMaster, tenant, empregado, pontoRep, pontoHorarioContratual } from '@ponto/db';
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
  extraDiaUtilPct: 50, extraDomingoFeriadoPct: 100, extraLimiteDiarioMin: 120, toleranciaDiariaMin: 10, toleranciaPorMarcacaoMin: 5,
  noturnoAdicionalPct: 20, noturnoReduzida: true, noturnoInicioMin: 1320, noturnoFimMin: 300,
  jornadaSemanalMin: 2640, interjornadaMinimaMin: 660, intervaloMaior6hMin: 60,
  bancoModo: 'ATIVO', bancoTipoAcordo: 'INDIVIDUAL', bancoPrazoMeses: 6, ativa: true, padrao: false,
};

async function main() {
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({
    cnpj: '55555555000155', razaoSocial: 'DESTINO LTDA', bancoTipoAcordo: 'INDIVIDUAL', bancoPrazoMeses: 6,
  }).returning()))[0]!;
  await comoMaster(db, (tx) => tx.insert(pontoRep).values({
    tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: '55555555000155', razaoSocial: 'DESTINO LTDA',
    numeroInpi: 'BR512024005555-5', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188',
  }).returning());
  const hor = (await comoMaster(db, (tx) => tx.insert(pontoHorarioContratual).values({
    tenantId: t.id, codigo: 'ADM', durJornadaMin: 480,
    pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }], diasSemana: [1, 2, 3, 4, 5], regime: 'normal',
  }).returning()))[0]!;

  // Regra A: falta ABATE DO BANCO. Regra B: falta DESCONTA (não vai pro banco).
  const regraBanco = await cctSvc.criar(t.id, { nome: 'Falta no banco', ...base, destinacaoFaltas: 'BANCO', destinacaoAtrasos: 'BANCO' } as never);
  const regraDesc = await cctSvc.criar(t.id, { nome: 'Falta desconta', ...base, destinacaoFaltas: 'DESCONTA', destinacaoAtrasos: 'DESCONTA' } as never);
  if (!regraBanco || !regraDesc) { console.log('FALHA — criar'); await client.end(); process.exit(1); }

  // Dois funcionários sem NENHUMA batida em julho → todo dia útil é falta.
  const alfa = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: '50000000001', nome: 'Alfa Banco', horarioContratualId: hor.id, cctId: regraBanco.id }).returning()))[0]!;
  const beta = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: '50000000002', nome: 'Beta Desconto', horarioContratualId: hor.id, cctId: regraDesc.id }).returning()))[0]!;

  await banco.lancarCompetencia(t.id, alfa.id, '2026-07');
  await banco.lancarCompetencia(t.id, beta.id, '2026-07');

  const sAlfa = await banco.saldo(t.id, alfa.id, '2026-07-31');
  const sBeta = await banco.saldo(t.id, beta.id, '2026-07-31');

  const debitosAlfa = sAlfa.extrato.filter((m) => m.tipo === 'DEBITO').length;
  ok(debitosAlfa > 0, `Alfa (falta→BANCO): faltas ABATERAM do banco (${debitosAlfa} débitos)`);
  ok(sBeta.extrato.length === 0, `Beta (falta→DESCONTA): NADA foi pro banco (${sBeta.extrato.length} movimentos)`);

  // O resumo da apuração diz pra onde a falta foi, por funcionário.
  const apAlfa = await trat.apurarPeriodoCLT(t.id, alfa.id, '2026-07-01', '2026-07-31', []);
  const apBeta = await trat.apurarPeriodoCLT(t.id, beta.id, '2026-07-01', '2026-07-31', []);
  ok(apAlfa.destinacao?.falta.destino === 'BANCO', `resumo do Alfa: falta → banco (${apAlfa.destinacao?.falta.destino})`);
  ok(apBeta.destinacao?.falta.destino === 'DESCONTA', `resumo do Beta: falta → desconto (${apBeta.destinacao?.falta.destino})`);
  ok((apAlfa.destinacao?.falta.min ?? 0) > 0, 'houve falta a destinar');

  console.log(falhas === 0 ? '\n>>> DESTINACAO OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
