import 'reflect-metadata';
process.env.APP_CRYPTO_KEY = Buffer.alloc(32, 3).toString('base64');
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema, comoMaster, tenant, empregado, pontoRep, pontoMarcacao, pontoDocumento } from '@ponto/db';
import { TratamentoService } from '../src/tratamento/tratamento.service';

const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const trat = new TratamentoService(db);

let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };

async function main() {
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: '22222222000122', razaoSocial: 'Painel LTDA' }).returning()))[0]!;
  const rep = (await comoMaster(db, (tx) => tx.insert(pontoRep).values({
    tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: '22222222000122', razaoSocial: 'Painel LTDA',
    numeroInpi: 'BR512024001111-1', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188',
  }).returning()))[0]!;
  const maria = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: '10000000001', nome: 'Maria Souza' }).returning()))[0]!;
  const joao = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: '10000000002', nome: 'João Lima' }).returning()))[0]!;

  let nsr = 1;
  const bater = (cpf: string, iso: string) => comoMaster(db, (tx) => tx.insert(pontoMarcacao).values({
    tenantId: t.id, repId: rep.id, nsr: nsr++, cpf, dtMarcacao: new Date(iso), coletor: 1,
    hashRegistro: nsr.toString(16).padStart(64, '0'),
  }).returning());

  // Maria: 3 batidas num dia passado (ímpar → esqueceu de bater a saída) → revisar
  await bater(maria.cpf, '2026-07-16T11:00:00Z');
  await bater(maria.cpf, '2026-07-16T15:00:00Z');
  await bater(maria.cpf, '2026-07-16T16:00:00Z');
  // João: 2 batidas num dia passado (par) → NÃO entra em revisar
  await bater(joao.cpf, '2026-07-15T11:00:00Z');
  await bater(joao.cpf, '2026-07-15T20:00:00Z');

  // Atestados: 1 em análise (conta) + 1 já abonado (não conta)
  await comoMaster(db, (tx) => tx.insert(pontoDocumento).values([
    { tenantId: t.id, empregadoId: maria.id, tipo: 'ATESTADO', dataInicio: '2026-07-10', dataFim: '2026-07-10', arquivo: Buffer.from('x'), arquivoNome: 'a', arquivoMime: 'image/png', arquivoBytes: 1, status: 'EM_ANALISE' },
    { tenantId: t.id, empregadoId: joao.id, tipo: 'ATESTADO', dataInicio: '2026-07-09', dataFim: '2026-07-09', arquivo: Buffer.from('y'), arquivoNome: 'b', arquivoMime: 'image/png', arquivoBytes: 1, status: 'ABONADO' },
  ]).returning());

  const p = await trat.painel(t.id);
  ok(p.pendencias.atestados === 1, `conta só os atestados em análise (${p.pendencias.atestados})`);
  ok(p.pendencias.revisarTotal === 1, `só o dia ímpar entra em revisar (${p.pendencias.revisarTotal})`);
  ok(p.pendencias.revisar[0]?.nome === 'Maria Souza', `aponta quem esqueceu (${p.pendencias.revisar[0]?.nome})`);
  ok(p.pendencias.revisar[0]?.data === '2026-07-16', `aponta o dia certo (${p.pendencias.revisar[0]?.data})`);
  ok(p.ativos === 2, `conta os ativos (${p.ativos})`);

  console.log(falhas === 0 ? '\n>>> PAINEL PENDÊNCIAS OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
