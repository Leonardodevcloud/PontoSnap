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
const empSvc = new EmpregadoService(db as never, {} as never, { exigirVaga: async () => {} } as never);
const marc = new MarcacaoService(db as never, {} as never);
const trat = new TratamentoService(db as never);
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c?'OK  ':'FALHA'} — ${m}`); };

async function main() {
  const { tenant:t } = await tenants.criar({ cnpj:'66778899000122', razaoSocial:'IG', localPrestacao:'BA', adminEmail:'a@ig.com' });
  const esc = (await trat.criarHorario(t.id, { codigo:'E', durJornadaMin:540, diasSemana:[1,2,3,4,5], pares:[{entrada:'0800',saida:'1200'},{entrada:'1300',saida:'1800'}] } as never))!;

  // Funcionário com data de início 29/08 (a estreia da empresa)
  const ana = await empSvc.criar(t.id, { cpf:'66778899011', nome:'Ana', dataInicioPonto:'2020-07-15' } as never);
  await empSvc.definirHorario(t.id, ana.id, esc.id);

  // bate certinho nos dias 31/08 (segunda). 29=sáb, 30=dom, 31=seg
  for (const hm of ['08:00','12:00','13:00','18:00'])
    await marc.bater({ tenantId:t.id, cpf:'66778899011', coletor:Coletor.DISPOSITIVO, dtMarcacao:new Date(`2026-08-31T${hm}:00-0300`), declaradoOffline:true });

  // APURA AGOSTO INTEIRO (01 a 31) — mas só deve contar de 29 em diante
  const ap = await trat.apurarPeriodoCLT(t.id, ana.id, '2020-07-01', '2020-07-31');
  const datas = ap.resultado.dias.map((d:any) => d.data);
  const menorData = datas.sort()[0];

  ok(menorData >= '2020-07-15', `apuração começa em 15/07 ou depois (menor dia: ${menorData})`);
  ok(!datas.includes('2020-07-03'), 'dia 03/07 (antes do início) NÃO aparece na apuração');
  ok(!datas.includes('2020-07-14'), 'dia 14/07 (véspera do início) NÃO aparece');
  ok(datas.includes('2020-07-31'), 'dia 31/07 (depois do início) aparece');

  // nenhum dia ANTES de 15/07 aparece (logo, não há falta fantasma do período pré-início)
  const diasAntes = ap.resultado.dias.filter((d:any)=>d.data < '2020-07-15');
  ok(diasAntes.length === 0, `nenhum dia antes do início entra (${diasAntes.length} dias pré-15)`);

  // COMPARAÇÃO: um funcionário SEM data de início apura o mês todo (comportamento antigo)
  const bia = await empSvc.criar(t.id, { cpf:'66778899022', nome:'Bia' } as never); // sem dataInicioPonto
  await empSvc.definirHorario(t.id, bia.id, esc.id);
  const apBia = await trat.apurarPeriodoCLT(t.id, bia.id, '2020-07-01', '2020-07-31');
  ok(apBia.resultado.dias.some((d:any)=>d.data==='2020-07-03'), 'funcionário SEM data de início: apura mês todo (compat)');

  // definir data depois (editar): Bia passa a valer de 15/08
  await empSvc.definirDataInicioPonto(t.id, bia.id, '2020-07-15');
  const apBia2 = await trat.apurarPeriodoCLT(t.id, bia.id, '2020-07-01', '2020-07-31');
  ok(!apBia2.resultado.dias.some((d:any)=>d.data==='2020-07-03'), 'após editar: dia 03 some');
  ok(apBia2.resultado.dias.some((d:any)=>d.data==='2020-07-17'), 'após editar: dia 17 (depois de 15) aparece');

  console.log(falhas===0?'\n>>> DATA-INICIO-PONTO OK <<<':`\n>>> ${falhas} FALHA(S) <<<`);
  await client.end(); process.exit(falhas===0?0:1);
}
main().catch(e=>{console.error(e);process.exit(1);});
