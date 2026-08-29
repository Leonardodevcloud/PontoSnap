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

// hoje no fuso -0300 (Brasília), como a apuração calcula
const hoje = new Date(Date.now() - 3*3600*1000).toISOString().slice(0,10);
const ano = new Date().getFullYear();

async function main() {
  const { tenant:t } = await tenants.criar({ cnpj:'10101010000155', razaoSocial:'IG', localPrestacao:'BA', adminEmail:'a@ig.com' });
  const esc = (await trat.criarHorario(t.id, { codigo:'E', durJornadaMin:540, diasSemana:[0,1,2,3,4,5,6], pares:[{entrada:'0800',saida:'1200'},{entrada:'1300',saida:'1800'}] } as never))!;
  const ana = await empSvc.criar(t.id, { cpf:'10101010011', nome:'Ana' } as never);
  await empSvc.definirHorario(t.id, ana.id, esc.id);

  // CENÁRIO 1: apura um período que vai de ontem até +5 dias no futuro, SEM batidas
  const d = (offset:number) => { const x=new Date(Date.now() - 3*3600*1000); x.setUTCDate(x.getUTCDate()+offset); return x.toISOString().slice(0,10); };
  const ap = await trat.apurarPeriodoCLT(t.id, ana.id, d(-2), d(5));
  const datas = ap.resultado.dias.map((x:any)=>x.data);
  console.log('  período', d(-2), 'a', d(5), '→ dias apurados:', datas.join(', '));
  ok(!datas.some((x:string)=>x >= hoje), 'nenhum dia de hoje ou futuro entra na apuração');
  ok(datas.includes(d(-2)) && datas.includes(d(-1)), 'dias passados (ontem, anteontem) entram');

  // CENÁRIO 2: mês passado (todo no passado) — apura NORMAL, sem cortar nada
  const mesPassadoIni = `${ano}-${String(new Date().getMonth()).padStart(2,'0')}-01`;
  // usa julho fixo se estamos em ago+; senão só garante passado
  const jIni = '2020-07-01', jFim = '2020-07-31';
  const apPassado = await trat.apurarPeriodoCLT(t.id, ana.id, jIni, jFim);
  const diasP = apPassado.resultado.dias.map((x:any)=>x.data);
  ok(diasP.length === 31, `mês totalmente no passado apura todos os 31 dias (veio ${diasP.length})`);
  ok(apPassado.resultado.totalFaltaMin > 0, 'mês passado sem batidas gera faltas (comportamento normal preservado)');

  console.log(falhas===0?'\n>>> APURACAO-DIA-FUTURO OK <<<':`\n>>> ${falhas} FALHA(S) <<<`);
  await client.end(); process.exit(falhas===0?0:1);
}
main().catch(e=>{console.error(e);process.exit(1);});
