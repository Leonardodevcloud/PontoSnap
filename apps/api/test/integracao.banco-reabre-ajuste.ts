import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { schema, comoMaster, tenant, empregado, pontoRep, pontoHorarioContratual, pontoMarcacao, pontoPerfilRegra, pontoBancoFechamento } from '@ponto/db';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { BancoService } from '../src/banco/banco.service';
import { AjusteService } from '../src/ajuste/ajuste.service';
import { AfastamentoService } from '../src/afastamento/afastamento.service';

/**
 * Banco de horas com mês já fechado: ajuste de batida lançado pelo RH,
 * afastamento e revogação reabrem aquele mês, e a sincronização refaz o
 * saldo com o ajuste (sem precisar de "Refazer mês" na mão).
 */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 3 });
const db = drizzle(client, { schema });
const trat = new TratamentoService(db);
const banco = new BancoService(db, trat);
const ajustes = new AjusteService(db);
const afast = new AfastamentoService(db);
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };
const em = (d: string, hm: string) => new Date(`${d}T${hm}:00-0300`);

async function main() {
  const CNPJ = `23${String(Date.now()).slice(-12)}`;
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: CNPJ, razaoSocial: 'Reabre', bancoTipoAcordo: 'INDIVIDUAL', bancoPrazoMeses: 5 }).returning()))[0]!;
  const rep = (await comoMaster(db, (tx) => tx.insert(pontoRep).values({ tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: CNPJ, razaoSocial: 'Reabre', numeroInpi: 'BR512024009999-9', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188' }).returning()))[0]!;
  const hor = (await comoMaster(db, (tx) => tx.insert(pontoHorarioContratual).values({ tenantId: t.id, codigo: 'COML', durJornadaMin: 480, pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }], diasSemana: [1, 2, 3, 4, 5], regime: 'normal' }).returning()))[0]!;
  const perfil = (await comoMaster(db, (tx) => tx.insert(pontoPerfilRegra).values({ tenantId: t.id, nome: 'Geral', padrao: true, config: { banco: { bancoModo: 'ATIVO', bancoTipoAcordo: 'INDIVIDUAL', bancoPrazoMeses: 5, formaCalculo: 'BANCO_HORAS' } } }).returning()))[0]!;
  const cpf = `7${CNPJ.slice(-10)}`;
  const emp = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf, nome: 'Rafa', horarioContratualId: hor.id, salarioMensal: '2200.00', perfilRegraId: perfil.id, dataInicioPonto: '2026-10-01' }).returning()))[0]!;
  // 20/10: saiu às 16h (−1h). Esqueceu de bater a saída do almoço certo etc. O RH vai incluir/corrigir depois.
  let nsr = 1;
  const marc = [em('2026-10-20', '08:00'), em('2026-10-20', '12:00'), em('2026-10-20', '13:00'), em('2026-10-20', '16:00')];
  await comoMaster(db, (tx) => tx.insert(pontoMarcacao).values(marc.map((b) => ({ tenantId: t.id, repId: rep.id, nsr, cpf, dtMarcacao: b, coletor: 1, hashRegistro: String(nsr++).padStart(64, '0') }))));

  const fechOut = async () => (await comoMaster(db, (tx) => tx.select().from(pontoBancoFechamento).where(and(eq(pontoBancoFechamento.tenantId, t.id), eq(pontoBancoFechamento.competencia, '2026-10')))))[0];
  await banco.sincronizar(t.id, emp.id, '2026-11-04');
  const f1 = await fechOut();
  ok(!!f1, `outubro fechou sozinho (total ${f1?.totalMin}min)`);

  // RH desconsidera a saída das 16h e inclui 17h (correção): o dia deixa de ter −1h.
  const marcs = await comoMaster(db, (tx) => tx.select().from(pontoMarcacao).where(eq(pontoMarcacao.tenantId, t.id)));
  const as16 = marcs.find((m) => m.dtMarcacao.getTime() === em('2026-10-20', '16:00').getTime())!;
  const aj = await ajustes.solicitar(t.id, { empregadoId: emp.id, tipo: 'CORRECAO', data: '2026-10-20', hora: '17:00', tpMarc: 'S', marcacaoId: as16.id, observacao: 'Saiu às 17h' } as never, 'RH');
  ok(!(await fechOut()), 'ajuste do RH num mês fechado reabre o banco daquele mês');
  await banco.sincronizar(t.id, emp.id, '2026-11-04');
  const f2 = await fechOut();
  ok(!!f2 && f2.totalMin === f1!.totalMin + 60, `sincronização refaz com o ajuste (${f1?.totalMin} → ${f2?.totalMin})`);

  await ajustes.revogar(t.id, aj!.id, 'RH');
  ok(!(await fechOut()), 'revogar o ajuste reabre de novo');
  await banco.sincronizar(t.id, emp.id, '2026-11-04');
  ok((await fechOut())?.totalMin === f1!.totalMin, 'e o saldo volta ao de antes');

  const a = await afast.criar(t.id, null as never, { empregadoId: emp.id, tipo: 'OUTRO', dataInicio: '2026-10-27', dataFim: '2026-10-28' });
  ok(!(await fechOut()), 'afastamento num mês fechado reabre o banco');
  await banco.sincronizar(t.id, emp.id, '2026-11-04');
  await afast.remover(t.id, a!.id);
  ok(!(await fechOut()), 'remover o afastamento também reabre');

  console.log(falhas === 0 ? '\nTudo certo' : `\n${falhas} FALHA(S)`);
  await client.end();
  process.exit(falhas ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
