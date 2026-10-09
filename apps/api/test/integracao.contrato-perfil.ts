import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { schema, comoMaster, tenant, empregado, pontoRep, pontoMarcacao, pontoPerfilRegra } from '@ponto/db';
import { TratamentoService } from '../src/tratamento/tratamento.service';

/**
 * Contrato de horas definido no PERFIL (tipo de jornada), não na escala.
 * - perfil CONTRATO_HORAS + escala fixa → sem janela (só a carga);
 * - perfil FIXO + escala antiga "flexível" → volta a valer a janela;
 * - perfil sem definição → segue a escala (legado).
 */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const trat = new TratamentoService(db);
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };

async function main() {
  const CNPJ = `78${String(Date.now()).slice(-12)}`;
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: CNPJ, razaoSocial: 'Contrato LTDA', bancoTipoAcordo: 'INDIVIDUAL', bancoPrazoMeses: 6 }).returning()))[0]!;
  const rep = (await comoMaster(db, (tx) => tx.insert(pontoRep).values({
    tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: CNPJ, razaoSocial: 'Contrato LTDA',
    numeroInpi: 'BR512024007777-7', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188',
  }).returning()))[0]!;
  const hor = (await trat.criarHorario(t.id, { codigo: 'COMERCIAL', durJornadaMin: 480, pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }] }))!;
  const perfil = (await comoMaster(db, (tx) => tx.insert(pontoPerfilRegra).values({
    tenantId: t.id, nome: 'Contrato de horas', config: { contrato: { tipoJornada: 'CONTRATO_HORAS' } }, padrao: false,
  } as never).returning()))[0]! as { id: string };
  const emp = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: CNPJ.slice(0, 11), nome: 'Bianca', horarioContratualId: hor.id, dataInicioPonto: '2026-07-13' }).returning()))[0]!;

  let nsr = 1;
  const bate = (iso: string) => comoMaster(db, (tx) => tx.insert(pontoMarcacao).values({
    tenantId: t.id, repId: rep.id, nsr: nsr++, cpf: emp.cpf, dtMarcacao: new Date(iso), coletor: 1, hashRegistro: nsr.toString(16).padStart(64, '0'),
  }).returning());
  // 13/07: 12:00–16:00 e 17:00–22:00 = 9h, fora do horário da escala (banco ativo).
  for (const h of ['12:00', '16:00', '17:00', '22:00']) await bate(`2026-07-13T${h}:00-03:00`);

  const dia = async () => (await trat.apurarPeriodoCLT(t.id, emp.id, '2026-07-13', '2026-07-13', [])).resultado.dias[0]!;

  // Sem perfil e escala fixa: pela janela → atraso de manhã.
  const fixo = await dia();
  ok(fixo.extrasTotalMin === 60, `sem perfil, escala fixa: hora depois das 17h é extra (extra=${fixo.extrasTotalMin})`);

  // Perfil diz contrato de horas: só a carga conta.
  await comoMaster(db, (tx) => tx.update(empregado).set({ perfilRegraId: perfil.id }).where(eq(empregado.id, emp.id)));
  const ap = await trat.apurarPeriodoCLT(t.id, emp.id, '2026-07-13', '2026-07-13', []);
  const d = ap.resultado.dias[0]!;
  ok(d.minutosTrabalhados === 540 && d.extrasTotalMin === 0 && d.saldoMin === 60, `perfil contrato de horas: 9h = +1h de crédito na carga, não extra (extra=${d.extrasTotalMin} saldo=${d.saldoMin})`);
  ok(ap.horarioFlexivel === true, 'apuração informa jornada livre (vem do perfil)');

  // Escala antiga marcada flexível, mas perfil diz FIXO: o perfil manda.
  await trat.atualizarHorario(t.id, hor.id, { flexivel: true });
  await comoMaster(db, (tx) => tx.update(pontoPerfilRegra).set({ config: { contrato: { tipoJornada: 'FIXO' } } } as never).where(eq(pontoPerfilRegra.id, perfil.id)));
  const d2 = await dia();
  ok(d2.extrasTotalMin === 60, `perfil FIXO ganha da escala flexível: volta a ser extra (${d2.extrasTotalMin})`);

  // Perfil sem tipo de jornada: segue a escala (legado flexível).
  await comoMaster(db, (tx) => tx.update(pontoPerfilRegra).set({ config: {} } as never).where(eq(pontoPerfilRegra.id, perfil.id)));
  const d3 = await dia();
  ok(d3.extrasTotalMin === 0 && d3.saldoMin === 60, `perfil sem definição segue a escala flexível (extra=${d3.extrasTotalMin})`);

  console.log(falhas === 0 ? '\n>>> CONTRATO NO PERFIL OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
