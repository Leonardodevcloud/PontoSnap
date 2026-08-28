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
  const { tenant:t } = await tenants.criar({ cnpj:'66778899000122', razaoSocial:'IG', localPrestacao:'BA', adminEmail:'a@ig.com' });
  const esc = (await trat.criarHorario(t.id, { codigo:'E', durJornadaMin:540, diasSemana:[1,2,3,4,5], pares:[{entrada:'0800',saida:'1200'},{entrada:'1300',saida:'1800'}] } as never))!;

  // Funcionário com data de início 29/08 (a estreia da empresa)
  const ana = await empSvc.criar(t.id, { cpf:'66778899011', nome:'Ana', dataInicioPonto:'2026-08-29' } as never);
  await empSvc.definirHorario(t.id, ana.id, esc.id);

  // bate certinho nos dias 31/08 (segunda). 29=sáb, 30=dom, 31=seg
  for (const hm of ['08:00','12:00','13:00','18:00'])
    await marc.bater({ tenantId:t.id, cpf:'66778899011', coletor:Coletor.DISPOSITIVO, dtMarcacao:new Date(`2026-08-31T${hm}:00-0300`), declaradoOffline:true });

  // APURA AGOSTO INTEIRO (01 a 31) — mas só deve contar de 29 em diante
  const ap = await trat.apurarPeriodoCLT(t.id, ana.id, '2026-08-01', '2026-08-31');
  const datas = ap.resultado.dias.map((d:any) => d.data);
  const menorData = datas.sort()[0];

  ok(menorData >= '2026-08-29', `apuração começa em 29/08 ou depois (menor dia: ${menorData})`);
  ok(!datas.includes('2026-08-03'), 'dia 03/08 (antes do início) NÃO aparece na apuração');
  ok(!datas.includes('2026-08-28'), 'dia 28/08 (véspera do início) NÃO aparece');
  ok(datas.includes('2026-08-31'), 'dia 31/08 (depois do início) aparece');

  // sem falta nos dias úteis antes de 29 (porque nem existem)
  const totalFalta = ap.resultado.dias.reduce((s:number,d:any)=>s+(d.faltaMin??0),0);
  ok(totalFalta === 0, `nenhuma falta fantasma dos dias 01-28 (total falta: ${totalFalta})`);

  // COMPARAÇÃO: um funcionário SEM data de início apura o mês todo (comportamento antigo)
  const bia = await empSvc.criar(t.id, { cpf:'66778899022', nome:'Bia' } as never); // sem dataInicioPonto
  await empSvc.definirHorario(t.id, bia.id, esc.id);
  const apBia = await trat.apurarPeriodoCLT(t.id, bia.id, '2026-08-01', '2026-08-31');
  ok(apBia.resultado.dias.some((d:any)=>d.data==='2026-08-03'), 'funcionário SEM data de início: apura mês todo (compat)');

  // definir data depois (editar): Bia passa a valer de 15/08
  await empSvc.definirDataInicioPonto(t.id, bia.id, '2026-08-15');
  const apBia2 = await trat.apurarPeriodoCLT(t.id, bia.id, '2026-08-01', '2026-08-31');
  ok(!apBia2.resultado.dias.some((d:any)=>d.data==='2026-08-03'), 'após editar: dia 03 some');
  ok(apBia2.resultado.dias.some((d:any)=>d.data==='2026-08-17'), 'após editar: dia 17 (depois de 15) aparece');

  console.log(falhas===0?'\n>>> DATA-INICIO-PONTO OK <<<':`\n>>> ${falhas} FALHA(S) <<<`);
  await client.end(); process.exit(falhas===0?0:1);
}
main().catch(e=>{console.error(e);process.exit(1);});
