import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema } from '@ponto/db';
import { Coletor } from '@ponto/shared';
import { TenantService } from '../src/tenant/tenant.service';
import { EmpregadoService } from '../src/empregado/empregado.service';
import { MarcacaoService } from '../src/marcacao/marcacao.service';
import { TratamentoService } from '../src/tratamento/tratamento.service';

const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const tenants = new TenantService(db, { enviar: async () => true } as never);
const empSvc = new EmpregadoService(db as never, {} as never, { exigirVaga: async () => {} } as never);
const marc = new MarcacaoService(db as never, {} as never);
const trat = new TratamentoService(db as never);

let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };

async function main() {
  const { tenant: t } = await tenants.criar({ cnpj: '11222333000181', razaoSocial: 'VIG LTDA', localPrestacao: 'BA', adminEmail: 'a@v.com' });
  // escala A: 8h (08-12/13-17), seg-sex   |  escala B: 9h (08-12/13-18), seg-sex
  const escA = (await trat.criarHorario(t.id, { codigo:'A-8h', durJornadaMin:480, diasSemana:[1,2,3,4,5], pares:[{entrada:'08:00',saida:'12:00'},{entrada:'13:00',saida:'17:00'}] } as never))!;
  const escB = (await trat.criarHorario(t.id, { codigo:'B-9h', durJornadaMin:540, diasSemana:[1,2,3,4,5], pares:[{entrada:'08:00',saida:'12:00'},{entrada:'13:00',saida:'18:00'}] } as never))!;
  const ana = await empSvc.criar(t.id, { cpf:'11222333044', nome:'Ana' } as never);
  await empSvc.definirHorario(t.id, ana.id, escA.id);  // começa na escala A

  // Ana trabalha 08-17 (8h) nos dias 06 e 07/jul, cumprindo a escala A exatamente
  for (const dia of ['2026-07-06','2026-07-07']) {
    for (const hm of ['08:00','12:00','13:00','17:00'])
      await marc.bater({ tenantId:t.id, cpf:'11222333044', coletor:Coletor.DISPOSITIVO, dtMarcacao:new Date(`${dia}T${hm}:00-0300`), declaradoOffline:true });
  }
  // muda pra escala B (9h) a partir de 08/jul
  await trat.mudarEscalaComVigencia(t.id, ana.id, escB.id, '2026-07-08');
  // dias 08 e 09: Ana continua saindo 17h (só 8h), mas agora a escala espera 9h → deve faltar 1h/dia
  for (const dia of ['2026-07-08','2026-07-09']) {
    for (const hm of ['08:00','12:00','13:00','17:00'])
      await marc.bater({ tenantId:t.id, cpf:'11222333044', coletor:Coletor.DISPOSITIVO, dtMarcacao:new Date(`${dia}T${hm}:00-0300`), declaradoOffline:true });
  }

  const ap = await trat.apurarPeriodoCLT(t.id, ana.id, '2026-07-06', '2026-07-09');
  const porDia = new Map(ap.resultado.dias.map((d:any) => [d.data, d]));
  const d06 = porDia.get('2026-07-06'), d07 = porDia.get('2026-07-07');
  const d08 = porDia.get('2026-07-08'), d09 = porDia.get('2026-07-09');

  // dias 06/07 (escala A, 8h esperado, 8h trabalhado) → sem falta
  ok((d06?.faltaMin ?? -1) === 0 && (d07?.faltaMin ?? -1) === 0, `dias na escala A: sem falta (06=${d06?.faltaMin}, 07=${d07?.faltaMin})`);
  ok(d06?.minutosContratados === 480, `dia 06 espera 8h (480min) — veio ${d06?.minutosContratados}`);
  // dias 08/09 (escala B, 9h esperado, 8h trabalhado) → falta ~60min
  ok(d08?.minutosContratados === 540, `dia 08 espera 9h (540min) — veio ${d08?.minutosContratados}`);
  ok((d08?.saldoMin ?? 0) === -60 && (d09?.saldoMin ?? 0) === -60, `dias na escala B: debito 60min por sair 1h cedo (08=${d08?.saldoMin}, 09=${d09?.saldoMin})`);

  // o passado (06/07) NÃO mudou depois da troca — é o ponto central
  ok(d06?.minutosContratados === 480 && d07?.minutosContratados === 480, 'passado preservado: dias antigos seguem na escala A');

  // excluir escala em uso deve falhar
  let bloqueou = false;
  try { await trat.excluirHorario(t.id, escA.id); } catch { bloqueou = true; }
  ok(bloqueou, 'excluir escala em uso é bloqueado');

  // corrigir cadastro: editar a escala B pra 8h48 (528min)
  await trat.atualizarHorario(t.id, escB.id, { durJornadaMin: 528 });
  const ap2 = await trat.apurarPeriodoCLT(t.id, ana.id, '2026-07-08', '2026-07-08');
  ok(ap2.resultado.dias[0]?.minutosContratados === 528, `editar escala reflete na apuração (esperado 528, veio ${ap2.resultado.dias[0]?.minutosContratados})`);

  console.log(falhas===0 ? '\n>>> ESCALA-VIGENCIA OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end(); process.exit(falhas===0?0:1);
}
main().catch(e=>{console.error(e);process.exit(1);});
