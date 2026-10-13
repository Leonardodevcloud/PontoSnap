import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema, comoMaster, tenant, empregado, pontoRep, pontoMarcacao, pontoPerfilRegra, pontoAjuste } from '@ponto/db';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { PessoalService } from '../src/pessoal/pessoal.service';
import { AtencaoService } from '../src/pessoal/atencao.service';
import { CriptoService } from '../src/common/cripto.service';

/**
 * Central "Precisa de atenção": junta batida em aberto, semana que não fecha,
 * ajuste pedido, funcionário sem escala e regra com nome que contradiz a escala.
 */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const trat = new TratamentoService(db);
const pes = new PessoalService(db, trat, new CriptoService());
const at = new AtencaoService(db, trat, pes);
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };

/** Último dia útil (seg–sex) antes de hoje, no mesmo mês; null se hoje for o 1º dia útil. */
function diaUtilAnterior(): string | null {
  const agora = new Date(Date.now() - 3 * 3600_000);
  const d = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate()));
  for (let i = 0; i < 10; i++) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (d.getUTCMonth() !== agora.getUTCMonth()) return null;
    const w = d.getUTCDay();
    if (w >= 1 && w <= 5) return d.toISOString().slice(0, 10);
  }
  return null;
}

async function main() {
  const CNPJ = `78${String(Date.now()).slice(-12)}`;
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: CNPJ, razaoSocial: 'Atencao LTDA' }).returning()))[0]!;
  const rep = (await comoMaster(db, (tx) => tx.insert(pontoRep).values({
    tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: CNPJ, razaoSocial: 'Atencao LTDA',
    numeroInpi: 'BR512024007777-7', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188',
  }).returning()))[0]!;
  const hor = (await trat.criarHorario(t.id, {
    codigo: '6X1 COMPENSA', durJornadaMin: 480, diasSemana: [1, 2, 3, 4, 5, 6], jornadaPorDia: { 6: 240 }, compensaSemana: true,
    pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }],
  }))!;
  const perfil = (await comoMaster(db, (tx) => tx.insert(pontoPerfilRegra).values({ tenantId: t.id, nome: 'Contrato de horas', config: {} }).returning()))[0]!;
  const ana = (await comoMaster(db, (tx) => tx.insert(empregado).values({
    tenantId: t.id, cpf: CNPJ.slice(0, 11), nome: 'Ana Souza', horarioContratualId: hor.id, perfilRegraId: perfil.id, dataInicioPonto: '2026-01-01',
  }).returning()))[0]!;
  await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: `9${CNPJ.slice(1, 11)}`, nome: 'Bruno Lima', dataInicioPonto: '2026-01-01' }));

  const ontem = diaUtilAnterior();
  if (ontem) {
    // Três batidas: falta a saída.
    let nsr = 1;
    for (const h of ['08:00', '12:00', '13:00']) await comoMaster(db, (tx) => tx.insert(pontoMarcacao).values({
      tenantId: t.id, repId: rep.id, nsr: nsr++, cpf: ana.cpf, dtMarcacao: new Date(`${ontem}T${h}:00-03:00`), coletor: 1, hashRegistro: nsr.toString(16).padStart(64, '0'),
    }));
    await comoMaster(db, (tx) => tx.insert(pontoAjuste).values({
      tenantId: t.id, empregadoId: ana.id, tipo: 'INCLUSAO', data: ontem, dtMarcacao: new Date(`${ontem}T17:00:00-03:00`), tpMarc: 'S',
      observacao: 'Esqueci de bater a saída', status: 'EM_ANALISE',
    } as never));
  }

  const r = await at.listar(t.id);
  const tipo = (x: string) => r.itens.find((i) => i.tipo === x);
  if (ontem) {
    ok(!!tipo('BATIDAS') && tipo('BATIDAS')!.qtd === 1 && tipo('BATIDAS')!.acao.abrir === 'BATIDAS', `batida faltando de ${ontem} aparece com "Completar batidas"`);
    ok(!!tipo('SEMANA') && tipo('SEMANA')!.grupo === 'BLOQUEIA', 'escala que compensa: a semana do dia em aberto não fecha');
    ok(!!tipo('AJUSTE') && tipo('AJUSTE')!.texto.includes('Esqueci de bater'), 'ajuste pedido aparece com o texto do funcionário');
  } else console.log('(pulado: hoje é o 1º dia útil do mês — sem dia anterior para batida em aberto)');
  ok(!!tipo('SEM_ESCALA') && tipo('SEM_ESCALA')!.pessoas[0]?.nome === 'Bruno', 'Bruno sem escala aparece no cadastro');
  ok(!!tipo('REGRA_NOME') && tipo('REGRA_NOME')!.pessoas[0]?.nome === 'Ana', 'regra "Contrato de horas" com escala de horário fixo é apontada');
  ok(!!tipo('PADRAO_BENEFICIO'), 'padrão de VR/VT não definido aparece antes de fechar');
  ok(r.totais.total === r.itens.length && r.totais.bloqueia + r.totais.antes + r.totais.cadastro === r.totais.total, 'totais batem com a lista');

  // Escala virando contrato de horas: o alerta de nome some.
  await trat.atualizarHorario(t.id, hor.id, {
    codigo: '6X1 COMPENSA', durJornadaMin: 480, diasSemana: [1, 2, 3, 4, 5, 6], jornadaPorDia: { 6: 240 }, compensaSemana: true, flexivel: true,
    pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }],
  });
  const r2 = await at.listar(t.id);
  ok(!r2.itens.some((i) => i.tipo === 'REGRA_NOME'), 'com a escala em contrato de horas, o nome da regra deixa de enganar');

  await client.end();
  if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
  console.log('\nTudo certo.');
}
main().catch(async (e) => { console.error(e); await client.end(); process.exit(1); });
