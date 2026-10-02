import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema, comoMaster, comTenant, tenant, empregado, pontoRep, pontoBancoMov } from '@ponto/db';
import { BancoService } from '../src/banco/banco.service';
import { TratamentoService } from '../src/tratamento/tratamento.service';

const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const banco = new BancoService(db, new TratamentoService(db));

let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };

async function main() {
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({
    cnpj: '33333333000133', razaoSocial: 'Banco Lote LTDA',
    bancoTipoAcordo: 'INDIVIDUAL', bancoPrazoMeses: 6,
  }).returning()))[0]!;
  await comoMaster(db, (tx) => tx.insert(pontoRep).values({
    tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: '33333333000133',
    razaoSocial: 'Banco Lote LTDA', numeroInpi: 'BR512024001234-5',
    tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188',
  }).returning());
  const e1 = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: '11111111111', nome: 'Ana' }).returning()))[0]!;
  const e2 = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: '22222222222', nome: 'Bruno' }).returning()))[0]!;

  // Simula lançamentos anteriores marcando a competência.
  await comTenant(db, t.id, (tx) => tx.insert(pontoBancoMov).values([
    { tenantId: t.id, empregadoId: e1.id, data: '2026-06-03', minutos: 120, tipo: 'CREDITO', competencia: '2026-06' },
    { tenantId: t.id, empregadoId: e1.id, data: '2026-06-10', minutos: 60, tipo: 'CREDITO', competencia: '2026-06' },
    { tenantId: t.id, empregadoId: e2.id, data: '2026-06-05', minutos: -30, tipo: 'DEBITO', competencia: '2026-06' },
    { tenantId: t.id, empregadoId: e1.id, data: '2026-05-08', minutos: 200, tipo: 'CREDITO', competencia: '2026-05' },
    // movimento avulso (sem competência) — NÃO deve aparecer no histórico
    { tenantId: t.id, empregadoId: e1.id, data: '2026-06-20', minutos: -50, tipo: 'PAGAMENTO', competencia: null },
  ]));

  const hist = await banco.historicoCompetencias(t.id);
  ok(hist.length === 2, `histórico tem 2 competências (tem ${hist.length})`);
  ok(hist[0]!.competencia === '2026-06' && hist[1]!.competencia === '2026-05', 'ordenado da mais recente para a mais antiga');

  const jun = hist.find((h) => h.competencia === '2026-06')!;
  ok(jun.funcionarios === 2, `junho: 2 funcionários (${jun.funcionarios})`);
  ok(jun.totalMin === 150, `junho: total +150min = 120+60-30 (${jun.totalMin})`);
  const ana = jun.porFuncionario.find((f) => f.nome === 'Ana');
  ok(ana?.minutos === 180, `junho: Ana somou 180min (${ana?.minutos})`);
  ok(jun.porFuncionario[0]!.nome === 'Ana', 'detalhe ordenado por minutos desc (Ana primeiro)');
  ok(!!jun.lancadoEm, 'traz a data do lançamento (max criadoEm)');

  const mai = hist.find((h) => h.competencia === '2026-05')!;
  ok(mai.funcionarios === 1 && mai.totalMin === 200, `maio: 1 funcionário, +200min (${mai.funcionarios}, ${mai.totalMin})`);

  // O movimento avulso (PAGAMENTO sem competência) não entra em nenhum grupo.
  const totalHist = hist.reduce((s, h) => s + h.totalMin, 0);
  ok(totalHist === 350, `avulso sem competência fica de fora do histórico (${totalHist} = 150+200)`);

  // Lote roda para todos os ativos e devolve a forma certa.
  const lote = await banco.lancarCompetenciaLote(t.id, '2026-07');
  ok(lote.funcionarios === 2, `lote atinge os 2 ativos (${lote.funcionarios})`);
  ok(Array.isArray(lote.porFuncionario) && lote.porFuncionario.length === 2, 'lote devolve detalhe por funcionário');
  ok(lote.competencia === '2026-07', 'lote ecoa a competência');

  // Idempotência: relançar não duplica (sem batidas, continua 0 e não quebra).
  const lote2 = await banco.lancarCompetenciaLote(t.id, '2026-07');
  ok(lote2.funcionarios === 2, 'relançar o lote é idempotente e não quebra');

  console.log(falhas === 0 ? '\n>>> BANCO LOTE/HISTÓRICO OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
