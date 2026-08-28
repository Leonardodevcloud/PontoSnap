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
const empSvc = new EmpregadoService(db as never, {} as never);
const trat = new TratamentoService(db as never);
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c?'OK  ':'FALHA'} — ${m}`); };

async function main() {
  const { tenant:t } = await tenants.criar({ cnpj:'44556677000188', razaoSocial:'IG', localPrestacao:'BA', adminEmail:'a@ig.com' });
  // escala que trabalha seg-sex 08:00 (entrada cedo, já passou)
  const cedo = (await trat.criarHorario(t.id, { codigo:'CEDO', durJornadaMin:480, diasSemana:[1,2,3,4,5], pares:[{entrada:'0800',saida:'1200'},{entrada:'1300',saida:'1700'}] } as never))!;
  // escala que trabalha só sábado (não trabalha hoje se hoje for dia útil)
  const soSab = (await trat.criarHorario(t.id, { codigo:'SAB', durJornadaMin:240, diasSemana:[6], pares:[{entrada:'0800',saida:'1200'}] } as never))!;
  // escala com entrada muito tarde (23:00 — ainda não venceu)
  const tarde = (await trat.criarHorario(t.id, { codigo:'TARDE', durJornadaMin:480, diasSemana:[0,1,2,3,4,5,6], pares:[{entrada:'2300',saida:'2359'}] } as never))!;

  // 3 funcionários: um cobra (cedo), um sem jornada hoje (só sáb), um no prazo (tarde)
  const a = await empSvc.criar(t.id, { cpf:'44556677001', nome:'Ana Cobra' } as never);
  const b = await empSvc.criar(t.id, { cpf:'44556677002', nome:'Bia SoSab' } as never);
  const c = await empSvc.criar(t.id, { cpf:'44556677003', nome:'Cid Tarde' } as never);
  await empSvc.definirHorario(t.id, a.id, cedo.id);
  await empSvc.definirHorario(t.id, b.id, soSab.id);
  await empSvc.definirHorario(t.id, c.id, tarde.id);

  const p = await trat.painel(t.id);
  console.log(`  ausentes=${p.ausentes} | naoBateram=${p.pendencias.naoBateramTotal} | noPrazo=${p.pendencias.noPrazo} | folga=${p.pendencias.folgaHoje} | semJornada=${p.pendencias.semJornadaHoje}`);

  // os 3 estão ausentes (ninguém bateu)
  ok(p.ausentes === 3, `3 ausentes (veio ${p.ausentes})`);
  // a soma das categorias deve fechar com os ausentes: naoBateram + noPrazo + folga + semJornada = ausentes
  const soma = p.pendencias.naoBateramTotal + (p.pendencias.noPrazo??0) + (p.pendencias.folgaHoje??0) + (p.pendencias.semJornadaHoje??0);
  ok(soma === p.ausentes, `categorias somam os ausentes (${soma} = ${p.ausentes})`);
  // Bia (só sáb) deve estar em semJornadaHoje se hoje não for sábado
  const hoje = new Date().getDay(); // 0=dom..6=sab
  if (hoje !== 6) ok((p.pendencias.semJornadaHoje??0) >= 1, `quem só trabalha sáb está fora da cobrança hoje`);
  else ok(true, 'hoje é sábado, pulando checagem de Bia');

  console.log(falhas===0?'\n>>> PAINEL-CATEGORIAS OK <<<':`\n>>> ${falhas} FALHA(S) <<<`);
  await client.end(); process.exit(falhas===0?0:1);
}
main().catch(e=>{console.error(e);process.exit(1);});
