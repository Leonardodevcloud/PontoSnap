import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { schema, comoMaster, tenant, empregado, pontoRep, pontoHorarioContratual, pontoMarcacao, pontoFeriado, pontoPerfilRegra } from '@ponto/db';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { BancoService } from '../src/banco/banco.service';

/**
 * Feriado trabalhado com banco de horas ativo:
 *  - padrão (BANCO): as horas do feriado viram crédito no banco e não são pagas;
 *  - "Pagas na folha" (PAGA): as horas vão pra folha com 100% e NÃO entram no
 *    banco; a hora a mais de um dia comum continua indo pro banco.
 */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 3 });
const db = drizzle(client, { schema });
const trat = new TratamentoService(db);
const banco = new BancoService(db, trat);
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };
const em = (d: string, hm: string) => new Date(`${d}T${hm}:00-0300`);

async function main() {
  const CNPJ = `22${String(Date.now()).slice(-12)}`;
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: CNPJ, razaoSocial: 'Feriado Pago', bancoTipoAcordo: 'INDIVIDUAL', bancoPrazoMeses: 5 }).returning()))[0]!;
  const rep = (await comoMaster(db, (tx) => tx.insert(pontoRep).values({ tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: CNPJ, razaoSocial: 'Feriado Pago', numeroInpi: 'BR512024009999-9', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188' }).returning()))[0]!;
  const hor = (await comoMaster(db, (tx) => tx.insert(pontoHorarioContratual).values({ tenantId: t.id, codigo: 'COML', durJornadaMin: 480, pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }], diasSemana: [1, 2, 3, 4, 5], regime: 'normal' }).returning()))[0]!;
  const perfil = (await comoMaster(db, (tx) => tx.insert(pontoPerfilRegra).values({ tenantId: t.id, nome: 'Geral', padrao: true, config: { banco: { bancoModo: 'ATIVO', bancoTipoAcordo: 'INDIVIDUAL', bancoPrazoMeses: 5, formaCalculo: 'BANCO_HORAS' } } }).returning()))[0]!;
  const cpf = `6${CNPJ.slice(-10)}`;
  const emp = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf, nome: 'Lucas', horarioContratualId: hor.id, salarioMensal: '2200.00', perfilRegraId: perfil.id }).returning()))[0]!;
  await comoMaster(db, (tx) => tx.insert(pontoFeriado).values({ tenantId: t.id, data: '2026-10-19', nome: 'Feriado municipal' } as never));
  let nsr = 1;
  // 19/10 (feriado): trabalhou 8h. 20/10 (dia comum): 1h a mais.
  const marc = [em('2026-10-19', '08:00'), em('2026-10-19', '12:00'), em('2026-10-19', '13:00'), em('2026-10-19', '17:00'),
    em('2026-10-20', '08:00'), em('2026-10-20', '12:00'), em('2026-10-20', '13:00'), em('2026-10-20', '18:00')];
  await comoMaster(db, (tx) => tx.insert(pontoMarcacao).values(marc.map((b) => ({ tenantId: t.id, repId: rep.id, nsr, cpf, dtMarcacao: b, coletor: 1, hashRegistro: String(nsr++).padStart(64, '0') }))));

  const ver = async () => {
    const ap = await trat.apurarPeriodoCLT(t.id, emp.id, '2026-10-19', '2026-10-20', []);
    return { ap, bancoMes: ap.banco && 'saldoMesMin' in ap.banco ? ap.banco.saldoMesMin : null, conta: ap.conta.destino, valores: ap.valores! };
  };

  const a = await ver();
  const credito = a.ap.resultado.dias.reduce((s, d) => s + Math.max(0, d.saldoMin), 0);
  ok(a.ap.resultado.dias.find((d) => d.data === '2026-10-19')!.extras.some((e) => e.min === 480 && e.adicionalPct === 100), 'feriado trabalhado: 8h de extra a 100%');
  ok(a.conta.paraBancoMin === 540 && a.valores.extrasCentavos === 0, `padrão: 8h do feriado + 1h do dia comum vão pro banco (${a.conta.paraBancoMin}min), nada pago (${a.valores.extrasCentavos})`);
  ok(credito === 540, 'conferência: 9h a mais no período');

  await comoMaster(db, (tx) => tx.update(pontoPerfilRegra).set({ config: { banco: { bancoModo: 'ATIVO', bancoTipoAcordo: 'INDIVIDUAL', bancoPrazoMeses: 5, formaCalculo: 'BANCO_HORAS', domingoFeriado: 'PAGA' } } }).where(eq(pontoPerfilRegra.id, perfil.id)));
  const b = await ver();
  ok(b.conta.paraBancoMin === 60 && b.bancoMes === 60, `"Pagas na folha": só a 1h do dia comum vai pro banco (conta ${b.conta.paraBancoMin}min, banco ${b.bancoMes}min)`);
  ok(b.conta.extraPagaMin === 480, `"Pagas na folha": 8h do feriado pagas na folha (${b.conta.extraPagaMin}min)`);
  // 2200/220 = R$ 10/h → 8h a 100% = R$ 160
  ok(b.valores.extrasCentavos === 16000, `feriado pago com 100%: R$ 160,00 (${b.valores.extrasCentavos / 100})`);
  ok(b.ap.destinacao.extra.domingoFeriadoPagoMin === 480, 'resumo do mês separa as horas de feriado pagas');
  const cfg = await banco.configBanco(t.id, emp.id);
  ok(cfg.domingoFeriadoPago === true, 'banco de horas enxerga a regra (fechamento não credita o feriado)');

  console.log(falhas === 0 ? '\nTudo certo' : `\n${falhas} FALHA(S)`);
  await client.end();
  process.exit(falhas ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
