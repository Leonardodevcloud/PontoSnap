import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema, comoMaster, tenant, empregado, pontoRep } from '@ponto/db';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { PessoalService } from '../src/pessoal/pessoal.service';
import { CriptoService } from '../src/common/cripto.service';

/** Feriados por região: nacional p/ todos, estadual p/ a UF, municipal p/ a cidade; sem cidade = a da empresa. */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const trat = new TratamentoService(db);
const pes = new PessoalService(db, trat, new CriptoService());
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };
async function falha(p: Promise<unknown>) { try { await p; return null; } catch (e) { return (e as Error).message; } }

const SSA = { municipio: 2927408, municipioNome: 'Salvador' };
const LAURO = { municipio: 2919207, municipioNome: 'Lauro de Freitas' };
const MCZ = { municipio: 2704302, municipioNome: 'Maceió' };

async function main() {
  const CNPJ = `83${String(Date.now()).slice(-12)}`;
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: CNPJ, razaoSocial: 'Regiões LTDA' }).returning()))[0]!;
  await comoMaster(db, (tx) => tx.insert(pontoRep).values({
    tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: CNPJ, razaoSocial: 'Regiões LTDA',
    numeroInpi: 'BR512024007777-7', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188',
  }));
  const pares = [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }];
  const h = (await trat.criarHorario(t.id, { codigo: 'SEG-SAB', durJornadaMin: 480, pares, diasSemana: [1, 2, 3, 4, 5, 6] }))!;
  let n = 0;
  const novo = async (nome: string) => (await comoMaster(db, (tx) => tx.insert(empregado).values({
    tenantId: t.id, cpf: `${CNPJ.slice(-9)}${String(++n).padStart(2, '0')}`, nome, horarioContratualId: h.id, dataInicioPonto: '2026-12-01',
  }).returning()))[0]!;
  const ana = await novo('Ana Salvador (sem cidade)');
  const pedro = await novo('Pedro Lauro');
  const bruna = await novo('Bruna Maceió');

  // ── cadastro de feriados com região ──
  ok(!!(await falha(trat.criarFeriado(t.id, { data: '2026-12-09', nome: 'X', tipo: 'estadual' }))), 'estadual sem estado é recusado');
  ok(!!(await falha(trat.criarFeriado(t.id, { data: '2026-12-08', nome: 'X', tipo: 'municipal', municipio: 123, municipioNome: 'X' }))), 'municipal com código inválido é recusado');
  const fSsa = await trat.criarFeriado(t.id, { data: '2026-12-08', nome: 'Conceição da Praia', tipo: 'municipal', ...SSA, uf: 'AL' });
  ok(fSsa!.uf === 'BA' && fSsa!.municipio === SSA.municipio, 'municipal: a UF vem do código da cidade (ignora a UF mandada)');
  await trat.criarFeriado(t.id, { data: '2026-12-09', nome: 'Feriado BA (teste)', tipo: 'estadual', uf: 'BA' });
  await trat.criarFeriado(t.id, { data: '2026-12-10', nome: 'Feriado AL (teste)', tipo: 'estadual', uf: 'AL' });
  // antigo: municipal sem região (como era antes) → vale para todos
  const antigo = await trat.criarFeriado(t.id, { data: '2026-12-11', nome: 'Antigo', tipo: 'nacional' });
  await comoMaster(db, (tx) => tx.execute(`update ponto_feriado set tipo = 'municipal' where id = '${antigo!.id}'`));
  await trat.criarFeriado(t.id, { data: '2026-12-25', nome: 'Natal', tipo: 'nacional' });

  const fer = async (id: string) => (await trat.apurarPeriodoCLT(t.id, id, '2026-12-07', '2026-12-31', [])).feriados.join(',');

  // ── empresa sem cidade, ninguém com cidade: só nacional e os sem região ──
  ok(await fer(ana.id) === '2026-12-11,2026-12-25', `sem cidade em lugar nenhum: só o sem região e o nacional (${await fer(ana.id)})`);

  // ── cidade da empresa + cidade das pessoas ──
  await trat.definirLocalEmpresa(t.id, SSA);
  await trat.definirLocalPessoas(t.id, { empregadoIds: [pedro.id], ...LAURO });
  await trat.definirLocalPessoas(t.id, { empregadoIds: [bruna.id], ...MCZ });
  ok(await fer(ana.id) === '2026-12-08,2026-12-09,2026-12-11,2026-12-25', `Ana (cidade da empresa, Salvador): municipal SSA + estadual BA + sem região + nacional (${await fer(ana.id)})`);
  ok(await fer(pedro.id) === '2026-12-09,2026-12-11,2026-12-25', `Pedro (Lauro): estadual BA, sem o municipal de Salvador (${await fer(pedro.id)})`);
  ok(await fer(bruna.id) === '2026-12-10,2026-12-11,2026-12-25', `Bruna (Maceió): só o estadual AL (${await fer(bruna.id)})`);

  // dia 08: Ana folga (feriado), Pedro tem jornada prevista
  const apA = await trat.apurarPeriodoCLT(t.id, ana.id, '2026-12-07', '2026-12-13', []);
  const apP = await trat.apurarPeriodoCLT(t.id, pedro.id, '2026-12-07', '2026-12-13', []);
  ok(!apA.diasPrevistos.includes('2026-12-08') && apP.diasPrevistos.includes('2026-12-08'), 'terça 08: previsto para Pedro, feriado para Ana');
  ok(apA.diasPrevistos.length === 3 && apP.diasPrevistos.length === 4, `dias previstos na semana: Ana 3, Pedro 4 (${apA.diasPrevistos.length}/${apP.diasPrevistos.length})`);

  // a lista do app (minha escala) também é a da pessoa
  ok((await trat.feriadosDoEmpregado(t.id, pedro.id, '2026-12-01', '2026-12-31')).every((f) => f.data !== '2026-12-08'), 'escala do app do Pedro não mostra o feriado de Salvador');

  // ── tela de Feriados: quem cada um atinge ──
  const r = await trat.regioesFeriados(t.id, '2026');
  const at = (d: string) => r.feriados.find((f) => f.data === d)!;
  ok(r.empresa?.municipioIbge === SSA.municipio && r.semCidadePropria.funcionarios === 1, 'cidade da empresa e quem não tem cidade própria');
  ok(at('2026-12-08').atinge === 1 && at('2026-12-09').atinge === 2 && at('2026-12-10').atinge === 1 && at('2026-12-25').atinge === 3, 'atinge: SSA 1, BA 2, AL 1, nacional 3');
  ok(at('2026-12-11').semRegiao && at('2026-12-11').atinge === 3, 'antigo sem região: marcado e atinge todos');
  ok(r.cidades.length === 3 && r.cidades.find((c) => c.municipio === SSA.municipio)!.funcionarios === 1, 'cidades em uso com quantas pessoas');

  // dar região ao antigo
  await trat.editarFeriado(t.id, antigo!.id, { tipo: 'municipal', ...MCZ });
  ok(await fer(ana.id) === '2026-12-08,2026-12-09,2026-12-25' && (await fer(bruna.id)).includes('2026-12-11'), 'antigo com região: sai da Ana, fica só na Bruna');

  // voltar para a cidade da empresa
  await trat.definirLocalPessoas(t.id, { empregadoIds: [pedro.id], municipio: null });
  ok(await fer(pedro.id) === await fer(ana.id), 'sem cidade própria de novo: igual à cidade da empresa');

  // ── prestadores (Folha e benefícios): dias do mês pela cidade de cada um ──
  const mSsa = await pes.criarPrestador(t.id, { tipo: 'MEI', nome: 'MEI Salvador', documento: null, valorMensal: 2600, baseDias: 'SEG_SAB', competenciaInicio: '2026-12' });
  const mLauro = await pes.criarPrestador(t.id, { tipo: 'MEI', nome: 'MEI Lauro', documento: null, valorMensal: 2600, baseDias: 'SEG_SAB', competenciaInicio: '2026-12' });
  await trat.definirLocalPessoas(t.id, { prestadorIds: [mLauro!.id], ...LAURO });
  const comp = await pes.competencia(t.id, '2026-12');
  const dS = comp.mei.find((m) => m.id === mSsa!.id)!.diasMes, dL = comp.mei.find((m) => m.id === mLauro!.id)!.diasMes;
  ok(dL === dS + 1, `MEI em Lauro tem 1 dia a mais no mês que o de Salvador (feriado municipal de SSA) (${dS}/${dL})`);

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK');
  await client.end();
  process.exit(falhas ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await client.end(); process.exit(1); });
