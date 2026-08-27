import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema } from '@ponto/db';
import { TenantService } from '../src/tenant/tenant.service';
import { EmpregadoService } from '../src/empregado/empregado.service';
import { BancoService } from '../src/banco/banco.service';

const client = postgres({ host: process.env.PGSOCKET!, database:'postgres', user:'app_user', password:'x', max:5 });
const db = drizzle(client, { schema });
const tenants = new TenantService(db, { enviar: async()=>true } as never);
const empSvc = new EmpregadoService(db as never, {} as never);
const banco = new BancoService(db as never, {} as never);
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c?'OK  ':'FALHA'} — ${m}`); };
const hoje = '2026-08-28';

async function main() {
  const { tenant:t } = await tenants.criar({ cnpj:'33444555000122', razaoSocial:'IG', localPrestacao:'BA', adminEmail:'a@ig.com' });
  // ativa banco de horas na empresa (individual, 6 meses)
  await banco.definirConfig(t.id, { tipoAcordo:'INDIVIDUAL', prazoMeses:6 });

  const joao = await empSvc.criar(t.id, { cpf:'33444555011', nome:'Joao' } as never);
  const maria = await empSvc.criar(t.id, { cpf:'33444555022', nome:'Maria' } as never);

  // João trazia +12h30 = 750min (a favor)
  await banco.lancarMovimento(t.id, { empregadoId: joao.id, data: hoje, minutos: 750, tipo:'AJUSTE', descricao:'Saldo importado do sistema anterior' });
  // Maria devia 3h = -180min (devendo)
  await banco.lancarMovimento(t.id, { empregadoId: maria.id, data: hoje, minutos: -180, tipo:'AJUSTE', descricao:'Saldo importado do sistema anterior' });

  const sJoao = await banco.saldo(t.id, joao.id, '2026-08-29');
  const sMaria = await banco.saldo(t.id, maria.id, '2026-08-29');

  ok(sJoao.saldo?.saldoMin === 750, `João: saldo +12h30 (750min) — veio ${sJoao.saldo?.saldoMin}`);
  ok(sMaria.saldo?.saldoMin === -180, `Maria: saldo -3h (-180min) — veio ${sMaria.saldo?.saldoMin}`);

  // o extrato mostra a descrição de migração?
  const temDescr = sJoao.extrato?.some((m:any) => m.descricao?.includes('sistema anterior'));
  ok(!!temDescr, 'extrato mostra "Saldo importado do sistema anterior"');

  // banco inativo bloqueia? cria outra empresa sem banco
  const { tenant:t2 } = await tenants.criar({ cnpj:'33444555000203', razaoSocial:'SEM', localPrestacao:'BA', adminEmail:'b@x.com' });
  const p = await empSvc.criar(t2.id, { cpf:'33444555033', nome:'Pedro' } as never);
  let bloqueou = false;
  try { await banco.lancarMovimento(t2.id, { empregadoId: p.id, data: hoje, minutos: 60, tipo:'AJUSTE', descricao:'x' }); }
  catch { bloqueou = true; }
  ok(bloqueou, 'banco inativo bloqueia lançamento (mensagem clara pro RH)');

  console.log(falhas===0?'\n>>> SALDO-ABERTURA OK <<<':`\n>>> ${falhas} FALHA(S) <<<`);
  await client.end(); process.exit(falhas===0?0:1);
}
main().catch(e=>{console.error(e);process.exit(1);});
