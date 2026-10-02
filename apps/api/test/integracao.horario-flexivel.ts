import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { schema, comoMaster, comTenant, tenant, empregado, pontoRep, pontoMarcacao, pontoBancoFechamento } from '@ponto/db';
import { BancoService } from '../src/banco/banco.service';
import { TratamentoService } from '../src/tratamento/tratamento.service';

/**
 * Contrato de horas (escala flexível): só a carga do dia conta. Quem entra
 * mais tarde e sai mais tarde cumpriu a jornada — sem atraso, sem extra.
 * Ligar a flag refaz o passado (reabre o banco de quem usa a escala).
 */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const trat = new TratamentoService(db);
const banco = new BancoService(db, trat);
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };

async function main() {
  const CNPJ = `77${String(Date.now()).slice(-12)}`;
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: CNPJ, razaoSocial: 'Flex LTDA', bancoTipoAcordo: 'INDIVIDUAL', bancoPrazoMeses: 6 }).returning()))[0]!;
  const rep = (await comoMaster(db, (tx) => tx.insert(pontoRep).values({
    tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: CNPJ, razaoSocial: 'Flex LTDA',
    numeroInpi: 'BR512024007777-7', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188',
  }).returning()))[0]!;
  const hor = (await trat.criarHorario(t.id, { codigo: 'COMERCIAL', durJornadaMin: 480, pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }] }))!;
  const emp = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: CNPJ.slice(0, 11), nome: 'Flávia', horarioContratualId: hor.id, dataInicioPonto: '2026-07-13' }).returning()))[0]!;

  let nsr = 1;
  const bate = (iso: string) => comoMaster(db, (tx) => tx.insert(pontoMarcacao).values({
    tenantId: t.id, repId: rep.id, nsr: nsr++, cpf: emp.cpf, dtMarcacao: new Date(iso), coletor: 1, hashRegistro: nsr.toString(16).padStart(64, '0'),
  }).returning());
  // 13/07 (seg): chegou ao meio-dia e saiu às 21h — 12:00–16:00 e 17:00–21:00 = 8h (local -0300).
  for (const h of ['12:00', '16:00', '17:00', '21:00']) await bate(`2026-07-13T${h}:00-03:00`);
  // 14/07 (ter): 12:00–16:00 e 17:00–22:00 = 9h → 1h a mais.
  for (const h of ['12:00', '16:00', '17:00', '22:00']) await bate(`2026-07-14T${h}:00-03:00`);

  // ---------- Escala FIXA (como está hoje) ----------
  const apFixo = await trat.apurarPeriodoCLT(t.id, emp.id, '2026-07-13', '2026-07-14', []);
  ok(apFixo.horarioFlexivel === false, 'escala começa como fixa (apura pela janela de horário)');

  // Fecha julho no banco com a regra antiga.
  await banco.saldo(t.id, emp.id, '2026-08-05');
  const fechAntes = await comTenant(db, t.id, (tx) => tx.select().from(pontoBancoFechamento).where(eq(pontoBancoFechamento.empregadoId, emp.id)));
  ok(fechAntes.length === 1, `julho fechado no banco com a regra fixa (${fechAntes.length})`);

  // ---------- Liga o contrato de horas ----------
  const r = await trat.atualizarHorario(t.id, hor.id, { flexivel: true });
  ok((r as { funcionariosRecalculados?: number }).funcionariosRecalculados === 1, 'salvar a escala avisa quantos funcionários serão recalculados (1)');
  const fechDepois = await comTenant(db, t.id, (tx) => tx.select().from(pontoBancoFechamento).where(eq(pontoBancoFechamento.empregadoId, emp.id)));
  ok(fechDepois.length === 0, 'ligar o flexível reabre o banco (fechamento removido)');

  const apFlex = await trat.apurarPeriodoCLT(t.id, emp.id, '2026-07-13', '2026-07-14', []);
  const d13 = apFlex.resultado.dias.find((d) => d.data === '2026-07-13')!;
  const d14 = apFlex.resultado.dias.find((d) => d.data === '2026-07-14')!;
  ok(d13.minutosTrabalhados === 480 && d13.atrasoMin === 0 && d13.extrasTotalMin === 0 && d13.saldoMin === 0,
    `flexível 13/07: 8h fora do horário = jornada cumprida, sem atraso nem extra (trab=${d13.minutosTrabalhados} atraso=${d13.atrasoMin} extra=${d13.extrasTotalMin})`);
  // Com banco ativo, a hora acima da carga é CRÉDITO de jornada: vai pro banco, não é extra.
  ok(d14.minutosTrabalhados === 540 && d14.saldoMin === 60 && d14.extrasTotalMin === 0 && d14.atrasoMin === 0,
    `flexível+banco 14/07: 9h = +1h de crédito, sem extra e sem atraso (trab=${d14.minutosTrabalhados} saldo=${d14.saldoMin} extra=${d14.extrasTotalMin})`);
  ok(apFlex.resultado.totalExtrasMin === 0 && apFlex.resultado.saldoPeriodoMin === 60, `período: extras 0, saldo +60 (${apFlex.resultado.totalExtrasMin}/${apFlex.resultado.saldoPeriodoMin})`);
  ok(apFlex.horarioFlexivel === true, 'apuração informa que a escala é flexível');

  // Banco refeito sozinho na próxima consulta, já com a regra nova.
  const s = await banco.saldo(t.id, emp.id, '2026-08-05');
  ok(s.fechamentos.length === 1 && s.saldo!.saldoMin === 60, `banco refeito: julho = só a 1h extra de 14/07 (${s.saldo!.saldoMin})`);

  // Sem banco (hora extra paga na folha), a hora acima da carga volta a ser extra.
  await banco.definirConfig(t.id, { tipoAcordo: 'NENHUM' });
  const apSemBanco = await trat.apurarPeriodoCLT(t.id, emp.id, '2026-07-14', '2026-07-14', []);
  const d14sb = apSemBanco.resultado.dias[0]!;
  ok(d14sb.extrasTotalMin === 60 && d14sb.extras[0]?.adicionalPct === 50, `flexível SEM banco: 9h = 1h extra a 50% (extra=${d14sb.extrasTotalMin})`);
  await banco.definirConfig(t.id, { tipoAcordo: 'INDIVIDUAL', prazoMeses: 6 });

  // Espelho mostra a carga, não um horário.
  const esp = await trat.conteudoEspelho(t.id, emp.id, '2026-07-13', '2026-07-14');
  ok(esp.linhas[0]!.jornadaEsperada.includes('livre'), `espelho: jornada esperada "${esp.linhas[0]!.jornadaEsperada}"`);

  console.log(falhas === 0 ? '\n>>> HORÁRIO FLEXÍVEL OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
