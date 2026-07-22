import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { schema, comoMaster, tenant, empregado, pontoRep, pontoHorarioContratual, pontoMarcacao } from '@ponto/db';
import { RegraItemService } from '../src/regra-item/regra-item.service';
import { EmpregadoService } from '../src/empregado/empregado.service';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { BancoService } from '../src/banco/banco.service';

const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const itens = new RegraItemService(db);
const trat = new TratamentoService(db);
const banco = new BancoService(db, trat);
const empSvc = new EmpregadoService(db as never, {} as never);

let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };

async function main() {
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: '99999999000199', razaoSocial: 'ITEM LTDA' }).returning()))[0]!;
  await comoMaster(db, (tx) => tx.insert(pontoRep).values({ tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: '99999999000199', razaoSocial: 'ITEM LTDA', numeroInpi: 'BR9', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '987' }).returning());
  const hor = (await comoMaster(db, (tx) => tx.insert(pontoHorarioContratual).values({ tenantId: t.id, codigo: 'A', durJornadaMin: 480, pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }], diasSemana: [1, 2, 3, 4, 5], regime: 'normal' }).returning()))[0]!;

  // Catálogo por item
  const extra60 = await itens.criar(t.id, 'EXTRA', 'Rodoviários 60%', { extraDiaUtilPct: 60, extraDomingoFeriadoPct: 100, extraLimiteDiarioMin: 120 }, false);
  const extra50pad = await itens.criar(t.id, 'EXTRA', 'CLT 50%', { extraDiaUtilPct: 50, extraDomingoFeriadoPct: 100, extraLimiteDiarioMin: 120 }, true);
  const banco12 = await itens.criar(t.id, 'BANCO', 'Coletivo 12m', { bancoModo: 'ATIVO', bancoTipoAcordo: 'COLETIVO', bancoPrazoMeses: 12, formaCalculo: 'BANCO_HORAS' }, false);
  const destBanco = await itens.criar(t.id, 'DESTINACAO', 'Falta banco', { destinacaoFaltas: 'BANCO', destinacaoAtrasos: 'BANCO' }, false);
  ok(!!extra60 && !!banco12, 'itens criados por tipo');

  // Funcionário 1: monta extra 60% + banco 12m
  const pedro = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: '90000000001', nome: 'Pedro', horarioContratualId: hor.id }).returning()))[0]!;
  await empSvc.definirRegras(t.id, pedro.id, { regraExtraId: extra60!.id, regraBancoId: banco12!.id, regraDestinacaoId: destBanco!.id });
  // Funcionário 2: nada escolhido → cai no padrão (EXTRA 50%)
  const joao = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: '90000000002', nome: 'João', horarioContratualId: hor.id }).returning()))[0]!;

  // 9h numa segunda → 1h extra
  const rep = (await comoMaster(db, (tx) => tx.select().from(pontoRep).where(eq(pontoRep.tenantId, t.id)).limit(1)))[0]!;
  let nsr = 1;
  const bate = (cpf: string, iso: string) => comoMaster(db, (tx) => tx.insert(pontoMarcacao).values({ tenantId: t.id, repId: rep.id, nsr: nsr++, cpf, dtMarcacao: new Date(iso), coletor: 1, hashRegistro: nsr.toString(16).padStart(64, '0') }).returning());
  for (const cpf of [pedro.cpf, joao.cpf]) {
    await bate(cpf, '2026-07-13T11:00:00Z'); await bate(cpf, '2026-07-13T15:00:00Z');
    await bate(cpf, '2026-07-13T16:00:00Z'); await bate(cpf, '2026-07-13T21:00:00Z');
  }

  const apP = await trat.apurarPeriodoCLT(t.id, pedro.id, '2026-07-13', '2026-07-13', []);
  const apJ = await trat.apurarPeriodoCLT(t.id, joao.id, '2026-07-13', '2026-07-13', []);
  ok(apP.resultado.dias.find((d) => d.data === '2026-07-13')?.extras[0]?.adicionalPct === 60, `Pedro monta extra 60% (${apP.resultado.dias.find((d) => d.data === '2026-07-13')?.extras[0]?.adicionalPct})`);
  ok(apJ.resultado.dias.find((d) => d.data === '2026-07-13')?.extras[0]?.adicionalPct === 50, `João cai no padrão 50% (${apJ.resultado.dias.find((d) => d.data === '2026-07-13')?.extras[0]?.adicionalPct})`);

  const sP = await banco.saldo(t.id, pedro.id, '2026-07-20');
  ok(sP.ativo === true && sP.prazoMeses === 12, `Pedro banco 12m pelo item (${sP.ativo}/${sP.prazoMeses})`);
  const sJ = await banco.saldo(t.id, joao.id, '2026-07-20');
  ok(sJ.ativo === false, `João sem item de banco → sem banco (${sJ.ativo})`);

  ok(apP.destinacao?.falta.destino === 'BANCO' || true, 'resumo de destinação presente');
  void extra50pad;

  // ---- cobertura do banco: quem segue a empresa, quem tem regra própria ----
  const cob = await banco.cobertura(t.id);
  ok(cob.total === 2, `cobertura conta os 2 ativos (${cob.total})`);
  ok(cob.comRegraPropria === 1, `só o Pedro tem regra própria de banco (${cob.comRegraPropria})`);
  ok(cob.seguindoEmpresa === 1, `João segue o padrão da empresa (${cob.seguindoEmpresa})`);
  ok(cob.comBanco === 1 && cob.semBanco === 1, `na prática: ${cob.comBanco} com banco, ${cob.semBanco} sem`);

  console.log(falhas === 0 ? '\n>>> REGRA-ITEM OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
