import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema, comoMaster, tenant, pontoRep, pontoHorarioContratual, pontoMarcacao, empregado } from '@ponto/db';
import { eq } from 'drizzle-orm';
import { EmpregadoService } from '../src/empregado/empregado.service';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { PessoalService } from '../src/pessoal/pessoal.service';
import { CriptoService } from '../src/common/cripto.service';
import { diasDoMes, diaSemana } from '../src/pessoal/calculo';

/** Promoção no meio do mês: salário com vigência, mês proporcional, passado intacto. */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const empSvc = new EmpregadoService(db as never, {} as never, { exigirVaga: async () => {} } as never);
const trat = new TratamentoService(db);
const pes = new PessoalService(db, trat, new CriptoService());
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };
const em = (d: string, hm: string) => new Date(`${d}T${hm}:00-0300`);
const erroDe = async (f: () => Promise<unknown>) => { try { await f(); return ''; } catch (e) { return (e as Error).message; } };

async function main() {
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: '22222222000122', razaoSocial: 'PROMO LTDA' }).returning()))[0]!;
  const rep = (await comoMaster(db, (tx) => tx.insert(pontoRep).values({ tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: '22222222000122', razaoSocial: 'PROMO', numeroInpi: 'BR2', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188' }).returning()))[0]!;
  const hor = (await comoMaster(db, (tx) => tx.insert(pontoHorarioContratual).values({ tenantId: t.id, codigo: 'A', durJornadaMin: 480, diasSemana: [1, 2, 3, 4, 5], regime: 'normal', pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }] }).returning()))[0]!;
  const e = await empSvc.criar(t.id, { cpf: '20000000001', nome: 'Paulo Promovido', salarioMensal: 3000 } as never);
  await comoMaster(db, (tx) => tx.update(empregado).set({ horarioContratualId: hor.id }).where(eq(empregado.id, e.id)));

  // Setembro inteiro trabalhado; 1h extra em 14/09 (antes) e 16/09 (depois da promoção).
  let n = 1;
  const dias = diasDoMes('2026-09').filter((d) => diaSemana(d) >= 1 && diaSemana(d) <= 5);
  const bs = dias.flatMap((d) => [em(d, '08:00'), em(d, '12:00'), em(d, '13:00'), em(d, d === '2026-09-14' || d === '2026-09-16' ? '18:00' : '17:00')]);
  await comoMaster(db, (tx) => tx.insert(pontoMarcacao).values(bs.map((b) => ({ tenantId: t.id, repId: rep.id, nsr: n, cpf: e.cpf, dtMarcacao: b, coletor: 1, hashRegistro: String(n++).padStart(64, '0') }))));

  ok((await erroDe(() => empSvc.definirSalario(t.id, e.id, 4500))).includes('a partir de'), 'mudar salário sem data é recusado');
  await empSvc.definirSalario(t.id, e.id, 4500, '2026-09-15');

  const ap = await trat.apurarPeriodoCLT(t.id, e.id, '2026-09-01', '2026-09-30', []);
  const hA = Math.round(300000 / 220), hN = Math.round(450000 / 220);
  const esperado = Math.round(hA * 1.5) + Math.round(hN * 1.5);
  ok(ap.valores!.extrasCentavos === esperado, `extra de 14/09 pelo salário antigo e de 16/09 pelo novo (${ap.valores!.extrasCentavos} = ${esperado})`);

  const set = (await pes.competencia(t.id, '2026-09')).clt[0]!;
  ok(set.salarioCent === 380000, `salário de setembro proporcional: 3.000×14/30 + 4.500×16/30 = R$ 3.800 (${set.salarioCent})`);
  ok(set.salarioPartes.length === 2 && set.salarioPartes[1]!.desde === '2026-09-15', 'dois trechos, o novo desde 15/09');
  ok(set.valorHoraCent === hN, 'valor-hora exibido = salário vigente no fim do mês');

  const ago = (await pes.competencia(t.id, '2026-08')).clt[0]!;
  ok(ago.salarioCent === 300000, `agosto continua R$ 3.000 (${ago.salarioCent})`);
  const out = (await pes.competencia(t.id, '2026-10')).clt[0]!;
  ok(out.salarioCent === 450000 && out.salarioPartes.length === 1, `outubro inteiro com R$ 4.500 (${out.salarioCent})`);
  const hist = await empSvc.historicoSalario(t.id, e.id);
  ok(hist.length === 2 && hist[0]!.vigenteDesde === '2026-09-15', 'histórico com os dois salários');

  await pes.fechar(t.id, '2026-09');
  ok((await erroDe(() => empSvc.definirSalario(t.id, e.id, 5000, '2026-09-20'))).includes('fechado'), 'não muda salário dentro de mês fechado');
  ok((await erroDe(() => empSvc.definirSalario(t.id, e.id, 5000, '2026-10-01'))) === '', 'reajuste em outubro (aberto) passa');

  console.log(falhas === 0 ? '\n>>> SALARIO-VIGENCIA OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end(); process.exit(falhas === 0 ? 0 : 1);
}
main().catch((x) => { console.error(x); process.exit(1); });
