import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema, comoMaster, tenant, empregado } from '@ponto/db';
import { CctService } from '../src/cct/cct.service';
import { ConvencaoService } from '../src/convencao/convencao.service';
import { EmpregadoService } from '../src/empregado/empregado.service';

const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const cctSvc = new CctService(db);
const conv = new ConvencaoService(db, cctSvc);

let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };

async function main() {
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: '88888888000188', razaoSocial: 'CONV LTDA' }).returning()))[0]!;

  const c1 = await conv.criar(t.id, { nome: 'CCT Rodoviários RS', sindicato: 'SINDICARGA', uf: 'RS', vigencia: '2025/26' } as never);
  ok(!!c1 && c1.nome === 'CCT Rodoviários RS', 'convenção criada');

  const comPdf = await conv.criar(t.id, { nome: 'Com PDF', pdfNome: 'cct.pdf', pdfBase64: 'JVBERi0x' } as never);

  const lista = await conv.listar(t.id);
  ok(lista.length === 2, `listagem traz as duas (${lista.length})`);
  ok(lista.find((x) => x.id === comPdf!.id)?.temPdf === true, 'convenção com PDF marca temPdf');
  ok(lista.find((x) => x.id === c1!.id)?.temPdf === false, 'convenção sem PDF não marca temPdf');
  ok(lista.every((x) => x.funcionarios === 0), 'ninguém vinculado ainda');

  // gerar regra sem PDF deve recusar
  let recusou = false;
  try { await conv.gerarRegra(t.id, c1!.id); } catch { recusou = true; }
  ok(recusou, 'gerar regra sem PDF é recusado');

  // vínculo por funcionário (convencaoId)
  const emp = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: '80000000001', nome: 'Fulano' }).returning()))[0]!;
  const empSvc = new EmpregadoService(db as never, {} as never);
  await empSvc.definirConvencao(t.id, emp.id, comPdf!.id);
  const lista2 = await conv.listar(t.id);
  ok(lista2.find((x) => x.id === comPdf!.id)?.funcionarios === 1, 'listagem conta o funcionário vinculado');

  await conv.remover(t.id, c1!.id);
  ok((await conv.listar(t.id)).length === 1, 'remoção funciona quando ninguém usa');

  console.log(falhas === 0 ? '\n>>> CONVENCAO OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
