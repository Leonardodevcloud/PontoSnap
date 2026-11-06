import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import {
  schema, comoMaster, tenant, empregado, pontoRep, pontoHorarioContratual, pontoMarcacao, pontoPerfilRegra, pontoCct, pontoAfastamento,
  pontoEventoRep, usuario, usuarioTenant, empregadoSalario, pessoalCltConfig, pessoalCltCesta, pessoalDebito, pessoalFechamento,
  pessoalPrestador, pessoalPrestadorValor, pessoalLancamento, pessoalExclusao, pessoalNota, prestadorConvite, notificacaoPreferencia,
} from '@ponto/db';
import { and, eq } from 'drizzle-orm';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { BancoService } from '../src/banco/banco.service';
import { PessoalService } from '../src/pessoal/pessoal.service';
import { CriptoService } from '../src/common/cripto.service';
import { TransferenciaService } from '../src/transferencia/transferencia.service';
import { diasDoMes, diaSemana } from '../src/pessoal/calculo';

/**
 * Transferência entre CNPJs contra Postgres real:
 *  CLT no dia 1: cadastro, CCT, perfil, escala, salário, benefícios, cesta, débitos em aberto
 *    (quitados não), férias agendadas, foto/preferências, login, AFD (E na origem, I no destino),
 *    matrícula repetida no destino; origem mantém o último mês (folha e relatório), destino começa no seguinte.
 *  CLT no meio do mês: a origem fica com o ponto até a véspera, sem carga seguinte, cesta e débitos;
 *    o destino fica com eles.
 *  Mês fechado bloqueia.
 *  MEI: valores, débitos, lançamentos sem nota, login do portal (prestador_id), convite pendente;
 *    não deixa transferir de novo; nota liberada na origem bloqueia.
 */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const trat = new TratamentoService(db);
const pes = new PessoalService(db, trat, new CriptoService());
const svc = new TransferenciaService(db as never, { exigirVaga: async () => {} } as never, new BancoService(db as never, trat));

let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };
const em = (data: string, hm: string) => new Date(`${data}T${hm}:00-0300`);
const erroDe = async (f: () => Promise<unknown>) => { try { await f(); return ''; } catch (e) { return (e as Error).message; } };
type TxM = Parameters<Parameters<typeof comoMaster>[1]>[0];
const M = <T>(f: (tx: TxM) => Promise<T>) => comoMaster(db, f);

async function main() {
  const sufixo = String(Date.now()).slice(-10);
  const mk = async (cnpj: string, nome: string) => {
    const t = (await M((tx) => tx.insert(tenant).values({ cnpj, razaoSocial: nome }).returning()))[0]!;
    const rep = (await M((tx) => tx.insert(pontoRep).values({ tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: cnpj, razaoSocial: nome,
      numeroInpi: 'BR512024004444-4', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188' }).returning()))[0]!;
    return { t, rep };
  };
  const A = await mk(`61${sufixo}01`, 'ORIGEM LTDA');
  const B = await mk(`62${sufixo}02`, 'DESTINO LTDA');
  const adm = (await M((tx) => tx.insert(usuario).values({ email: `adm${sufixo}@x.com`, senhaHash: 'x', perfil: 'ADMIN_CLIENTE', tenantId: A.t.id }).returning()))[0]!;
  await M((tx) => tx.insert(usuarioTenant).values([{ usuarioId: adm.id, tenantId: A.t.id, perfil: 'ADMIN_CLIENTE' }, { usuarioId: adm.id, tenantId: B.t.id, perfil: 'ADMIN_CLIENTE' }]));

  const hor = (await M((tx) => tx.insert(pontoHorarioContratual).values({ tenantId: A.t.id, codigo: 'ADM', durJornadaMin: 480, diasSemana: [1, 2, 3, 4, 5], regime: 'normal',
    pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }] }).returning()))[0]!;
  const perfil = (await M((tx) => tx.insert(pontoPerfilRegra).values({ tenantId: A.t.id, nome: 'Logística' } as never).returning()))[0]! as { id: string };
  const cct = (await M((tx) => tx.insert(pontoCct).values({ tenantId: A.t.id, nome: 'CCT Motociclistas BA' } as never).returning()))[0]! as { id: string };
  let nsr = 1;
  const bater = async (rep: { id: string }, tId: string, cpf: string, dias: string[]) => {
    const bs = dias.flatMap((d) => [em(d, '08:00'), em(d, '12:00'), em(d, '13:00'), em(d, '17:00')]);
    await M((tx) => tx.insert(pontoMarcacao).values(bs.map((b) => ({ tenantId: tId, repId: rep.id, nsr: nsr, cpf, dtMarcacao: b, coletor: 1, hashRegistro: String(nsr++).padStart(64, '0') }))));
  };
  const uteis = (comp: string) => diasDoMes(comp).filter((d) => { const w = diaSemana(d); return w >= 1 && w <= 5; });

  // ───── CLT, transferência no dia 1 ─────
  const ana = (await M((tx) => tx.insert(empregado).values({ tenantId: A.t.id, cpf: `7${sufixo}`, nome: 'Ana Transferida', matricula: '001',
    horarioContratualId: hor.id, perfilRegraId: perfil.id, cctId: cct.id, salarioMensal: '2200.00', dataInicioPonto: '2026-08-01', dataAdmissao: '2025-03-10',
    cargo: 'Supervisora', chavePix: 'ana@x.com', cliente: 'Auto Norte' }).returning()))[0]!;
  await M((tx) => tx.insert(empregado).values({ tenantId: B.t.id, cpf: `8${sufixo}`, nome: 'Outro do Destino', matricula: '001' }));
  await M((tx) => tx.insert(empregadoSalario).values({ tenantId: A.t.id, empregadoId: ana.id, vigenteDesde: '2000-01-01', salarioMensal: '2200.00' }));
  await M((tx) => tx.insert(pessoalCltConfig).values({ tenantId: A.t.id, empregadoId: ana.id, vigenteDesde: '2026-08', vrDia: '25.00', cestaMensal: '120.00', vtTipo: 'DIA', vtValor: '10.00', vtSemDias: '5' }));
  await M((tx) => tx.insert(pessoalCltCesta).values({ tenantId: A.t.id, empregadoId: ana.id, recebe: true, cestaDesde: '2025-06' }));
  await M((tx) => tx.insert(pessoalDebito).values([
    { tenantId: A.t.id, pessoaTipo: 'CLT', pessoaId: ana.id, descricao: 'Quitado', valorTotal: '200.00', parcelas: 2, competenciaInicio: '2026-06' },
    { tenantId: A.t.id, pessoaTipo: 'CLT', pessoaId: ana.id, descricao: 'Adiantamento', valorTotal: '300.00', parcelas: 3, competenciaInicio: '2026-10' },
    { tenantId: A.t.id, pessoaTipo: 'CLT', pessoaId: ana.id, descricao: 'Fixo encerrado', valorTotal: '50.00', parcelas: 1, tipo: 'FIXO', competenciaInicio: '2026-07', competenciaFim: '2026-09' },
  ]));
  await M((tx) => tx.insert(pontoAfastamento).values([
    { tenantId: A.t.id, empregadoId: ana.id, tipo: 'FERIAS', dataInicio: '2026-08-10', dataFim: '2026-08-14' },
    { tenantId: A.t.id, empregadoId: ana.id, tipo: 'FERIAS', dataInicio: '2026-11-23', dataFim: '2026-12-05' },
  ]));
  await M((tx) => tx.insert(notificacaoPreferencia).values({ tenantId: A.t.id, empregadoId: ana.id, resumoSemanal: true } as never));
  const login = (await M((tx) => tx.insert(usuario).values({ email: `ana${sufixo}@x.com`, senhaHash: 'x', perfil: 'COLABORADOR', tenantId: A.t.id, empregadoId: ana.id }).returning()))[0]!;
  await bater(A.rep, A.t.id, ana.cpf, uteis('2026-10'));

  const r1 = await svc.transferirClt(A.t.id, adm.id, ana.id, { destinoTenantId: B.t.id, data: '2026-11-01', preservarAdmissao: true, motivo: 'TRANSFERENCIA' });
  const nova = (await M((tx) => tx.select().from(empregado).where(eq(empregado.id, r1.novoEmpregadoId))))[0]!;
  ok(nova.tenantId === B.t.id && nova.cargo === 'Supervisora' && nova.chavePix === 'ana@x.com' && nova.cliente === 'Auto Norte' && nova.dataAdmissao === '2025-03-10' && nova.dataInicioPonto === '2026-11-01',
    'cadastro no destino: cargo, Pix, cliente, admissão mantida, início do ponto na data');
  ok(nova.matricula === null && r1.avisos.some((a) => a.includes('matrícula')), 'matrícula repetida no destino: entra sem e avisa');
  ok(!!nova.cctId && nova.cctId !== cct.id && !!nova.perfilRegraId && nova.perfilRegraId !== perfil.id && !!nova.horarioContratualId && nova.horarioContratualId !== hor.id,
    'CCT, perfil e horário recriados no destino');
  const cfgB = await M((tx) => tx.select().from(pessoalCltConfig).where(eq(pessoalCltConfig.empregadoId, nova.id)));
  ok(cfgB.length === 1 && cfgB[0]!.vrDia === '25.00' && cfgB[0]!.vtSemDias === '5', 'benefícios (com home office) seguem');
  ok((await M((tx) => tx.select().from(empregadoSalario).where(eq(empregadoSalario.empregadoId, nova.id)))).length === 1, 'salário (vigências) segue');
  const cestaB = (await M((tx) => tx.select().from(pessoalCltCesta).where(eq(pessoalCltCesta.empregadoId, nova.id))))[0];
  ok(cestaB?.cestaDesde === '2025-06' && cestaB.recebe, 'cesta: mês da carência segue com a admissão mantida');
  const debB = await M((tx) => tx.select().from(pessoalDebito).where(eq(pessoalDebito.pessoaId, nova.id)));
  ok(debB.length === 1 && debB[0]!.descricao === 'Adiantamento' && r1.debitosLevados === 1, `só o débito em aberto vai (${debB.map((d) => d.descricao).join()})`);
  const afB = await M((tx) => tx.select().from(pontoAfastamento).where(eq(pontoAfastamento.empregadoId, nova.id)));
  ok(afB.length === 1 && afB[0]!.dataInicio === '2026-11-23', 'só as férias agendadas a partir da data vão');
  ok((await M((tx) => tx.select().from(notificacaoPreferencia).where(eq(notificacaoPreferencia.empregadoId, nova.id))))[0]?.resumoSemanal === true, 'preferências de notificação seguem');
  const loginDepois = (await M((tx) => tx.select().from(usuario).where(eq(usuario.id, login.id))))[0]!;
  ok(loginDepois.tenantId === B.t.id && loginDepois.empregadoId === nova.id, 'login do app aponta para o destino');
  const afdA = await M((tx) => tx.select().from(pontoEventoRep).where(and(eq(pontoEventoRep.tenantId, A.t.id), eq(pontoEventoRep.tipo, 5))));
  const afdB = await M((tx) => tx.select().from(pontoEventoRep).where(and(eq(pontoEventoRep.tenantId, B.t.id), eq(pontoEventoRep.tipo, 5))));
  ok(afdA.some((x) => (x as { operacao: string }).operacao === 'E') && afdB.some((x) => (x as { operacao: string }).operacao === 'I'), 'AFD: registro 5 E na origem e I no destino');
  const velha = (await M((tx) => tx.select().from(empregado).where(eq(empregado.id, ana.id))))[0]!;
  ok(!velha.ativo && velha.dataSaida === '2026-11-01' && velha.motivoSaida === 'TRANSFERENCIA', 'origem: inativa, com data e motivo de saída');

  const outA = await pes.competencia(A.t.id, '2026-10');
  const aOut = outA.clt.find((c) => c.empregadoId === ana.id);
  ok(!!aOut && !aOut.saida && aOut.beneficios.diasProx > 0 && aOut.debitosCent === 10000, `origem: outubro continua com ela, carga de novembro e débito de outubro (${aOut?.beneficios.diasProx} dias, ${aOut?.debitosCent})`);
  ok(!(await pes.competencia(A.t.id, '2026-11')).clt.some((c) => c.empregadoId === ana.id), 'origem: novembro já não tem ela');
  const novB = (await pes.competencia(B.t.id, '2026-11')).clt.find((c) => c.empregadoId === nova.id);
  ok(!!novB && novB.debitosCent === 10000 && novB.config.cargo === 'Supervisora', `destino: novembro com ela e a parcela 2 do débito (${novB?.debitosCent})`);
  const rel = await trat.relatorioCompetencia(A.t.id, '2026-10-01', '2026-10-31', '2026-11-06') as { linhas: { empregadoId?: string; id?: string }[] };
  ok(JSON.stringify(rel).includes(ana.id), 'origem: relatório (espelhos) de outubro ainda tem ela');

  // ───── CLT, transferência no meio do mês ─────
  const beto = (await M((tx) => tx.insert(empregado).values({ tenantId: A.t.id, cpf: `9${sufixo}`, nome: 'Beto Meio do Mês', horarioContratualId: hor.id,
    salarioMensal: '2000.00', dataInicioPonto: '2026-08-01', dataAdmissao: '2024-01-01' }).returning()))[0]!;
  await M((tx) => tx.insert(pessoalCltConfig).values({ tenantId: A.t.id, empregadoId: beto.id, vigenteDesde: '2026-08', vrDia: '25.00', cestaMensal: '100.00', vtTipo: 'DIA', vtValor: '10.00' }));
  await M((tx) => tx.insert(pessoalDebito).values({ tenantId: A.t.id, pessoaTipo: 'CLT', pessoaId: beto.id, descricao: 'Multa', valorTotal: '90.00', parcelas: 3, competenciaInicio: '2026-09' }));
  await bater(A.rep, A.t.id, beto.cpf, uteis('2026-10').filter((d) => d < '2026-10-16'));
  const r2 = await svc.transferirClt(A.t.id, adm.id, beto.id, { destinoTenantId: B.t.id, data: '2026-10-16', preservarAdmissao: true, motivo: 'TRANSFERENCIA' });
  ok(r2.avisos.some((a) => a.includes('dividido')), 'avisa que o mês fica dividido');
  const bA = (await pes.competencia(A.t.id, '2026-10')).clt.find((c) => c.empregadoId === beto.id)!;
  ok(!!bA && bA.saida?.ultimoDia === '2026-10-15', `origem: outubro até 15/10 (${bA?.saida?.ultimoDia})`);
  ok(bA.faltasDias.length === 0, `origem: sem faltas depois da saída (${bA.faltasDias.join()})`);
  ok(bA.beneficios.diasProx === 0 && bA.beneficios.cargaCent === 0 && bA.beneficios.cestaCent === 0 && bA.debitosCent === 0,
    'origem: sem carga de novembro, cesta e débito no mês da saída (ficam com o destino)');
  ok(!(await pes.competencia(A.t.id, '2026-10')).debitos.some((d) => d.pessoaId === beto.id), 'origem: débito dele não aparece em outubro');
  const bB = (await pes.competencia(B.t.id, '2026-10')).clt.find((c) => c.empregadoId === r2.novoEmpregadoId)!;
  ok(!!bB && bB.debitosCent === 3000 && bB.beneficios.diasProx > 0, `destino: outubro com a parcela do débito e a carga de novembro (${bB?.debitosCent})`);

  // ───── mês fechado bloqueia ─────
  const caio = (await M((tx) => tx.insert(empregado).values({ tenantId: A.t.id, cpf: `6${sufixo}`, nome: 'Caio', horarioContratualId: hor.id, dataInicioPonto: '2026-01-01' }).returning()))[0]!;
  await M((tx) => tx.insert(pessoalFechamento).values({ tenantId: B.t.id, competencia: '2026-09', snapshot: {} } as never));
  ok((await erroDe(() => svc.transferirClt(A.t.id, adm.id, caio.id, { destinoTenantId: B.t.id, data: '2026-09-15', preservarAdmissao: true, motivo: 'TRANSFERENCIA' }))).includes('fechado'),
    'mês fechado no destino bloqueia');
  ok((await M((tx) => tx.select().from(empregado).where(eq(empregado.id, caio.id))))[0]!.ativo, 'bloqueada, nada muda (continua ativo na origem)');

  // ───── MEI ─────
  const mei = (await M((tx) => tx.insert(pessoalPrestador).values({ tenantId: A.t.id, tipo: 'MEI', nome: 'Duda MEI', documento: `1${sufixo}0001`, valorMensal: '3000.00', competenciaInicio: '2026-06', chavePix: 'duda@x.com' }).returning()))[0]!;
  await M((tx) => tx.insert(pessoalPrestadorValor).values([{ tenantId: A.t.id, prestadorId: mei.id, vigenteDesde: '2026-06', valorMensal: '2800.00' }, { tenantId: A.t.id, prestadorId: mei.id, vigenteDesde: '2026-09', valorMensal: '3000.00' }]));
  await M((tx) => tx.insert(pessoalDebito).values({ tenantId: A.t.id, pessoaTipo: 'MEI', pessoaId: mei.id, descricao: 'Celular', valorTotal: '400.00', parcelas: 4, competenciaInicio: '2026-09' }));
  await M((tx) => tx.insert(pessoalLancamento).values([
    { tenantId: A.t.id, pessoaTipo: 'MEI', pessoaId: mei.id, competencia: '2026-10', heMin: 30, pago: true },
    { tenantId: A.t.id, pessoaTipo: 'MEI', pessoaId: mei.id, competencia: '2026-11', heMin: 120 },
  ]));
  const loginMei = (await M((tx) => tx.insert(usuario).values({ email: `duda${sufixo}@x.com`, senhaHash: 'x', perfil: 'PRESTADOR', tenantId: A.t.id, prestadorId: mei.id }).returning()))[0]!;
  await M((tx) => tx.insert(prestadorConvite).values({ tenantId: A.t.id, prestadorId: mei.id, codigo: `C${sufixo}`.slice(0, 16), expiraEm: new Date(Date.now() + 86400_000) }));

  const r3 = await svc.transferirPrestador(A.t.id, adm.id, mei.id, { destinoTenantId: B.t.id, competencia: '2026-11' });
  const pB = (await M((tx) => tx.select().from(pessoalPrestador).where(eq(pessoalPrestador.id, r3.novoPrestadorId))))[0]!;
  ok(pB.tenantId === B.t.id && pB.competenciaInicio === '2026-11' && pB.chavePix === 'duda@x.com' && pB.prestadorAnteriorId === mei.id, 'MEI no destino a partir de novembro');
  ok((await M((tx) => tx.select().from(pessoalPrestadorValor).where(eq(pessoalPrestadorValor.prestadorId, pB.id)))).length === 2, 'valores (vigências) seguem');
  ok((await M((tx) => tx.select().from(pessoalDebito).where(eq(pessoalDebito.pessoaId, pB.id)))).length === 1, 'débito em aberto segue');
  const lB = await M((tx) => tx.select().from(pessoalLancamento).where(eq(pessoalLancamento.pessoaId, pB.id)));
  const lA = await M((tx) => tx.select().from(pessoalLancamento).where(eq(pessoalLancamento.pessoaId, mei.id)));
  ok(lB.length === 1 && lB[0]!.competencia === '2026-11' && lB[0]!.heMin === 120 && lA.length === 1 && lA[0]!.competencia === '2026-10', 'lançamento de novembro vai; outubro (pago) fica na origem');
  const lm = (await M((tx) => tx.select().from(usuario).where(eq(usuario.id, loginMei.id))))[0]!;
  ok(lm.tenantId === B.t.id && lm.prestadorId === pB.id, 'login do portal (prestador_id) aponta para o destino');
  const conv = (await M((tx) => tx.select().from(prestadorConvite).where(eq(prestadorConvite.prestadorId, pB.id))))[0];
  ok(!!conv && conv.tenantId === B.t.id, 'convite de primeiro acesso pendente passa ao destino');
  ok((await M((tx) => tx.select().from(pessoalExclusao).where(and(eq(pessoalExclusao.pessoaId, mei.id), eq(pessoalExclusao.escopo, 'DIANTE'))))).length === 1, 'origem: sai da folha a partir de novembro');
  const novA = await pes.competencia(A.t.id, '2026-11');
  const novBp = await pes.competencia(B.t.id, '2026-11');
  ok(!novA.mei.some((m) => m.id === mei.id) && novBp.mei.some((m) => m.id === pB.id), 'novembro: some da origem, aparece no destino');
  ok((await erroDe(() => svc.transferirPrestador(A.t.id, adm.id, mei.id, { destinoTenantId: B.t.id, competencia: '2026-12' }))).includes('já saiu'), 'não transfere de novo');

  // nota liberada na origem bloqueia
  const eva = (await M((tx) => tx.insert(pessoalPrestador).values({ tenantId: A.t.id, tipo: 'MOTORISTA', nome: 'Eva Motorista', documento: `2${sufixo}`, valorMensal: '2000.00', competenciaInicio: '2026-06' }).returning()))[0]!;
  await M((tx) => tx.insert(pessoalNota).values({ tenantId: A.t.id, pessoaTipo: 'MOTORISTA', pessoaId: eva.id, competencia: '2026-11', periodo: '2026-11-02', valorCent: 50000 } as never));
  ok((await erroDe(() => svc.transferirPrestador(A.t.id, adm.id, eva.id, { destinoTenantId: B.t.id, competencia: '2026-11' }))).includes('nota'), 'nota já liberada na origem bloqueia');
  const ok2 = await svc.transferirPrestador(A.t.id, adm.id, eva.id, { destinoTenantId: B.t.id, competencia: '2026-12' });
  ok(!!ok2.novoPrestadorId, 'a partir do mês seguinte, vai');

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\n>>> TRANSFERENCIA OK <<<');
  await client.end();
  process.exit(falhas ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await client.end(); process.exit(1); });
