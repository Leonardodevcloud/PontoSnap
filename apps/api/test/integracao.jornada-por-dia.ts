import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema } from '@ponto/db';
import { Coletor } from '@ponto/shared';
import { TenantService } from '../src/tenant/tenant.service';
import { EmpregadoService } from '../src/empregado/empregado.service';
import { MarcacaoService } from '../src/marcacao/marcacao.service';
import { TratamentoService } from '../src/tratamento/tratamento.service';

const client = postgres({ host: process.env.PGSOCKET!, database:'postgres', user:'app_user', password:'x', max:5 });
const db = drizzle(client, { schema });
const tenants = new TenantService(db, { enviar: async()=>true } as never);
const empSvc = new EmpregadoService(db as never, {} as never);
const marc = new MarcacaoService(db as never, {} as never);
const trat = new TratamentoService(db as never);
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c?'OK  ':'FALHA'} — ${m}`); };

async function main() {
  const { tenant:t } = await tenants.criar({ cnpj:'99888777000191', razaoSocial:'IG', localPrestacao:'BA', adminEmail:'a@ig.com' });

  // MILLANO: seg-sex 9h (540), sábado 4h (240), domingo folga.
  // dias 1..5 = seg..sex, 6 = sáb. jornadaPorDia usa 0=dom..6=sáb.
  const millano = (await trat.criarHorario(t.id, {
    codigo:'Millano', durJornadaMin:540,
    diasSemana:[1,2,3,4,5,6], // trabalha seg a sáb
    pares:[{entrada:'08:00',saida:'12:00'},{entrada:'13:00',saida:'18:00'}],
    jornadaPorDia: { '1':540,'2':540,'3':540,'4':540,'5':540, '6':240 }, // sáb 4h
  } as never))!;
  const joao = await empSvc.criar(t.id, { cpf:'99888777011', nome:'Joao' } as never);
  await empSvc.definirHorario(t.id, joao.id, millano.id);

  // 2026-07-10 é SEXTA, 2026-07-11 é SÁBADO. Confirma:
  // (jul/2026: dia 10 = sexta, dia 11 = sábado)
  // João cumpre certinho: sexta 9h (08-12/13-18), sábado 4h (08-12)
  for (const hm of ['08:00','12:00','13:00','18:00'])
    await marc.bater({ tenantId:t.id, cpf:'99888777011', coletor:Coletor.DISPOSITIVO, dtMarcacao:new Date(`2026-07-10T${hm}:00-0300`), declaradoOffline:true });
  for (const hm of ['08:00','12:00'])
    await marc.bater({ tenantId:t.id, cpf:'99888777011', coletor:Coletor.DISPOSITIVO, dtMarcacao:new Date(`2026-07-11T${hm}:00-0300`), declaradoOffline:true });

  const ap = await trat.apurarPeriodoCLT(t.id, joao.id, '2026-07-10', '2026-07-11');
  const porData = new Map(ap.resultado.dias.map((d:any)=>[d.data,d]));
  const sexta = porData.get('2026-07-10'), sabado = porData.get('2026-07-11');

  ok(sexta?.minutosContratados === 540, `SEXTA espera 9h/540min (veio ${sexta?.minutosContratados})`);
  ok(sabado?.minutosContratados === 240, `SÁBADO espera 4h/240min — jornada por dia! (veio ${sabado?.minutosContratados})`);
  ok((sexta?.faltaMin ?? 1) === 0 && (sexta?.saldoMin ?? 1) === 0, `sexta sem falta/saldo (cumpriu 9h)`);
  ok((sabado?.faltaMin ?? 1) === 0 && (sabado?.saldoMin ?? 1) === 0, `sábado sem falta/saldo (4h, sem desvio falso)`);

  // COMPATIBILIDADE: escala SEM jornadaPorDia continua com jornada única
  const simples = (await trat.criarHorario(t.id, {
    codigo:'Simples8h', durJornadaMin:480, diasSemana:[1,2,3,4,5],
    pares:[{entrada:'08:00',saida:'12:00'},{entrada:'13:00',saida:'17:00'}],
    // sem jornadaPorDia
  } as never))!;
  const maria = await empSvc.criar(t.id, { cpf:'99888777022', nome:'Maria' } as never);
  await empSvc.definirHorario(t.id, maria.id, simples.id);
  for (const hm of ['08:00','12:00','13:00','17:00'])
    await marc.bater({ tenantId:t.id, cpf:'99888777022', coletor:Coletor.DISPOSITIVO, dtMarcacao:new Date(`2026-07-10T${hm}:00-0300`), declaradoOffline:true });
  const ap2 = await trat.apurarPeriodoCLT(t.id, maria.id, '2026-07-10','2026-07-10');
  ok(ap2.resultado.dias[0]?.minutosContratados === 480, `escala sem jornadaPorDia: mantém 8h (compat) — veio ${ap2.resultado.dias[0]?.minutosContratados}`);

  console.log(falhas===0?'\n>>> JORNADA-POR-DIA OK <<<':`\n>>> ${falhas} FALHA(S) <<<`);
  await client.end(); process.exit(falhas===0?0:1);
}
main().catch(e=>{console.error(e);process.exit(1);});
