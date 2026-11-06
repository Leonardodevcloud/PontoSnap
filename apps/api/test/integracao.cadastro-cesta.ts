import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema, comoMaster, tenant, empregado, pontoRep, pontoHorarioContratual, pontoMarcacao, pontoEventoRep, pessoalCltConfig } from '@ponto/db';
import { and, eq } from 'drizzle-orm';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { PessoalService } from '../src/pessoal/pessoal.service';
import { EmpregadoService } from '../src/empregado/empregado.service';
import { CriptoService } from '../src/common/cripto.service';
import { diasDoMes, diaSemana } from '../src/pessoal/calculo';

/**
 * Cadastro do funcionário + cesta "recebe sim/não" (migration 0069), contra Postgres real:
 *  - cargo e chave Pix vêm do cadastro (empregado), não dos benefícios
 *  - salvar benefícios sem cargo/Pix não apaga o cadastro
 *  - atualizar cadastro: nome gera registro 5 (A) no AFD; matrícula repetida e admissão no futuro recusadas
 *  - criar funcionário já com cargo, admissão, cliente e Pix
 *  - padrão "não paga cesta" (valor 0) → ninguém do padrão recebe
 *  - pessoa "não recebe" → sem cesta mesmo com padrão pagando; voltar a receber mantém o mês escolhido
 *  - valor da cesta só para quem tem valor próprio (padrão é recusado), sem mexer em VR/VT
 */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const trat = new TratamentoService(db);
const pes = new PessoalService(db, trat, new CriptoService());
const emps = new EmpregadoService(db as never, { enviar: async () => {} } as never, { exigirVaga: async () => {} } as never);

let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };
const em = (data: string, hm: string) => new Date(`${data}T${hm}:00-0300`);
const erroDe = async (f: () => Promise<unknown>) => { try { await f(); return ''; } catch (e) { return (e as Error).message; } };

async function main() {
  const CNPJ = `45${String(Date.now()).slice(-12)}`;
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: CNPJ, razaoSocial: 'CADASTRO CESTA LTDA' }).returning()))[0]!;
  const rep = (await comoMaster(db, (tx) => tx.insert(pontoRep).values({
    tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: CNPJ, razaoSocial: 'CADASTRO CESTA LTDA',
    numeroInpi: 'BR512024004444-4', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188',
  }).returning()))[0]!;
  const hor = (await comoMaster(db, (tx) => tx.insert(pontoHorarioContratual).values({
    tenantId: t.id, codigo: 'ADM', durJornadaMin: 480, diasSemana: [1, 2, 3, 4, 5], regime: 'normal',
    pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }],
  }).returning()))[0]!;
  const novo = async (cpf: string, nome: string) => (await comoMaster(db, (tx) => tx.insert(empregado).values({
    tenantId: t.id, cpf, nome, horarioContratualId: hor.id, salarioMensal: '2000.00', dataAdmissao: '2025-01-10',
  }).returning()))[0]!;
  const ana = await novo('50000000001', 'Ana Propria');
  const beto = await novo('50000000002', 'Beto Padrao');

  // Setembro inteiro trabalhado (sem falta) para os dois: cesta depende só de carência e "recebe".
  let nsr = 1;
  const dias = diasDoMes('2026-09').filter((d) => { const w = diaSemana(d); return w >= 1 && w <= 5; }); // sem feriado cadastrado: 07/09 é dia normal
  for (const p of [ana, beto]) {
    const bs = dias.flatMap((d) => [em(d, '08:00'), em(d, '12:00'), em(d, '13:00'), em(d, '17:00')]);
    await comoMaster(db, (tx) => tx.insert(pontoMarcacao).values(bs.map((b) => ({
      tenantId: t.id, repId: rep.id, nsr: nsr, cpf: p.cpf, dtMarcacao: b, coletor: 1, hashRegistro: String(nsr++).padStart(64, '0'),
    }))));
  }
  const linha = async (id: string) => (await pes.competencia(t.id, '2026-09')).clt.find((c) => c.empregadoId === id)!;

  // ── cargo e Pix do cadastro ──
  await pes.salvarConfigClt(t.id, ana.id, { vrDia: 25, cestaMensal: 90, vtTipo: 'DIA', vtValor: 10, vigenteDesde: '2026-09' });
  await emps.atualizarCadastro(t.id, ana.id, { cargo: '  Supervisora ', chavePix: 'ana@empresa.com.br', cliente: 'Auto Norte', dataAdmissao: '2025-01-10' });
  let a = await linha(ana.id);
  ok(a.config.cargo === 'Supervisora' && a.config.chavePix === 'ana@empresa.com.br', `cargo e Pix vêm do cadastro (${a.config.cargo} / ${a.config.chavePix})`);
  ok(a.cliente === 'Auto Norte' && a.admissao === '2025-01-10', 'cliente e admissão do cadastro aparecem na folha');
  await pes.salvarConfigClt(t.id, ana.id, { vrDia: 26, cestaMensal: 90, vtTipo: 'DIA', vtValor: 10, vigenteDesde: '2026-10' });
  a = await linha(ana.id);
  ok(a.config.cargo === 'Supervisora' && a.config.chavePix === 'ana@empresa.com.br', 'salvar benefícios (sem cargo/Pix) não apaga o cadastro');
  await emps.atualizarCadastro(t.id, ana.id, { chavePix: '' });
  ok((await linha(ana.id)).config.chavePix === null, 'Pix vazio apaga');
  await emps.atualizarCadastro(t.id, ana.id, { chavePix: 'ana@empresa.com.br' });

  // ── nome e AFD ──
  const antes = (await comoMaster(db, (tx) => tx.select().from(pontoEventoRep).where(eq(pontoEventoRep.tenantId, t.id)))).length;
  await emps.atualizarCadastro(t.id, ana.id, { nome: 'Ana  Própria Souza', cargo: 'Supervisora' });
  const evs = await comoMaster(db, (tx) => tx.select().from(pontoEventoRep).where(eq(pontoEventoRep.tenantId, t.id)));
  const ult = evs[evs.length - 1] as Record<string, unknown> | undefined;
  ok(evs.length === antes + 1 && ult?.tipo === 5 && ult?.operacao === 'A', `trocar o nome grava registro 5 (A) no AFD (${evs.length - antes})`);
  await emps.atualizarCadastro(t.id, ana.id, { nome: 'Ana Própria Souza', cargo: 'Supervisora Sênior' });
  ok((await comoMaster(db, (tx) => tx.select().from(pontoEventoRep).where(eq(pontoEventoRep.tenantId, t.id)))).length === antes + 1, 'nome igual não gera outro registro no AFD');
  ok((await linha(ana.id)).nome === 'Ana Própria Souza', 'nome normalizado (espaços duplos)');
  await emps.atualizarCadastro(t.id, beto.id, { matricula: '014' });
  ok((await erroDe(() => emps.atualizarCadastro(t.id, ana.id, { matricula: '014' }))).includes('matrícula'), 'matrícula repetida é recusada');
  ok((await erroDe(() => emps.atualizarCadastro(t.id, ana.id, { dataAdmissao: '2099-01-01' }))).includes('futuro'), 'admissão no futuro é recusada');
  ok((await erroDe(() => emps.atualizarCadastro(t.id, ana.id, { nome: ' x ' }))).length > 0, 'nome curto é recusado');

  // ── criar já completo ──
  const cri = await emps.criar(t.id, { cpf: '50000000003', nome: 'Caio Novo', cargo: 'Motorista', dataAdmissao: '2026-08-01', cliente: 'Loja X', chavePix: '11999990000' }) as Record<string, unknown>;
  ok(cri.cargo === 'Motorista' && cri.dataAdmissao === '2026-08-01' && cri.cliente === 'Loja X' && cri.chavePix === '11999990000', 'criar funcionário grava cargo, admissão, cliente e Pix');
  ok((await erroDe(() => emps.criar(t.id, { cpf: '50000000004', nome: 'Dani', matricula: '014' }))).includes('matrícula'), 'criar com matrícula repetida é recusado');

  // ── padrão: "não paga cesta" = valor 0 ──
  await pes.salvarPadrao(t.id, { vrDia: 20, cestaMensal: 0, vtTipo: 'DIA', vtValor: 8, vigenteDesde: '2026-09' });
  let b = await linha(beto.id);
  ok(b.config.origem === 'PADRAO' && b.beneficios.cestaStatus === 'SEM_CESTA' && b.beneficios.cestaCent === 0, `padrão sem cesta: Beto não recebe (${b.beneficios.cestaStatus})`);
  ok(b.beneficios.cestaRecebe === true, 'Beto continua marcado "recebe" (é o padrão que não paga)');
  await pes.salvarPadrao(t.id, { vrDia: 20, cestaMensal: 150, vtTipo: 'DIA', vtValor: 8, vigenteDesde: '2026-09' });
  b = await linha(beto.id);
  ok(b.beneficios.cestaStatus === 'PAGA' && b.beneficios.cestaCent === 15000, `padrão paga R$ 150: Beto recebe (${b.beneficios.cestaCent})`);

  // ── pessoa "não recebe" ──
  await pes.definirCesta(t.id, beto.id, { recebe: true, cestaDesde: '2026-08' });
  await pes.definirCesta(t.id, beto.id, { recebe: false });
  b = await linha(beto.id);
  ok(b.beneficios.cestaRecebe === false && b.beneficios.cestaStatus === 'SEM_CESTA' && b.beneficios.cestaCent === 0, `Beto marcado "não recebe": sem cesta mesmo com padrão pagando (${b.beneficios.cestaStatus})`);
  ok(b.custoBrutoCent === (b.salarioCent ?? 0) + b.proventosCent - b.descontosCent + b.beneficios.vrProxCent + b.beneficios.vtProxCent, 'cesta fora do custo bruto');
  await pes.definirCesta(t.id, beto.id, { recebe: true, cestaDesde: '2026-08' });
  b = await linha(beto.id);
  ok(b.beneficios.cestaRecebe === true && b.beneficios.cestaDesde === '2026-08' && b.beneficios.cestaDesdeOrigem === 'MANUAL' && b.beneficios.cestaCent === 15000, 'voltar a receber: a partir de ago/2026, cesta paga');
  await pes.definirCesta(t.id, beto.id, { recebe: true, cestaDesde: null });
  b = await linha(beto.id);
  ok(b.beneficios.cestaDesdeOrigem === 'AUTO' && b.beneficios.cestaDesde === '2025-04', `sem mês = automático: 3 meses após a admissão (${b.beneficios.cestaDesde})`);
  await pes.definirCesta(t.id, beto.id, { recebe: true, cestaDesde: '2026-11' });
  b = await linha(beto.id);
  ok(b.beneficios.cestaStatus === 'CARENCIA' && b.beneficios.cestaCent === 0, `a partir de nov: setembro ainda sem cesta (${b.beneficios.cestaStatus})`);

  // ── valor da cesta: só valor próprio ──
  ok((await erroDe(() => pes.definirCesta(t.id, beto.id, { recebe: true, cestaMensal: 200, vigenteDesde: '2026-10' }))).includes('padrão'), 'valor da cesta para quem segue o padrão é recusado');
  await pes.definirCesta(t.id, ana.id, { recebe: true, cestaMensal: 120, vigenteDesde: '2026-10' });
  const cfgs = await comoMaster(db, (tx) => tx.select().from(pessoalCltConfig).where(and(eq(pessoalCltConfig.tenantId, t.id), eq(pessoalCltConfig.empregadoId, ana.id))));
  const out = cfgs.find((c) => c.vigenteDesde === '2026-10')!;
  ok(out.cestaMensal === '120.00' && out.vrDia === '26.00' && out.vtValor === '10.00' && !out.usaPadrao, `cesta própria R$ 120 a partir de out, VR/VT mantidos (${out.cestaMensal} / ${out.vrDia})`);
  ok(cfgs.find((c) => c.vigenteDesde === '2026-09')!.cestaMensal === '90.00', 'setembro continua com a cesta de R$ 90');
  a = await linha(ana.id);
  ok(a.beneficios.cestaCent === 9000 && a.config.cestaCent === 12000, `setembro paga R$ 90; a carga de outubro mostra R$ 120 (${a.beneficios.cestaCent} / ${a.config.cestaCent})`);
  await pes.definirCesta(t.id, ana.id, { recebe: true, cestaMensal: 130, vigenteDesde: '2026-11' });
  const nov = (await comoMaster(db, (tx) => tx.select().from(pessoalCltConfig).where(and(eq(pessoalCltConfig.tenantId, t.id), eq(pessoalCltConfig.empregadoId, ana.id), eq(pessoalCltConfig.vigenteDesde, '2026-11')))))[0]!;
  ok(nov.vrDia === '26.00' && nov.cestaMensal === '130.00', 'nova vigência copia a linha própria mais recente');

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
  await client.end();
  process.exit(falhas ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await client.end(); process.exit(1); });
