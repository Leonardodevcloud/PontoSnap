import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema } from '@ponto/db';
import { TenantService } from '../src/tenant/tenant.service';
import { EmpregadoService } from '../src/empregado/empregado.service';
import { TratamentoService } from '../src/tratamento/tratamento.service';

const client = postgres({ host: process.env.PGSOCKET!, database:'postgres', user:'app_user', password:'x', max:5 });
const db = drizzle(client, { schema });
const tenants = new TenantService(db, { enviar: async()=>true } as never);
const empSvc = new EmpregadoService(db as never, {} as never, { exigirVaga: async () => {} } as never);
const trat = new TratamentoService(db as never);
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c?'OK  ':'FALHA'} — ${m}`); };

async function main() {
  const { tenant:t } = await tenants.criar({ cnpj:'88990011000133', razaoSocial:'IG', localPrestacao:'BA', adminEmail:'a@ig.com' });
  // escala todos os dias com entrada bem cedo (pra garantir que "já passou" hoje)
  const esc = (await trat.criarHorario(t.id, { codigo:'E', durJornadaMin:480, diasSemana:[0,1,2,3,4,5,6], pares:[{entrada:'0001',saida:'1200'}] } as never))!;

  // data de início bem no futuro (ninguém deve ser cobrado)
  const futuro = '2099-01-01';
  const a = await empSvc.criar(t.id, { cpf:'88990011001', nome:'Ana Futuro', dataInicioPonto: futuro } as never);
  await empSvc.definirHorario(t.id, a.id, esc.id);
  // funcionário normal, sem data → deve ser cobrado (não bateu, passou do horário)
  const b = await empSvc.criar(t.id, { cpf:'88990011002', nome:'Bia Normal' } as never);
  await empSvc.definirHorario(t.id, b.id, esc.id);

  const p = await trat.painel(t.id);
  console.log(`  ausentes=${p.ausentes} | naoBateram=${p.pendencias.naoBateramTotal} | aindaNaoIniciou=${p.pendencias.aindaNaoIniciou}`);

  // Ana (início 2099) NÃO deve estar em naoBateram
  const nomesNaoBateram = p.pendencias.naoBateram.map((x:any)=>x.nome);
  ok(!nomesNaoBateram.some((n:string)=>n.includes('Ana')), 'quem tem início no futuro NÃO é cobrado no painel');
  ok((p.pendencias.aindaNaoIniciou ?? 0) >= 1, `Ana aparece em "ainda não iniciou" (${p.pendencias.aindaNaoIniciou})`);
  // Bia (sem data) DEVE ser cobrada
  ok(nomesNaoBateram.some((n:string)=>n.includes('Bia')), 'funcionário sem data continua sendo cobrado');

  // soma das categorias fecha com ausentes
  const soma = p.pendencias.naoBateramTotal + (p.pendencias.noPrazo??0) + (p.pendencias.folgaHoje??0) + (p.pendencias.semJornadaHoje??0) + (p.pendencias.aindaNaoIniciou??0);
  ok(soma === p.ausentes, `categorias somam ausentes (${soma} = ${p.ausentes})`);

  console.log(falhas===0?'\n>>> PAINEL-INICIO OK <<<':`\n>>> ${falhas} FALHA(S) <<<`);
  await client.end(); process.exit(falhas===0?0:1);
}
main().catch(e=>{console.error(e);process.exit(1);});
