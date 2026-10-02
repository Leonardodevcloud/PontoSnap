import 'reflect-metadata';
process.env.APP_CRYPTO_KEY = Buffer.alloc(32, 9).toString('base64');
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, sql } from 'drizzle-orm';
import { schema, comoMaster, comTenant, tenant, empregado, usuario, pontoRep, pontoHorarioContratual, pontoMarcacao, pontoBancoFechamento, pontoAjuste } from '@ponto/db';
import { BancoService } from '../src/banco/banco.service';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { AjusteService } from '../src/ajuste/ajuste.service';

/**
 * Fechamento automático do banco de horas:
 *  - meses encerrados fecham sozinhos na consulta de saldo;
 *  - positivas e negativas somam (jornada curta sem janela é atraso, não falta);
 *  - saldo anterior + mês = acumulado aparece na apuração;
 *  - ajuste aprovado num mês fechado reabre e refaz;
 *  - pagamento e folga consomem o banco do jeito certo.
 */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const trat = new TratamentoService(db);
const banco = new BancoService(db, trat);
const ajustes = new AjusteService(db, { enviar: async () => true } as never, undefined as never);

let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };

async function main() {
  const CNPJ = `88${String(Date.now()).slice(-12)}`; // único por execução
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({
    cnpj: CNPJ, razaoSocial: 'Auto LTDA', bancoTipoAcordo: 'INDIVIDUAL', bancoPrazoMeses: 6,
  }).returning()))[0]!;
  const rep = (await comoMaster(db, (tx) => tx.insert(pontoRep).values({
    tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: CNPJ, razaoSocial: 'Auto LTDA',
    numeroInpi: 'BR512024008888-8', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188',
  }).returning()))[0]!;
  // Horário SEM janela (pares vazios): apura pelo total do dia — era aqui que
  // a jornada curta virava "falta" e sumia do banco.
  const hor = (await comoMaster(db, (tx) => tx.insert(pontoHorarioContratual).values({
    tenantId: t.id, codigo: 'SEM-JANELA', durJornadaMin: 480, pares: [], diasSemana: [1, 2, 3, 4, 5], regime: 'normal',
  }).returning()))[0]!;
  // Começa a bater em 13/07/2026 (segunda). Antes disso nada conta.
  const emp = (await comoMaster(db, (tx) => tx.insert(empregado).values({
    tenantId: t.id, cpf: CNPJ.slice(0, 11), nome: 'Carla', horarioContratualId: hor.id, dataInicioPonto: '2026-07-13',
  }).returning()))[0]!;
  await comoMaster(db, (tx) => tx.insert(usuario).values({ tenantId: t.id, email: `rh${CNPJ}@auto.com`, senhaHash: 'x', perfil: 'RH' }).returning());

  let nsr = 1;
  const bate = (isoUtc: string) => comoMaster(db, (tx) => tx.insert(pontoMarcacao).values({
    tenantId: t.id, repId: rep.id, nsr: nsr++, cpf: emp.cpf, dtMarcacao: new Date(isoUtc), coletor: 1,
    hashRegistro: nsr.toString(16).padStart(64, '0'),
  }).returning());
  // Dia completo (8h) pra todos os dias úteis de 13/07 a 31/07 e de 03/08 a 31/08,
  // exceto os dias "especiais" abaixo. Horário local -0300: 08:00 = 11:00Z.
  const diaCheio = async (d: string) => { await bate(`${d}T11:00:00Z`); await bate(`${d}T15:00:00Z`); await bate(`${d}T16:00:00Z`); await bate(`${d}T20:00:00Z`); };
  const especiais: Record<string, [string, string, string, string]> = {
    '2026-07-15': ['11:00', '15:00', '16:00', '22:00'], // +2h extra
    '2026-07-22': ['11:00', '15:00', '16:00', '19:00'], // -1h (jornada curta → atraso)
    '2026-08-05': ['11:00', '15:00', '16:00', '21:30'], // +1h30
    '2026-08-19': ['11:00', '15:00', '16:00', '18:00'], // -2h
  };
  const uteis = (ini: string, fim: string) => {
    const out: string[] = [];
    for (let d = new Date(`${ini}T12:00:00Z`); d.toISOString().slice(0, 10) <= fim; d.setUTCDate(d.getUTCDate() + 1)) {
      const dow = d.getUTCDay();
      if (dow >= 1 && dow <= 5) out.push(d.toISOString().slice(0, 10));
    }
    return out;
  };
  for (const d of [...uteis('2026-07-13', '2026-07-31'), ...uteis('2026-08-03', '2026-08-31')]) {
    const esp = especiais[d];
    if (esp) { for (const h of esp) await bate(`${d}T${h}:00Z`); }
    else await diaCheio(d);
  }
  // Setembro em andamento: 2 dias com +1h cada, até "hoje" = 10/09.
  for (const d of ['2026-09-01', '2026-09-02']) { await bate(`${d}T11:00:00Z`); await bate(`${d}T15:00:00Z`); await bate(`${d}T16:00:00Z`); await bate(`${d}T21:00:00Z`); }
  for (const d of uteis('2026-09-03', '2026-09-10')) await diaCheio(d);
  const HOJE = '2026-09-10';

  // ---------- 1. Motor: jornada curta sem janela é ATRASO, não falta ----------
  const apJul = await trat.apurarPeriodoCLT(t.id, emp.id, '2026-07-01', '2026-07-31', []);
  const d22 = apJul.resultado.dias.find((d) => d.data === '2026-07-22')!;
  ok(d22.atrasoMin === 60 && d22.faltaMin === 0 && d22.saldoMin === -60, `22/07 jornada curta: atraso 60, falta 0, saldo -60 (atraso=${d22.atrasoMin} falta=${d22.faltaMin} saldo=${d22.saldoMin})`);
  ok(apJul.resultado.saldoPeriodoMin === 60, `julho: +120 -60 = +60 no saldo do período (${apJul.resultado.saldoPeriodoMin})`);

  // ---------- 2. Saldo fecha os meses sozinho ----------
  const s1 = await banco.saldo(t.id, emp.id, HOJE);
  ok(s1.ativo && s1.fechamentos.map((f) => f.competencia).sort().join(',') === '2026-07,2026-08',
    `consultar o saldo fechou julho e agosto sozinho (${s1.fechamentos.map((f) => f.competencia).join(',')})`);
  ok(s1.fechamentos.every((f) => f.origem === 'AUTO'), 'fechamentos marcados como AUTO');
  // julho: +120 (15/07) -60 (22/07) = +60 · agosto: +90 (05/08) -120 (19/08) = -30 → oficial +30
  ok(s1.saldo!.saldoMin === 30, `positivas e negativas somaram entre os meses: +60 (jul) -30 (ago) = +30 (${s1.saldo!.saldoMin})`);
  ok(s1.saldo!.creditadoMin === 210 && s1.saldo!.compensadoMin === 180, `creditado 210 / debitado 180 (${s1.saldo!.creditadoMin}/${s1.saldo!.compensadoMin})`);
  ok(s1.mesCorrente?.competencia === '2026-09' && s1.mesCorrente.estimadoMin === 120, `setembro em andamento estimado em +120 (${s1.mesCorrente?.estimadoMin})`);
  ok(s1.saldoProjetadoMin === 150, `saldo projetado = oficial 30 + mês 120 = 150 (${s1.saldoProjetadoMin})`);

  // Consultar de novo não refaz nada (idempotente, barato).
  const antes = await comTenant(db, t.id, (tx) => tx.select().from(pontoBancoFechamento).where(eq(pontoBancoFechamento.empregadoId, emp.id)));
  await banco.saldo(t.id, emp.id, HOJE);
  const depois = await comTenant(db, t.id, (tx) => tx.select().from(pontoBancoFechamento).where(eq(pontoBancoFechamento.empregadoId, emp.id)));
  ok(antes.length === depois.length && antes.every((a) => depois.find((d) => d.id === a.id)?.fechadoEm.getTime() === a.fechadoEm.getTime()),
    'segunda consulta não refaz os fechamentos');

  // ---------- 3. Apuração mostra anterior + mês = acumulado ----------
  const apAgo = await trat.apurarPeriodoCLT(t.id, emp.id, '2026-08-01', '2026-08-31', []);
  ok(!!apAgo.banco && apAgo.banco.fechada, 'apuração de agosto sabe que o mês está fechado');
  ok(apAgo.banco!.saldoAnteriorMin === 60, `agosto: saldo anterior +60 (${apAgo.banco!.saldoAnteriorMin})`);
  ok(apAgo.banco!.saldoMesMin === -30, `agosto: mês -30 (${apAgo.banco!.saldoMesMin})`);
  ok(apAgo.banco!.saldoAcumuladoMin === 30, `agosto: acumulado +30 (${apAgo.banco!.saldoAcumuladoMin})`);
  ok(apAgo.banco!.desatualizado === false, 'agosto: fechamento bate com a apuração');
  const apSet = await trat.apurarPeriodoCLT(t.id, emp.id, '2026-09-01', '2026-09-30', []);
  ok(!!apSet.banco && !apSet.banco.fechada && apSet.banco.saldoAnteriorMin === 30 && apSet.banco.saldoMesMin === 120 && apSet.banco.saldoAcumuladoMin === 150,
    `setembro (em andamento): anterior 30 + mês 120 = 150 (${apSet.banco?.saldoAnteriorMin}+${apSet.banco?.saldoMesMin}=${apSet.banco?.saldoAcumuladoMin})`);

  // ---------- 4. Ajuste aprovado num mês fechado reabre e refaz ----------
  // RH inclui uma saída às 20:00 no dia 22/07... na verdade corrige: inclui
  // batida de 20:00 e desconsidera a de 19:00 → o dia fica cheio (atraso some).
  const marc19 = (await comoMaster(db, (tx) => tx.select().from(pontoMarcacao)
    .where(and(eq(pontoMarcacao.cpf, emp.cpf), eq(pontoMarcacao.dtMarcacao, new Date('2026-07-22T19:00:00Z'))))))[0]!;
  // (solicitar() barra competência antiga em relação à data real; aqui o
  // pedido entra direto como EM_ANALISE e o RH decide — é o mesmo caminho.)
  const pedidos = await comTenant(db, t.id, (tx) => tx.insert(pontoAjuste).values([
    { tenantId: t.id, empregadoId: emp.id, tipo: 'DESCONSIDERAR', data: '2026-07-22', dtMarcacao: null, tpMarc: null,
      marcacaoId: marc19.id, observacao: 'Correção: esqueceu de bater', origem: 'FUNCIONARIO', status: 'EM_ANALISE' },
    { tenantId: t.id, empregadoId: emp.id, tipo: 'INCLUSAO', data: '2026-07-22', dtMarcacao: new Date('2026-07-22T20:00:00Z'), tpMarc: 'S',
      marcacaoId: null, observacao: 'Correção: esqueceu de bater', origem: 'FUNCIONARIO', status: 'EM_ANALISE' },
  ]).returning());
  for (const p of pedidos) await ajustes.decidir(t.id, p.id, true, null, 'RH Teste');
  const reaberto = await comTenant(db, t.id, (tx) => tx.select().from(pontoBancoFechamento)
    .where(and(eq(pontoBancoFechamento.empregadoId, emp.id), eq(pontoBancoFechamento.competencia, '2026-07'))));
  ok(reaberto.length === 0, 'ajuste do RH em julho reabriu o fechamento de julho');
  const s2 = await banco.saldo(t.id, emp.id, HOJE);
  ok(s2.fechamentos.some((f) => f.competencia === '2026-07'), 'próxima consulta refez julho sozinha');
  ok(s2.saldo!.saldoMin === 90, `julho agora é +120 (sem o atraso): oficial 120 - 30 = +90 (${s2.saldo!.saldoMin})`);

  // ---------- 5. Folga consome FIFO; pagamento quita ----------
  await banco.registrarFolga(t.id, emp.id, '2026-09-11', 60);
  const s3 = await banco.saldo(t.id, emp.id, HOJE);
  ok(s3.saldo!.saldoMin === 30 && s3.saldo!.compensadoMin === 120 + 60, `folga de 1h debita: oficial +30, compensado 180 (${s3.saldo!.saldoMin})`);
  ok(s3.extrato[0]!.descricao === 'Folga compensatória' && s3.extrato[0]!.competencia == null, 'folga aparece no extrato como avulso (sem competência)');
  // A folga foi em setembro (mês em andamento, não fechado) → nada a reabrir.
  await banco.lancarMovimento(t.id, { empregadoId: emp.id, data: HOJE, minutos: -30, tipo: 'PAGAMENTO', descricao: 'Pago na folha' });
  const s4 = await banco.saldo(t.id, emp.id, HOJE);
  ok(s4.saldo!.saldoMin === 0 && s4.saldo!.pagoMin === 30, `pagamento zera o oficial (${s4.saldo!.saldoMin}, pago ${s4.saldo!.pagoMin})`);
  ok(s4.saldoProjetadoMin === 120, `projetado continua contando setembro: 0 + 120 (${s4.saldoProjetadoMin})`);

  // ---------- 6. Histórico da empresa e sincronização em lote ----------
  const hist = await banco.historicoCompetencias(t.id, HOJE);
  ok(hist.length === 2 && hist[0]!.competencia === '2026-08' && hist[0]!.automatico, `histórico: 2 meses, agosto primeiro, automático (${hist.map((h) => h.competencia).join(',')})`);
  const sinc = await banco.sincronizarTenant(t.id, HOJE);
  ok(sinc.funcionarios === 1 && sinc.fechadas === 0, `sincronizar a empresa sem pendências não faz nada (${sinc.fechadas})`);

  // Virou o mês: outubro chegou → setembro fecha sozinho.
  const s5 = await banco.saldo(t.id, emp.id, '2026-10-01');
  ok(s5.fechamentos.some((f) => f.competencia === '2026-09'), 'no dia 1 do mês seguinte, setembro fecha sozinho');
  ok(s5.saldo!.saldoMin === 120 && s5.mesCorrente?.estimadoMin === 0, `oficial absorveu setembro: +120, outubro zerado (${s5.saldo!.saldoMin}/${s5.mesCorrente?.estimadoMin})`);

  // ---------- 6b. Fechamento antigo com valor errado se reabre sozinho ----------
  // Simula um lançamento feito pelo motor antigo: altera um movimento de agosto na mão.
  await comTenant(db, t.id, (tx) => tx.execute(sql`UPDATE ponto_banco_mov SET minutos = minutos - 100 WHERE empregado_id = ${emp.id} AND competencia = '2026-08' AND minutos > 0`));
  const apAgoVelho = await trat.apurarPeriodoCLT(t.id, emp.id, '2026-08-01', '2026-08-31', []);
  ok(apAgoVelho.banco!.desatualizado === true && apAgoVelho.banco!.fechada === false && apAgoVelho.banco!.saldoMesMin === -30,
    `apuração detecta fechamento desatualizado, reabre e mostra o valor certo (${apAgoVelho.banco!.saldoMesMin})`);
  await banco.saldo(t.id, emp.id, '2026-10-01');
  const apAgoNovo = await trat.apurarPeriodoCLT(t.id, emp.id, '2026-08-01', '2026-08-31', []);
  ok(apAgoNovo.banco!.fechada && !apAgoNovo.banco!.desatualizado, 'próxima consulta refez agosto e ele volta a estar fechado e em dia');

  // ---------- 7. Visão de todos (tela do RH) ----------
  const res = await banco.resumoFuncionarios(t.id, '2026-10-01');
  const lc = res.linhas.find((l) => l.empregadoId === emp.id);
  ok(res.totais.funcionarios === 1 && res.totais.comBanco === 1, `resumo lista 1 funcionário com banco (${res.totais.funcionarios}/${res.totais.comBanco})`);
  ok(!!lc && lc.ativo && lc.saldoMin === 120 && lc.projetadoMin === 120 && lc.ultimoFechamento === '2026-09',
    `resumo: Carla fechado +120, projetado +120, último fechamento 2026-09`);

  console.log(falhas === 0 ? '\n>>> BANCO AUTOMÁTICO OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
