import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema, comoMaster, tenant, empregado, pontoRep, pontoMarcacao, pontoPerfilRegra } from '@ponto/db';
import { TratamentoService } from '../src/tratamento/tratamento.service';

/** A conta do mês por extenso tem que fechar e bater com o banco. */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const trat = new TratamentoService(db);
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };

async function main() {
  const CNPJ = `82${String(Date.now()).slice(-12)}`;
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: CNPJ, razaoSocial: 'Conta LTDA' }).returning()))[0]!;
  const rep = (await comoMaster(db, (tx) => tx.insert(pontoRep).values({
    tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: CNPJ, razaoSocial: 'Conta LTDA',
    numeroInpi: 'BR512024007777-7', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188',
  }).returning()))[0]!;
  const pares = [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }];
  const fixo = (await trat.criarHorario(t.id, { codigo: 'SEG-SAB', durJornadaMin: 480, pares, diasSemana: [1, 2, 3, 4, 5, 6] }))!;
  const sem = (await trat.criarHorario(t.id, { codigo: 'SEG-SAB SEM', durJornadaMin: 480, pares, diasSemana: [1, 2, 3, 4, 5, 6], compensaSemana: true }))!;
  const acumula = (await comoMaster(db, (tx) => tx.insert(pontoPerfilRegra).values({ tenantId: t.id, nome: 'Acumula', config: { banco: { bancoModo: 'ATIVO', formaCalculo: 'BANCO_HORAS', bancoTipoAcordo: 'INDIVIDUAL', bancoPrazoMeses: 6 } } }).returning()))[0]!;
  let nsr = 1, n = 0;
  const novo = async (nome: string, h: string, p: string | null) => {
    const e = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: `${CNPJ.slice(-9)}${String(++n).padStart(2, '0')}`, nome, horarioContratualId: h, perfilRegraId: p, dataInicioPonto: '2026-09-07' }).returning()))[0]!;
    // seg 9h (+1h) · ter 7h (−1h) · qua 8h05 (+5 tolerado) · qui 7h52 (−8: passa de 5 min por marcação, conta) · sex 8h30 (+30) · sáb sem batida
    const semana: [string, string[]][] = [
      ['2026-09-07', ['08:00', '12:00', '13:00', '18:00']], ['2026-09-08', ['08:00', '12:00', '13:00', '16:00']],
      ['2026-09-09', ['08:00', '12:00', '13:00', '17:05']], ['2026-09-10', ['08:00', '12:00', '13:00', '16:52']],
      ['2026-09-11', ['08:00', '12:00', '13:00', '17:30']],
    ];
    for (const [d, hs] of semana) for (const hh of hs) await comoMaster(db, (tx) => tx.insert(pontoMarcacao).values({
      tenantId: t.id, repId: rep.id, nsr: nsr++, cpf: e.cpf, dtMarcacao: new Date(`${d}T${hh}:00-03:00`), coletor: 1, hashRegistro: nsr.toString(16).padStart(64, '0'),
    }));
    return e;
  };
  const mat = await novo('Matheus Banco', fixo.id, acumula.id);
  const gab = await novo('Gabi Semana', sem.id, null);
  const gui = await novo('Gui Sem Nada', fixo.id, null);

  // ── banco acumulando, falta descontada na folha ──
  const a = await trat.apurarPeriodoCLT(t.id, mat.id, '2026-09-07', '2026-09-13', []);
  const c = a.conta;
  ok(c.previstoMin === 6 * 480 && c.falta.min === 480 && c.falta.dias[0] === '2026-09-12' && c.falta.destino === 'DESCONTA', 'previsto 48h; falta de sáb 12 (8h) à parte, descontada na folha');
  ok(c.previstoDiasVeioMin === 2400 && c.trabalhadoMin === 2427 && c.diferencaMin === 27, `nos dias que veio: 40h previsto, 40h27 trabalhado, +0h27 (${c.diferencaMin})`);
  ok(c.sobrouMin === 90 && c.faltouMin === 68 && c.abatidoMin === 68 && c.sobrouMin - c.faltouMin === c.resultadoMin, `sobrou 1h30 (os +5 de quarta foram tolerados), faltou 1h08, abatido 1h08 (${c.sobrouMin}/${c.faltouMin}/${c.abatidoMin})`);
  ok(c.sobrouMin === a.resultado.totalExtrasMin && c.faltouMin === a.resultado.totalAtrasoMin, `sobrou/faltou = extras/atrasos da tela (${a.resultado.totalExtrasMin}/${a.resultado.totalAtrasoMin})`);
  ok(c.ajusteMin === -5 && c.resultadoMin === 22, `tolerância −0h05 (os +5 de quarta) → resultado +0h22 (${c.ajusteMin}/${c.resultadoMin})`);
  ok(c.destino.tipo === 'BANCO' && c.destino.paraBancoMin === 22 && c.destino.atrasoFolhaMin === 0, `vai para o banco +0h22, nada de atraso na folha (${c.destino.paraBancoMin})`);
  ok(c.resultadoMin === c.diferencaMin + c.ajusteMin - c.semanaAbertaMin, 'a conta fecha: resultado = diferença + ajuste − semana aberta');
  ok(a.banco !== null && a.banco.saldoMesMin === c.destino.paraBancoMin, `bate com o banco (${a.banco?.saldoMesMin})`);
  ok(c.dias.find((d) => d.data === '2026-09-12')?.destino === 'FALTA' && c.dias.find((d) => d.data === '2026-09-09')?.destino === 'TOLERADO'
    && c.dias.find((d) => d.data === '2026-09-08')?.destino === 'BANCO', 'dia a dia: falta, tolerado, atraso abatido do banco');

  // ── compensa na semana, sem banco ──
  const g = (await trat.apurarPeriodoCLT(t.id, gab.id, '2026-09-07', '2026-09-13', [])).conta;
  ok(g.destino.tipo === 'FOLHA' && g.resultadoMin === g.diferencaMin + g.ajusteMin - g.semanaAbertaMin, 'semana: a conta fecha');
  ok(g.abatidoMin > 0, `semana: um dia abateu o outro dentro da semana (${g.abatidoMin})`);

  // ── sem banco, sem semana: nada abate ──
  const s = (await trat.apurarPeriodoCLT(t.id, gui.id, '2026-09-07', '2026-09-13', [])).conta;
  ok(s.abatidoMin === 0 && s.destino.extraPagaMin === 90 && s.destino.atrasoFolhaMin === 68, `sem banco: paga 1h30 e desconta 1h08 (${s.destino.extraPagaMin}/${s.destino.atrasoFolhaMin})`);

  console.log(falhas === 0 ? '\n>>> CONTA DO MÊS OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
