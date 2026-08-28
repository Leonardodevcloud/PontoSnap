import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema } from '@ponto/db';
import { eq, and } from 'drizzle-orm';
import { TenantService } from '../src/tenant/tenant.service';
import { EmpregadoService } from '../src/empregado/empregado.service';
import { BancoService } from '../src/banco/banco.service';
import { TratamentoService } from '../src/tratamento/tratamento.service';

const client = postgres({ host: process.env.PGSOCKET!, database:'postgres', user:'app_user', password:'x', max:5 });
const db = drizzle(client, { schema });
const tenants = new TenantService(db, { enviar: async()=>true } as never);
const empSvc = new EmpregadoService(db as never, {} as never);
const trat = new TratamentoService(db as never);
const banco = new BancoService(db as never, trat as never);
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c?'OK  ':'FALHA'} — ${m}`); };
const hoje = '2026-08-27';

async function main() {
  const { tenant:t } = await tenants.criar({ cnpj:'77889900000111', razaoSocial:'IG', localPrestacao:'BA', adminEmail:'a@ig.com' });
  await banco.definirConfig(t.id, { tipoAcordo:'INDIVIDUAL', prazoMeses:6 });
  const esc = (await trat.criarHorario(t.id, { codigo:'E', durJornadaMin:540, diasSemana:[1,2,3,4,5], pares:[{entrada:'0800',saida:'1200'},{entrada:'1300',saida:'1800'}] } as never))!;
  const vittor = await empSvc.criar(t.id, { cpf:'77889900011', nome:'Vittor' } as never);
  await empSvc.definirHorario(t.id, vittor.id, esc.id);

  // registra folga sem informar horas → usa a jornada (9h = 540min) → -540
  await banco.registrarFolga(t.id, vittor.id, hoje, null);
  const s1 = await banco.saldo(t.id, vittor.id, '2026-08-28');
  ok(s1.saldo?.saldoMin === -540, `após folga: saldo -9h/-540min (veio ${s1.saldo?.saldoMin})`);
  // a ausência tipo 4 foi criada?
  const { comoMaster } = await import('@ponto/db');
  const aus1 = await comoMaster(db, (tx) => tx.select().from(schema.pontoAusencia).where(and(eq(schema.pontoAusencia.empregadoId, vittor.id), eq(schema.pontoAusencia.tipo, 4))));
  ok(aus1.length === 1, `ausência de folga criada (${aus1.length})`);

  // acha o id do movimento de folga no extrato
  const movFolga = s1.saldo && s1.extrato.find((m:any) => m.descricao === 'Folga compensatória');
  ok(!!(movFolga as any)?.id, `extrato traz o id do movimento (${(movFolga as any)?.id?.slice(0,8)}…)`);

  // REMOVE
  await banco.removerMovimento(t.id, (movFolga as any).id);
  const s2 = await banco.saldo(t.id, vittor.id, '2026-08-28');
  ok((s2.saldo?.saldoMin ?? -1) === 0, `após remover: saldo volta a 0 (veio ${s2.saldo?.saldoMin})`);
  // a ausência tipo 4 também sumiu?
  const aus2 = await comoMaster(db, (tx) => tx.select().from(schema.pontoAusencia).where(and(eq(schema.pontoAusencia.empregadoId, vittor.id), eq(schema.pontoAusencia.tipo, 4))));
  ok(aus2.length === 0, `ausência de folga também removida (${aus2.length})`);

  // remover lançamento de fechamento de competência deve ser bloqueado.
  // Insere direto com competência (é assim que o fechamento de mês grava).
  const movCompId = crypto.randomUUID();
  await comoMaster(db, (tx) => tx.insert(schema.pontoBancoMov).values({ id: movCompId, tenantId: t.id, empregadoId: vittor.id, data: hoje, minutos: 100, tipo:'CREDITO', descricao:'Competência 2026-08', competencia:'2026-08' } as never));
  let bloqueou = false;
  try { await banco.removerMovimento(t.id, movCompId); } catch { bloqueou = true; }
  ok(bloqueou, 'lançamento de competência não pode ser removido avulso (bloqueado)');

  console.log(falhas===0?'\n>>> REMOVER-MOVIMENTO OK <<<':`\n>>> ${falhas} FALHA(S) <<<`);
  await client.end(); process.exit(falhas===0?0:1);
}
main().catch(e=>{console.error(e);process.exit(1);});
