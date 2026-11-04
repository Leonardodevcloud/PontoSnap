import 'reflect-metadata';
/**
 * Folga do banco de horas na escala com sábado de meio turno e na saída antecipada:
 *  - folga no sábado tira do banco a jornada DO SÁBADO (4h), não a da semana (8h);
 *  - folga de parte do dia (saiu 2h mais cedo): só as 2h saem do banco, o que ele
 *    trabalhou continua normal (não vira extra) e não sobra atraso.
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { schema, comoMaster, comTenant, tenant, empregado, pontoRep, pontoHorarioContratual, pontoMarcacao, pontoBancoMov } from '@ponto/db';
import { BancoService } from '../src/banco/banco.service';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { AjusteService } from '../src/ajuste/ajuste.service';
import { FolgaService } from '../src/ajuste/folga.service';
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 3 });
const db = drizzle(client, { schema });
const trat = new TratamentoService(db); const banco = new BancoService(db, trat);
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };
const em = (d: string, hm: string) => new Date(`${d}T${hm}:00-0300`);
(async () => {
  const CNPJ = `33${String(Date.now()).slice(-12)}`;
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: CNPJ, razaoSocial: 'Sab', bancoTipoAcordo: 'INDIVIDUAL', bancoPrazoMeses: 6 }).returning()))[0]!;
  const rep = (await comoMaster(db, (tx) => tx.insert(pontoRep).values({ tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: CNPJ, razaoSocial: 'Sab', numeroInpi: 'BR512024009999-9', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188' }).returning()))[0]!;
  const hor = (await comoMaster(db, (tx) => tx.insert(pontoHorarioContratual).values({ tenantId: t.id, codigo: 'SEGSAB', durJornadaMin: 480, jornadaPorDia: { '6': 240 }, pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }], diasSemana: [1, 2, 3, 4, 5, 6], regime: 'normal' } as never).returning()))[0]!;
  const cpf = `9${CNPJ.slice(-10)}`;
  const emp = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf, nome: 'Sab', horarioContratualId: hor.id, salarioMensal: '2000' }).returning()))[0]!;
  let nsr = 1;
  const dias = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'];
  const m = dias.flatMap((d) => [em(d, '08:00'), em(d, '12:00'), em(d, '13:00'), em(d, '18:00')]);
  await comoMaster(db, (tx) => tx.insert(pontoMarcacao).values(m.map((b) => ({ tenantId: t.id, repId: rep.id, nsr, cpf, dtMarcacao: b, coletor: 1, hashRegistro: String(nsr++).padStart(64, '0') }))));
  const SAB = '2026-10-24';
  const ver = async (tag: string) => {
    const ap = await trat.apurarPeriodoCLT(t.id, emp.id, '2026-10-19', '2026-10-24', []);
    const d = ap.resultado.dias.find((x) => x.data === SAB)!;
    const movs = await comTenant(db, t.id, (tx) => tx.select().from(pontoBancoMov).where(and(eq(pontoBancoMov.empregadoId, emp.id), eq(pontoBancoMov.data, SAB))));
    return { falta: d.faltaMin, descanso: d.ehDescansoDia, debito: movs.reduce((a, x) => a + x.minutos, 0), tag };
  };
  const a0 = await ver('antes');
  ok(a0.falta === 240 && a0.debito === 0, `sábado sem lançar nada: falta de 4h (${a0.falta}), nada no banco`);
  const r = await banco.registrarFolga(t.id, emp.id, SAB);
  ok(r.minutos === 240 && !r.parcial, `folga do banco no sábado tira 4h, a jornada do sábado (${r.minutos})`);
  const a1 = await ver('depois');
  ok(a1.falta === 0 && a1.descanso && a1.debito === -240, `sábado vira folga: sem falta, -4h no banco (${a1.debito})`);
  // Saída antecipada autorizada: quinta 22/10 ele saiu 15:00 (2h antes) e o RH lança 2h de folga do banco.
  const QUI = '2026-10-29';
  await comoMaster(db, (tx) => tx.insert(pontoMarcacao).values([em(QUI, '08:00'), em(QUI, '12:00'), em(QUI, '13:00'), em(QUI, '15:00')].map((b) => ({ tenantId: t.id, repId: rep.id, nsr, cpf, dtMarcacao: b, coletor: 1, hashRegistro: String(nsr++).padStart(64, '0') }))));
  const vq = async (tag: string) => {
    const ap = await trat.apurarPeriodoCLT(t.id, emp.id, QUI, QUI, []);
    const d = ap.resultado.dias.find((x) => x.data === QUI)!;
    return { trab: d.minutosTrabalhados, atraso: (d as never as { atrasoMin?: number }).atrasoMin ?? 0, extras: d.extrasTotalMin, descanso: d.ehDescansoDia, tag };
  };
  const q0 = await vq('antes');
  ok(q0.atraso === 120, `saiu 2h mais cedo: 2h de saída antecipada (${q0.atraso})`);
  ok(/batidas/.test(await (async () => { try { await banco.registrarFolga(t.id, emp.id, QUI); return ''; } catch (e) { return (e as Error).message; } })()), 'dia inteiro de folga em dia com batida é recusado (pede as horas)');
  const rq = await banco.registrarFolga(t.id, emp.id, QUI, 120);
  ok(rq.parcial === true && rq.minutos === 120, 'folga de 2h no dia trabalhado: parcial');
  const q1 = await vq('depois');
  ok(q1.atraso === 0 && q1.extras === 0 && !q1.descanso && q1.trab === 360, `as 6h trabalhadas continuam normais (extras ${q1.extras}, atraso ${q1.atraso}, descanso ${q1.descanso})`);
  ok(/cumpriu a jornada inteira/.test(await (async () => { try { await banco.registrarFolga(t.id, emp.id, '2026-10-21', 120); return ''; } catch (e) { return (e as Error).message; } })()), 'dia trabalhado inteiro: não tira horas do banco por nada');
  ok(/maior/.test(await (async () => { try { await banco.registrarFolga(t.id, emp.id, '2026-10-30', 600); return ''; } catch (e) { return (e as Error).message; } })()), 'folga maior que a jornada do dia é recusada');
  ok(/não é dia de trabalho/.test(await (async () => { try { await banco.registrarFolga(t.id, emp.id, '2026-10-25'); return ''; } catch (e) { return (e as Error).message; } })()), 'domingo (fora da escala) é recusado');
  // Folgas lançadas (Ajustes): aparecem TODAS, inclusive as do banco; remover devolve as horas.
  const folgas = new FolgaService(db, new AjusteService(db));
  const lista = await folgas.listar(t.id, { empregadoId: emp.id });
  ok(lista.some((x) => x.data === SAB && x.tipo === 'BANCO_DIA' && x.minutos === 240) && lista.some((x) => x.data === QUI && x.tipo === 'BANCO_HORAS' && x.minutos === 120),
    `lista mostra a folga do banco do sábado (4h) e a de 2h (${lista.map((x) => `${x.data}:${x.tipo}`).join(', ')})`);
  const rm = await folgas.remover(t.id, lista.find((x) => x.data === SAB)!.id);
  const a2 = await ver('removida');
  ok(rm.devolvidoAoBancoMin === 240 && a2.debito === 0 && a2.falta === 240, `remover a folga do sábado: 4h voltam pro banco e o dia volta a ser falta (débito ${a2.debito}, falta ${a2.falta})`);
  console.log(falhas === 0 ? '\nTudo certo' : `\n${falhas} FALHA(S)`);
  await client.end();
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
