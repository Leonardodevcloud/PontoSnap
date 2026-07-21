import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema, comoMaster, tenant, empregado, pontoRep } from '@ponto/db';
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
  destinacaoFaltas: 'DESCONTA', destinacaoAtrasos: 'BANCO',
};

async function main() {
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({
    cnpj: '77777777000177', razaoSocial: 'FORMA LTDA', bancoTipoAcordo: 'INDIVIDUAL', bancoPrazoMeses: 6,
  }).returning()))[0]!;
  await comoMaster(db, (tx) => tx.insert(pontoRep).values({
    tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: '77777777000177', razaoSocial: 'FORMA LTDA',
    numeroInpi: 'BR512024007777-7', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188',
  }).returning());

  const acumula = await cctSvc.criar(t.id, { nome: 'Acumula', ...base, formaCalculo: 'BANCO_HORAS' } as never);
  const intraMes = await cctSvc.criar(t.id, { nome: 'Intra-mes', ...base, formaCalculo: 'INTRA_MES' } as never);
  if (!acumula || !intraMes) { console.log('FALHA — criar'); await client.end(); process.exit(1); }

  const eA = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: '70000000001', nome: 'Acumulador', cctId: acumula.id }).returning()))[0]!;
  const eB = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: '70000000002', nome: 'Mensal', cctId: intraMes.id }).returning()))[0]!;

  // Ambos: crédito em junho e crédito em julho.
  for (const e of [eA, eB]) {
    await banco.lancarMovimento(t.id, { empregadoId: e.id, data: '2026-06-15', minutos: 120, tipo: 'CREDITO', descricao: 'junho' });
    await banco.lancarMovimento(t.id, { empregadoId: e.id, data: '2026-07-10', minutos: 60, tipo: 'CREDITO', descricao: 'julho' });
  }

  const sA = await banco.saldo(t.id, eA.id, '2026-07-20');
  const sB = await banco.saldo(t.id, eB.id, '2026-07-20');

  ok(sA.extrato.length === 2, `Acumulador (BANCO_HORAS) enxerga junho+julho (${sA.extrato.length} movimentos)`);
  ok(sB.extrato.length === 1, `Mensal (INTRA_MES) enxerga só julho (${sB.extrato.length} movimento)`);
  ok(sB.formaCalculo === 'INTRA_MES' && sA.formaCalculo === 'BANCO_HORAS', 'forma de cálculo reflete a regra de cada um');

  console.log(falhas === 0 ? '\n>>> FORMA-CALCULO OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
