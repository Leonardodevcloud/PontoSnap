import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { schema, comoMaster, tenant, empregado, pontoRep, pontoMarcacao, pontoPerfilRegra } from '@ponto/db';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { AjudaService } from '../src/ajuda/ajuda.service';

/**
 * O raio-x (Central de Ajuda) tem que dizer o mesmo que o motor calcula.
 * Mesma semana para todos: 9h · 7h · 8h30 · 7h30 · 8h (carga 8h) → saldos +1h −1h +30 −30 0.
 */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const trat = new TratamentoService(db);
const ajuda = new AjudaService(db);
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };

async function main() {
  const CNPJ = `81${String(Date.now()).slice(-12)}`;
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: CNPJ, razaoSocial: 'Compensa LTDA' }).returning()))[0]!;
  const rep = (await comoMaster(db, (tx) => tx.insert(pontoRep).values({
    tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: CNPJ, razaoSocial: 'Compensa LTDA',
    numeroInpi: 'BR512024007777-7', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188',
  }).returning()))[0]!;
  const pares = [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }];
  const fixo = (await trat.criarHorario(t.id, { codigo: 'FIXO', durJornadaMin: 480, pares }))!;
  const flex = (await trat.criarHorario(t.id, { codigo: 'CH-8H', durJornadaMin: 480, pares: [], flexivel: true }))!;
  const flexSem = (await trat.criarHorario(t.id, { codigo: 'CH-8H-SEM', durJornadaMin: 480, pares: [], flexivel: true, compensaSemana: true }))!;
  const perfil = async (nome: string, config: unknown) => (await comoMaster(db, (tx) => tx.insert(pontoPerfilRegra).values({ tenantId: t.id, nome, config }).returning()))[0]!;
  const pMes = await perfil('Compensa no mês', { banco: { bancoModo: 'ATIVO', formaCalculo: 'INTRA_MES', negativoMes: 'DESCONTA', bancoTipoAcordo: 'INDIVIDUAL', bancoPrazoMeses: null }, destinacao: { destinacaoFaltas: 'BANCO', destinacaoAtrasos: 'BANCO' } });
  const pHerda = await perfil('Operação', { banco: null });
  const pLegado = await perfil('Contrato antigo', { contrato: { tipoJornada: 'CONTRATO_HORAS' } });

  let nsr = 1, n = 0;
  const novo = async (nome: string, horario: string, perfilRegraId: string | null) => {
    const e = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: `${CNPJ.slice(-9)}${String(++n).padStart(2, '0')}`, nome, horarioContratualId: horario, perfilRegraId, dataInicioPonto: '2026-09-01' }).returning()))[0]!;
    const semana: [string, string[]][] = [
      ['2026-09-07', ['08:00', '12:00', '13:00', '18:00']], ['2026-09-08', ['08:00', '12:00', '13:00', '16:00']],
      ['2026-09-09', ['08:00', '12:00', '13:00', '17:30']], ['2026-09-10', ['08:00', '12:00', '13:00', '16:30']],
      ['2026-09-11', ['08:00', '12:00', '13:00', '17:00']],
    ];
    for (const [d, hs] of semana) for (const h of hs) await comoMaster(db, (tx) => tx.insert(pontoMarcacao).values({
      tenantId: t.id, repId: rep.id, nsr: nsr++, cpf: e.cpf, dtMarcacao: new Date(`${d}T${h}:00-03:00`), coletor: 1, hashRegistro: nsr.toString(16).padStart(64, '0'),
    }));
    return e;
  };
  const A = await novo('Ana Contrato Solto', flex.id, null);
  const B = await novo('Bia Semana', flexSem.id, null);
  const C = await novo('Caio Mês', flex.id, pMes.id);
  const D = await novo('Davi Herda', fixo.id, pHerda.id);
  const E = await novo('Eva Legado', fixo.id, pLegado.id);

  const ap = async (id: string) => (await trat.apurarPeriodoCLT(t.id, id, '2026-09-07', '2026-09-13', []));
  const comp = await ajuda.compensacao(t.id);
  const de = (id: string) => comp.linhas.find((l) => l.empregadoId === id)!;

  // A: contrato de horas sozinho → cada dia fecha sozinho
  const a = await ap(A.id);
  ok(de(A.id).nivel === 'NAO' && de(A.id).alertas.some((x) => x.codigo === 'CONTRATO_SEM_COMPENSACAO'), 'raio-x A: não compensa (contrato de horas sem banco)');
  ok(a.resultado.totalExtrasMin === 90 && a.resultado.totalAtrasoMin === 90 && a.banco === null, `motor A: paga 1h30 e desconta 1h30 (${a.resultado.totalExtrasMin}/${a.resultado.totalAtrasoMin})`);

  // B: compensa na semana → zera
  const b = await ap(B.id);
  ok(de(B.id).nivel === 'SEMANA' && !de(B.id).alertas.some((x) => x.gravidade === 'erro'), 'raio-x B: compensa na semana');
  ok(b.resultado.totalExtrasMin === 0 && b.resultado.totalAtrasoMin === 0 && b.resultado.totalFaltaMin === 0, `motor B: semana zerada (${b.resultado.totalExtrasMin}/${b.resultado.totalAtrasoMin})`);

  // C: banco compensa no mês → nada pago; atraso vai para o banco
  const c = await ap(C.id);
  ok(de(C.id).nivel === 'MES' && de(C.id).destinacao.atrasos === 'BANCO' && de(C.id).alertas.length === 0, 'raio-x C: compensa no mês, sem alertas');
  ok(c.banco?.formaCalculo === 'INTRA_MES' && c.destinacao.atraso.destino === 'BANCO' && c.resultado.totalExtrasMin === 0, `motor C: banco no mês, extra não é paga (${c.resultado.totalExtrasMin})`);

  // D: perfil com banco "segue a empresa" e empresa sem acordo → sem banco (a armadilha)
  const d = await ap(D.id);
  ok(de(D.id).banco.ativo === false && de(D.id).banco.origem === 'EMPRESA' && de(D.id).alertas.some((x) => x.codigo === 'BANCO_EMPRESA_SEM_ACORDO'), 'raio-x D: sem banco (herda da empresa sem acordo)');
  ok(d.banco === null && d.resultado.totalExtrasMin === 90 && d.resultado.totalAtrasoMin === 90, `motor D: sem banco, paga e desconta (${d.resultado.totalExtrasMin}/${d.resultado.totalAtrasoMin})`);

  // E: perfil antigo "contrato de horas" vence a escala fixa
  const e = await ap(E.id);
  ok(de(E.id).jornada === 'CONTRATO_HORAS' && de(E.id).alertas.some((x) => x.codigo === 'CONTRATO_LEGADO'), 'raio-x E: perfil antigo força contrato de horas');
  ok(e.horarioFlexivel === true, 'motor E: apura como contrato de horas');

  ok(comp.totais.pessoas === 5 && comp.totais.atencao === 2 && comp.totais.semana === 1 && comp.totais.mes === 1 && comp.totais.nao === 3, `totais: 5 pessoas, 2 com atenção (${JSON.stringify(comp.totais)})`);

  // acordo da empresa muda o D (herda) sem mexer no perfil
  await comoMaster(db, (tx) => tx.update(tenant).set({ bancoTipoAcordo: 'INDIVIDUAL', bancoPrazoMeses: 6 }).where(eq(tenant.id, t.id)));
  const d2 = (await ajuda.compensacaoDe(t.id, D.id));
  const dAp2 = await ap(D.id);
  ok(d2.nivel === 'ACUMULA' && d2.banco.prazoMeses === 6 && dAp2.banco !== null && dAp2.resultado.totalExtrasMin >= 0, 'com acordo da empresa, D passa a acumular — raio-x e motor concordam');
  ok(d2.historico.length === 0 && d2.escala?.codigo === 'FIXO', 'raio-x individual traz escala e histórico');

  // mudança de escala agendada aparece
  await trat.mudarEscalaComVigencia(t.id, A.id, flexSem.id, '2099-01-01');
  const a2 = await ajuda.compensacaoDe(t.id, A.id);
  ok(a2.proximaEscala?.codigo === 'CH-8H-SEM' && a2.escala?.codigo === 'CH-8H', `mudança futura: hoje CH-8H, depois CH-8H-SEM (${a2.escala?.codigo})`);

  const imp = await ajuda.implantacao(t.id);
  const passo = (id: string) => imp.passos.find((p) => p.id === id)!;
  ok(passo('escalas').ok && !passo('regras').ok && !passo('local').ok && !passo('acesso').ok, `implantação: escalas ok, falta padrão, local e acesso (${imp.feitos}/6)`);
  ok(passo('funcionarios').ok === (imp.atencao === 0 && imp.semEscala === 0) && imp.atencao === 0, `com acordo da empresa ninguém fica "cada dia sozinho" (${imp.atencao})`);

  console.log(falhas === 0 ? '\n>>> RAIO-X = MOTOR OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
