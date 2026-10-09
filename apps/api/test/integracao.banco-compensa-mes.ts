import 'reflect-metadata';
process.env.APP_CRYPTO_KEY = Buffer.alloc(32, 9).toString('base64');
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { schema, comoMaster, comTenant, tenant, empregado, pontoRep, pontoHorarioContratual, pontoMarcacao, pontoPerfilRegra, pontoBancoFechamento } from '@ponto/db';
import { BancoService } from '../src/banco/banco.service';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { DESC_ABERTURA } from '../src/banco/acerto-mes';

/**
 * Banco "compensa no mês e paga a diferença":
 *  - sobra positiva do mês é paga (PAGAMENTO no fechamento) e vira R$ na apuração;
 *  - mês devendo: DESCONTA zera com desconto em R$; CARREGA passa pro mês seguinte;
 *  - lançamento avulso num mês fechado reabre e refaz (e os meses seguintes, no CARREGA);
 *  - baixa em lote do saldo de abertura (na data da abertura) não vira desconto.
 */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const trat = new TratamentoService(db);
const banco = new BancoService(db, trat);

let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };

async function main() {
  const CNPJ = `66${String(Date.now()).slice(-12)}`;
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({
    cnpj: CNPJ, razaoSocial: 'Compensa LTDA', bancoTipoAcordo: 'INDIVIDUAL', bancoPrazoMeses: 6,
  }).returning()))[0]!;
  const rep = (await comoMaster(db, (tx) => tx.insert(pontoRep).values({
    tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: CNPJ, razaoSocial: 'Compensa LTDA',
    numeroInpi: 'BR512024006666-6', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188',
  }).returning()))[0]!;
  const hor = (await comoMaster(db, (tx) => tx.insert(pontoHorarioContratual).values({
    tenantId: t.id, codigo: 'SEM-JANELA', durJornadaMin: 480, pares: [], diasSemana: [1, 2, 3, 4, 5], regime: 'normal',
  }).returning()))[0]!;
  const bancoCfg = (forma: string, neg?: string) => ({ banco: { bancoModo: 'ATIVO', bancoTipoAcordo: 'INDIVIDUAL', bancoPrazoMeses: 6, formaCalculo: forma, ...(neg ? { negativoMes: neg } : {}) } });
  const [pAcum, pDesc, pCarr] = await comoMaster(db, (tx) => tx.insert(pontoPerfilRegra).values([
    { tenantId: t.id, nome: 'Acumula', config: bancoCfg('BANCO_HORAS') },
    { tenantId: t.id, nome: 'Paga no mês', config: bancoCfg('INTRA_MES', 'DESCONTA') },
    { tenantId: t.id, nome: 'Contrato de horas', config: bancoCfg('INTRA_MES', 'CARREGA') },
  ]).returning());

  const novoEmp = async (n: number, nome: string, perfil: string) => (await comoMaster(db, (tx) => tx.insert(empregado).values({
    tenantId: t.id, cpf: `${CNPJ.slice(0, 10)}${n}`, nome, horarioContratualId: hor.id, dataInicioPonto: '2026-07-13',
    perfilRegraId: perfil, salarioMensal: '2200.00',
  }).returning()))[0]!;
  const e1 = await novoEmp(1, 'Ana Acumula', pAcum!.id);
  const e2 = await novoEmp(2, 'Bruno Paga', pDesc!.id);
  const e3 = await novoEmp(3, 'Caio Contrato', pCarr!.id);

  let nsr = 1;
  const bate = (cpf: string, isoUtc: string) => comoMaster(db, (tx) => tx.insert(pontoMarcacao).values({
    tenantId: t.id, repId: rep.id, nsr: nsr++, cpf, dtMarcacao: new Date(isoUtc), coletor: 1,
    hashRegistro: nsr.toString(16).padStart(64, '0'),
  }).returning());
  const especiais: Record<string, string[]> = {
    '2026-07-15': ['11:00', '15:00', '16:00', '22:00'], // +2h
    '2026-07-22': ['11:00', '15:00', '16:00', '19:00'], // -1h
    '2026-08-05': ['11:00', '15:00', '16:00', '21:30'], // +1h30
    '2026-08-19': ['11:00', '15:00', '16:00', '17:00'], // -3h
    '2026-09-01': ['11:00', '15:00', '16:00', '21:00'], // +1h
    '2026-09-02': ['11:00', '15:00', '16:00', '21:00'], // +1h
  };
  const uteis = (ini: string, fim: string) => {
    const out: string[] = [];
    for (let d = new Date(`${ini}T12:00:00Z`); d.toISOString().slice(0, 10) <= fim; d.setUTCDate(d.getUTCDate() + 1)) {
      const dow = d.getUTCDay();
      if (dow >= 1 && dow <= 5) out.push(d.toISOString().slice(0, 10));
    }
    return out;
  };
  for (const e of [e1, e2, e3]) {
    for (const d of [...uteis('2026-07-13', '2026-07-31'), ...uteis('2026-08-03', '2026-08-31'), ...uteis('2026-09-01', '2026-09-10')]) {
      for (const h of especiais[d] ?? ['11:00', '15:00', '16:00', '20:00']) await bate(e.cpf, `${d}T${h}:00Z`);
    }
  }
  const HOJE = '2026-09-10';
  const fechs = async (id: string) => Object.fromEntries((await comTenant(db, t.id, (tx) => tx.select().from(pontoBancoFechamento)
    .where(eq(pontoBancoFechamento.empregadoId, id)))).map((f) => [f.competencia, f.acertoMin]));

  // ---------- 1. Acumula: nada muda ----------
  const s1 = await banco.saldo(t.id, e1.id, HOJE);
  ok(s1.saldo!.saldoMin === -30, `acumula: +60 (jul) -90 (ago) = -30 no banco (${s1.saldo!.saldoMin})`);
  ok(Object.values(await fechs(e1.id)).every((a) => a == null), 'acumula: fechamentos sem acerto');

  // ---------- 2. Paga a diferença, desconta se dever ----------
  const s2 = await banco.saldo(t.id, e2.id, HOJE);
  const f2 = await fechs(e2.id);
  ok(f2['2026-07'] === 60 && f2['2026-08'] === -90, `paga: julho acerta +60 (pago), agosto -90 (descontado) (${f2['2026-07']}/${f2['2026-08']})`);
  ok(s2.saldo!.saldoMin === 0, `paga: banco zerado depois dos acertos (${s2.saldo!.saldoMin})`);
  ok(s2.extrato.some((m) => m.descricao === 'Saldo do mês pago na folha de jul/2026' && m.minutos === -60 && m.tipo === 'PAGAMENTO'),
    'paga: extrato tem "Saldo do mês pago na folha de jul/2026" -1h00');
  ok(s2.extrato.some((m) => m.descricao === 'Saldo negativo descontado na folha de ago/2026' && m.minutos === 90),
    'paga: extrato tem "Saldo negativo descontado na folha de ago/2026" +1h30');
  ok(s2.saldoProjetadoMin === 120, `paga: setembro em andamento projeta +120 (${s2.saldoProjetadoMin})`);

  const ap2jul = await trat.apurarPeriodoCLT(t.id, e2.id, '2026-07-01', '2026-07-31', []);
  ok(ap2jul.banco?.acerto?.acertoMin === 60, `apuração jul: acerto +60 (${ap2jul.banco?.acerto?.acertoMin})`);
  ok(ap2jul.acertoBanco?.extrasCentavos === 1500, `apuração jul: 1h paga a 50% com hora de R$10 = R$15,00 (${ap2jul.acertoBanco?.extrasCentavos})`);
  ok(ap2jul.banco?.desatualizado === false, 'apuração jul: fechamento bate (o acerto não conta como lançado)');
  const ap2ago = await trat.apurarPeriodoCLT(t.id, e2.id, '2026-08-01', '2026-08-31', []);
  ok(ap2ago.banco?.saldoAnteriorMin === 0, `apuração ago: nada veio de julho (${ap2ago.banco?.saldoAnteriorMin})`);
  ok(ap2ago.acertoBanco?.descontoCentavos === 1500, `apuração ago: desconto de 1h30 = R$15,00 (${ap2ago.acertoBanco?.descontoCentavos})`);
  const ap2set = await trat.apurarPeriodoCLT(t.id, e2.id, '2026-09-01', '2026-09-30', []);
  ok(ap2set.banco?.acerto?.acertoMin === 120 && !ap2set.banco.fechada, `apuração set (aberto): prévia paga +120 (${ap2set.banco?.acerto?.acertoMin})`);

  // ---------- 3. Contrato de horas: devendo passa ----------
  const s3 = await banco.saldo(t.id, e3.id, HOJE);
  const f3 = await fechs(e3.id);
  ok(f3['2026-07'] === 60 && f3['2026-08'] === 0, `contrato: julho pago +60, agosto sem acerto (passa) (${f3['2026-07']}/${f3['2026-08']})`);
  ok(s3.saldo!.saldoMin === -90, `contrato: começa setembro devendo 1h30 (${s3.saldo!.saldoMin})`);
  const ap3set = await trat.apurarPeriodoCLT(t.id, e3.id, '2026-09-01', '2026-09-30', []);
  ok(ap3set.banco?.saldoAnteriorMin === -90 && ap3set.banco?.acerto?.acertoMin === 30,
    `contrato set: veio -90, mês +120 → paga só 30 (${ap3set.banco?.saldoAnteriorMin} / ${ap3set.banco?.acerto?.acertoMin})`);
  const ap3ago = await trat.apurarPeriodoCLT(t.id, e3.id, '2026-08-01', '2026-08-31', []);
  ok(ap3ago.banco?.acerto?.passaMin === -90 && ap3ago.acertoBanco?.descontoCentavos === 0,
    `contrato ago: -90 passa, sem desconto (${ap3ago.banco?.acerto?.passaMin})`);

  // Correção avulsa em agosto (fechado): reabre agosto e refaz setembro em diante.
  await banco.lancarMovimento(t.id, { empregadoId: e3.id, data: '2026-08-20', minutos: 90, tipo: 'AJUSTE', descricao: 'Batida perdida no dia 19' });
  const s3b = await banco.saldo(t.id, e3.id, HOJE);
  ok(s3b.saldo!.saldoMin === 0 && (await fechs(e3.id))['2026-08'] === 0, `contrato: ajuste +1h30 em agosto zera o devendo (${s3b.saldo!.saldoMin})`);

  // ---------- 4. Saldo de abertura e baixa em lote ----------
  await banco.lancarMovimento(t.id, { empregadoId: e2.id, data: '2026-07-13', minutos: 600, tipo: 'AJUSTE', descricao: DESC_ABERTURA });
  await banco.lancarMovimento(t.id, { empregadoId: e1.id, data: '2026-07-13', minutos: 300, tipo: 'AJUSTE', descricao: DESC_ABERTURA });
  await banco.saldo(t.id, e2.id, HOJE);
  ok((await fechs(e2.id))['2026-07'] === 660, `abertura de 10h no mês de julho entraria no acerto (${(await fechs(e2.id))['2026-07']})`);

  const ab = await banco.aberturas(t.id);
  const ab2 = ab.find((a) => a.empregadoId === e2.id);
  ok(ab.length === 2 && ab2?.restanteMin === 600 && ab2.aberturaData === '2026-07-13', `aberturas: 2 funcionários, Bruno com 10h a baixar (${ab.length} / ${ab2?.restanteMin})`);

  let barrou = false;
  try { await banco.baixarAberturas(t.id, { competenciaFolha: '2026-09', itens: [{ empregadoId: e1.id, minutos: 301 }] }); } catch { barrou = true; }
  ok(barrou, 'baixa acima do saldo de abertura é recusada');

  const bx = await banco.baixarAberturas(t.id, { competenciaFolha: '2026-09', itens: [{ empregadoId: e2.id, minutos: 600 }, { empregadoId: e1.id, minutos: 200 }] });
  ok(bx.baixados === 2 && bx.totalMin === 800, `baixa em lote: 2 funcionários, 13h20 (${bx.totalMin})`);
  const s2b = await banco.saldo(t.id, e2.id, HOJE);
  ok((await fechs(e2.id))['2026-07'] === 60 && s2b.saldo!.saldoMin === 0, `baixa na data da abertura: julho volta a +60 e nada vira desconto (${(await fechs(e2.id))['2026-07']} / ${s2b.saldo!.saldoMin})`);
  ok(s2b.extrato.some((m) => m.descricao === 'Horas pagas na folha de set/2026 (saldo de abertura)' && m.minutos === -600 && m.data === '2026-07-13'),
    'extrato: "Horas pagas na folha de set/2026 (saldo de abertura)" -10h em 13/07');
  const s1b = await banco.saldo(t.id, e1.id, HOJE);
  ok(s1b.saldo!.saldoMin === -30 + 300 - 200, `acumula: abertura +5h, baixa 3h20 → +1h10 (${s1b.saldo!.saldoMin})`);
  const ab3 = await banco.aberturas(t.id);
  ok(ab3.find((a) => a.empregadoId === e2.id)?.restanteMin === 0 && ab3.find((a) => a.empregadoId === e1.id)?.restanteMin === 100,
    'aberturas: Bruno zerado, Ana com 1h40 restante');

  console.log(falhas === 0 ? '\n>>> BANCO COMPENSA NO MÊS OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
