import 'reflect-metadata';
process.env.APP_CRYPTO_KEY = Buffer.alloc(32, 9).toString('base64');
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { schema, comoMaster, comTenant, tenant, empregado, usuario, pontoRep, pontoHorarioContratual, pontoMarcacao, pontoFeriado, pontoAusencia, pontoBancoMov } from '@ponto/db';
import { BancoService } from '../src/banco/banco.service';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { AjusteService } from '../src/ajuste/ajuste.service';
import { FolgaService } from '../src/ajuste/folga.service';
import { FiscalService } from '../src/fiscal/fiscal.service';
import { PessoalService } from '../src/pessoal/pessoal.service';
import { CriptoService } from '../src/common/cripto.service';

/**
 * Folga concedida (Ajustes): trabalhou no feriado, ganha uma folga.
 *  - o dia da folga não vira falta e NÃO mexe no banco de horas;
 *  - não deixa lançar em dia com batida, nem duplicar, nem em cima da folga do banco;
 *  - aparece como "FOLGA" para as telas; remover devolve a falta;
 *  - AEJ: com feriado vai como código 4; sem feriado (outro motivo) não vai.
 */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const trat = new TratamentoService(db);
const banco = new BancoService(db, trat);
const folgas = new FolgaService(db, new AjusteService(db));
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };
const erro = async (f: () => Promise<unknown>) => { try { await f(); return ''; } catch (e) { return (e as Error).message; } };
const em = (data: string, hm: string) => new Date(`${data}T${hm}:00-0300`);

async function main() {
  const CNPJ = `55${String(Date.now()).slice(-12)}`;
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: CNPJ, razaoSocial: 'Folga Concedida LTDA', bancoTipoAcordo: 'INDIVIDUAL', bancoPrazoMeses: 6 }).returning()))[0]!;
  const rep = (await comoMaster(db, (tx) => tx.insert(pontoRep).values({
    tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: CNPJ, razaoSocial: 'Folga Concedida LTDA',
    numeroInpi: 'BR512024009999-9', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188',
  }).returning()))[0]!;
  const hor = (await comoMaster(db, (tx) => tx.insert(pontoHorarioContratual).values({
    tenantId: t.id, codigo: 'COML', durJornadaMin: 480, pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }], diasSemana: [1, 2, 3, 4, 5], regime: 'normal',
  }).returning()))[0]!;
  const cpf = `8${CNPJ.slice(-10)}`;
  const emp = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf, nome: 'Rafa', horarioContratualId: hor.id }).returning()))[0]!;
  const rh = (await comoMaster(db, (tx) => tx.insert(usuario).values({ tenantId: t.id, email: `rh${CNPJ}@f.com`, senhaHash: 'x', perfil: 'RH' }).returning()))[0]!;
  await comoMaster(db, (tx) => tx.insert(pontoFeriado).values({ tenantId: t.id, data: '2026-10-12', nome: 'Nossa Senhora Aparecida' } as never));

  // Trabalhou no feriado (12/10) e em 13/10 e 15/10. Não bateu em 14/10 (a folga).
  let nsr = 1;
  const marc = ['2026-10-12', '2026-10-13', '2026-10-15'].flatMap((d) => [em(d, '08:00'), em(d, '12:00'), em(d, '13:00'), em(d, '17:00')]);
  await comoMaster(db, (tx) => tx.insert(pontoMarcacao).values(marc.map((b) => ({
    tenantId: t.id, repId: rep.id, nsr, cpf, dtMarcacao: b, coletor: 1, hashRegistro: String(nsr++).padStart(64, '0'),
  }))));

  const DIA = '2026-10-14';
  const diaDe = async (d: string) => (await trat.apurarPeriodoCLT(t.id, emp.id, '2026-10-12', '2026-10-15', [])).resultado.dias.find((x) => x.data === d)!;
  ok((await diaDe(DIA)).faltaMin === 480, 'antes: 14/10 sem batida é falta de 8h');

  const f = await folgas.criar(t.id, rh.id, { empregadoId: emp.id, data: DIA, feriadoRef: '2026-10-12' });
  ok(f.origem === 'CONCEDIDA' && f.tipo === 4, 'folga concedida gravada (tipo 4, origem CONCEDIDA)');
  const d = await diaDe(DIA);
  ok(d.faltaMin === 0 && d.ehDescansoDia === true, `depois: 14/10 vira descanso, sem falta (falta=${d.faltaMin})`);
  const movs = await comTenant(db, t.id, (tx) => tx.select().from(pontoBancoMov).where(and(eq(pontoBancoMov.empregadoId, emp.id), eq(pontoBancoMov.data, DIA))));
  ok(movs.length === 0, 'NÃO mexe no banco de horas (nenhum débito lançado)');
  const ap = await trat.apurarPeriodoCLT(t.id, emp.id, '2026-10-01', '2026-10-31', []);
  const af = ap.afastamentos.find((a) => a.tipo === 'FOLGA');
  ok(!!af && af.dataInicio === DIA && /12\/10/.test(af.observacao ?? ''), `telas recebem "FOLGA" com o feriado (${af?.observacao})`);
  ok(!ap.diasPrevistos.includes(DIA), 'dia da folga sai dos dias previstos (VR/VT por dia não são devidos)');

  ok(/batida/.test(await erro(() => folgas.criar(t.id, rh.id, { empregadoId: emp.id, data: '2026-10-13', motivo: 'teste' }))), 'recusa dia com batida (ele trabalhou)');
  ok(/Já existe/.test(await erro(() => folgas.criar(t.id, rh.id, { empregadoId: emp.id, data: DIA, motivo: 'de novo' }))), 'recusa folga duplicada');
  ok(/folga registrada/.test(await erro(() => banco.registrarFolga(t.id, emp.id, DIA))), 'folga do banco não entra em cima da concedida');
  ok(/motivo/.test(await erro(() => folgas.criar(t.id, rh.id, { empregadoId: emp.id, data: '2026-10-16' }))), 'sem feriado e sem motivo: pede o motivo');

  // Outra folga, sem feriado (outro motivo): abona, mas não vai pro AEJ.
  await folgas.criar(t.id, rh.id, { empregadoId: emp.id, data: '2026-10-16', motivo: 'Folga de aniversário (convenção)' });
  ok((await folgas.listar(t.id, { empregadoId: emp.id })).length === 2, 'lista as 2 folgas lançadas');
  const fiscal = new FiscalService(db, {} as never);
  const aej = (await fiscal.gerarAej(t.id)).conteudo.toString('latin1');
  const linhas07 = aej.split(/\r?\n/).filter((l) => l.startsWith('07|'));
  ok(linhas07.length === 1 && /^07\|[^|]*\|4\|2026-10-14\|/.test(linhas07[0]!), `AEJ: folga do feriado trabalhado vai como código 4, na data certa (${linhas07[0]})`);
  ok(!aej.includes('2026-10-16'), 'AEJ: folga sem feriado não vai (não tem código no AEJ)');

  // VR/VT: o dia da folga é abatido (pago antecipado e não usado), com o motivo "folga".
  const pes = new PessoalService(db, trat, new CriptoService());
  await pes.salvarConfigClt(t.id, emp.id, { cargo: 'Auxiliar', vrDia: 25, cestaMensal: 0, vtTipo: 'DIA', vtValor: 10, chavePix: null, vigenteDesde: '2026-10' });
  const out = (await pes.competencia(t.id, '2026-10')).clt.find((c) => c.empregadoId === emp.id)!;
  const nu = out.beneficios.naoUsados.find((x) => x.data === DIA);
  ok(nu?.motivo === 'folga', `VR/VT: 14/10 entra no abatimento como "folga" (${nu?.motivo})`);
  ok(!out.beneficios.naoUsados.some((x) => x.data === '2026-10-12'.replace('12', '13')), 'VR/VT: dia trabalhado (13/10) não é abatido');
  const so14 = out.beneficios.naoUsados.filter((x) => x.data === DIA).length;
  ok(so14 === 1 && out.beneficios.acertoVrCent >= 2500 && out.beneficios.acertoVtCent >= 1000, `VR/VT: abate R$ 25 de VR e R$ 10 de VT pela folga (VR ${out.beneficios.acertoVrCent / 100}, VT ${out.beneficios.acertoVtCent / 100})`);

  // Removeu: o dia volta a ser falta.
  await folgas.remover(t.id, f.id);
  ok((await diaDe(DIA)).faltaMin === 480, 'remover a folga: 14/10 volta a ser falta');
  const resto = await comTenant(db, t.id, (tx) => tx.select().from(pontoAusencia).where(eq(pontoAusencia.empregadoId, emp.id)));
  ok(resto.length === 1 && resto[0]!.data === '2026-10-16', 'só a folga removida saiu');

  console.log(falhas === 0 ? '\nTudo certo' : `\n${falhas} FALHA(S)`);
  await client.end();
  process.exit(falhas ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
