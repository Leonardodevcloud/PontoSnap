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
  bancoTipoAcordo: null, ativa: true, padrao: false,
};

async function main() {
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({
    cnpj: '44444444000144', razaoSocial: 'BANCO REGRA LTDA', bancoTipoAcordo: 'INDIVIDUAL', bancoPrazoMeses: 6,
  }).returning()))[0]!;
  await comoMaster(db, (tx) => tx.insert(pontoRep).values({
    tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: '44444444000144', razaoSocial: 'BANCO REGRA LTDA',
    numeroInpi: 'BR512024003333-3', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188',
  }).returning());
  const hor = (await comoMaster(db, (tx) => tx.insert(pontoHorarioContratual).values({
    tenantId: t.id, codigo: 'ADM', durJornadaMin: 480,
    pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }], diasSemana: [1, 2, 3, 4, 5], regime: 'normal',
  }).returning()))[0]!;

  const padrao = await cctSvc.criar(t.id, {
    nome: 'Padrão da empresa', extraDiaUtilPct: 70, bancoModo: 'ATIVO', bancoPrazoMeses: 12,
    ...base, bancoTipoAcordo: 'COLETIVO', padrao: true,
  } as never);
  const semBanco = await cctSvc.criar(t.id, {
    nome: 'Terceirizado sem banco', extraDiaUtilPct: 50, bancoModo: 'INATIVO', ...base,
  } as never);
  if (!padrao || !semBanco) { console.log('FALHA — criar regra'); await client.end(); process.exit(1); }

  const semBco = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: '40000000001', nome: 'Rita Terceirizada', horarioContratualId: hor.id, cctId: semBanco.id }).returning()))[0]!;
  const herda = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: '40000000002', nome: 'Ana Sem Regra', horarioContratualId: hor.id }).returning()))[0]!;

  const sRita = await banco.saldo(t.id, semBco.id, '2026-07-20');
  ok(sRita.ativo === false, `Rita (regra INATIVO) NAO tem banco, mesmo a empresa tendo (${sRita.ativo})`);

  const sAna = await banco.saldo(t.id, herda.id, '2026-07-20');
  ok(sAna.ativo === true && sAna.prazoMeses === 12, `Ana (sem regra) cai na PADRAO: banco 12m (${sAna.ativo}/${sAna.prazoMeses})`);

  const rep = (await comoMaster(db, (tx) => tx.select().from(pontoRep).where(eq(pontoRep.tenantId, t.id)).limit(1)))[0]!;
  let nsr = 1;
  const bate = (cpf: string, isoUtc: string) => comoMaster(db, (tx) => tx.insert(pontoMarcacao).values({
    tenantId: t.id, repId: rep.id, nsr: nsr++, cpf, dtMarcacao: new Date(isoUtc), coletor: 1,
    hashRegistro: nsr.toString(16).padStart(64, '0'),
  }).returning());
  await bate(herda.cpf, '2026-07-13T11:00:00Z');
  await bate(herda.cpf, '2026-07-13T15:00:00Z');
  await bate(herda.cpf, '2026-07-13T16:00:00Z');
  await bate(herda.cpf, '2026-07-13T21:00:00Z');

  const apAna = await trat.apurarPeriodoCLT(t.id, herda.id, '2026-07-13', '2026-07-13', []);
  const extraAna = apAna.resultado.dias.find((d) => d.data === '2026-07-13')?.extras[0];
  ok(!!extraAna && extraAna.adicionalPct === 70, `Ana (sem regra) apura pela PADRAO a 70% (${extraAna?.adicionalPct})`);

  const outra = await cctSvc.criar(t.id, { nome: 'Nova padrao', extraDiaUtilPct: 55, bancoModo: 'HERDA', ...base, padrao: true } as never);
  const lista = await cctSvc.listar(t.id);
  const qtdPadrao = lista.filter((c) => c.padrao).length;
  ok(qtdPadrao === 1, `so uma regra padrao por empresa (${qtdPadrao})`);
  ok(lista.find((c) => c.id === outra!.id)?.padrao === true, 'a nova virou a padrao');
  ok(lista.find((c) => c.id === padrao.id)?.padrao === false, 'a antiga deixou de ser padrao');

  console.log(falhas === 0 ? '\n>>> CCT-BANCO OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
