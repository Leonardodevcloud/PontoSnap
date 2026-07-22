import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { schema, comoMaster, tenant, empregado, pontoRep, pontoHorarioContratual, pontoMarcacao } from '@ponto/db';
import { RegraItemService } from '../src/regra-item/regra-item.service';
import { EmpregadoService } from '../src/empregado/empregado.service';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { BancoService } from '../src/banco/banco.service';
import { FiscalService } from '../src/fiscal/fiscal.service';

const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const itens = new RegraItemService(db);
const trat = new TratamentoService(db);
const banco = new BancoService(db, trat);
const empSvc = new EmpregadoService(db as never, {} as never);
const fiscal = new FiscalService(db as never, {} as never);

let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };

async function main() {
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: '11122233000144', razaoSocial: 'AEJ BANCO LTDA' }).returning()))[0]!;
  const rep = (await comoMaster(db, (tx) => tx.insert(pontoRep).values({ tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: '11122233000144', razaoSocial: 'AEJ BANCO LTDA', numeroInpi: 'BR512024001112-3', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188' }).returning()))[0]!;
  const hor = (await comoMaster(db, (tx) => tx.insert(pontoHorarioContratual).values({ tenantId: t.id, codigo: 'ADM', durJornadaMin: 480, pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }], diasSemana: [1, 2, 3, 4, 5], regime: 'normal' }).returning()))[0]!;

  const bancoItem = await itens.criar(t.id, 'BANCO', 'Individual 6m', { bancoModo: 'ATIVO', bancoTipoAcordo: 'INDIVIDUAL', bancoPrazoMeses: 6, formaCalculo: 'BANCO_HORAS' }, false);
  const emp = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: '11100000001', nome: 'Extra Man', horarioContratualId: hor.id }).returning()))[0]!;
  await empSvc.definirRegras(t.id, emp.id, { regraBancoId: bancoItem!.id });

  // 9h numa segunda → 1h extra → crédito de 60min no banco
  let nsr = 1;
  const bate = (iso: string) => comoMaster(db, (tx) => tx.insert(pontoMarcacao).values({ tenantId: t.id, repId: rep.id, nsr: nsr++, cpf: emp.cpf, dtMarcacao: new Date(iso), coletor: 1, hashRegistro: nsr.toString(16).padStart(64, '0') }).returning());
  await bate('2026-07-13T11:00:00Z'); await bate('2026-07-13T15:00:00Z');
  await bate('2026-07-13T16:00:00Z'); await bate('2026-07-13T21:00:00Z');

  await banco.lancarCompetencia(t.id, emp.id, '2026-07');
  const saldo = await banco.saldo(t.id, emp.id, '2026-07-31');
  ok(saldo.extrato.some((m) => m.tipo === 'CREDITO' && m.minutos === 60), `banco tem crédito de 60min pela regra (${saldo.extrato.length} mov)`);

  // Gera o AEJ e confere que o crédito virou registro 07 de banco (tipoMovBH=1)
  const aej = await fiscal.gerarAej(t.id);
  const texto = aej.conteudo.toString('latin1');
  const linhas07 = texto.split('\r\n').filter((l) => l.startsWith('07|'));
  const temCredito = linhas07.some((l) => { const c = l.split('|'); return c[c.length - 1] === '1' && c[c.length - 2] === '60'; });
  ok(linhas07.length > 0, `AEJ tem registro(s) 07 (${linhas07.length})`);
  ok(temCredito, 'crédito de banco (60min, tipoMovBH=1) aparece no AEJ');
  if (linhas07[0]) console.log('    linha 07:', linhas07.find((l) => l.endsWith('|60|1')) ?? linhas07[0]);

  console.log(falhas === 0 ? '\n>>> AEJ-BANCO OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
