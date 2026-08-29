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
  const { tenant:t } = await tenants.criar({ cnpj:'55667788000199', razaoSocial:'IG', localPrestacao:'BA', adminEmail:'a@ig.com' });
  const esc = (await trat.criarHorario(t.id, { codigo:'E', durJornadaMin:540, diasSemana:[1,2,3,4,5], pares:[{entrada:'0800',saida:'1200'},{entrada:'1300',saida:'1800'}] } as never))!;
  const nomes = ['Ana Silva Souza', 'João Pêçanha', 'Maria Coração'];
  const ids: string[] = [];
  for (let i=0;i<3;i++){
    const e = await empSvc.criar(t.id, { cpf:`5566778800${i}`, nome: nomes[i]!, matricula:`00${i+1}` } as never);
    await empSvc.definirHorario(t.id, e.id, esc.id);
    ids.push(e.id);
    // bate ponto num dia (29 = sexta)
    for (const hm of ['08:00','12:00','13:00','18:00'])
      await marc.bater({ tenantId:t.id, cpf:`5566778800${i}`, coletor:Coletor.DISPOSITIVO, dtMarcacao:new Date(`2026-08-29T${hm}:00-0300`), declaradoOffline:true });
  }

  // LOTE dos 3, período 29 a 31 (a estreia!), apuração + espelho
  const zip = await trat.gerarLoteZip(t.id, ids, '2026-08-29', '2026-08-31', { apuracao:true, espelho:true });
  ok(zip.nomeArquivo === 'apuracoes_2026-08-29_a_2026-08-31.zip', `nome do ZIP com período (${zip.nomeArquivo})`);
  ok(zip.buffer.length > 1000, `ZIP tem conteúdo (${zip.buffer.length} bytes)`);

  // abre o ZIP e confere o conteúdo
  const JSZip = (await import('jszip')).default;
  const z = await JSZip.loadAsync(zip.buffer);
  const arquivos = Object.keys(z.files).filter(f => !z.files[f]!.dir);
  console.log('  arquivos no ZIP:', arquivos.length);
  arquivos.forEach(f => console.log('    -', f));
  // 3 funcionários × 2 docs = 6 PDFs
  ok(arquivos.length === 6, `6 PDFs no ZIP (3 func × 2 docs) — veio ${arquivos.length}`);
  ok(arquivos.some(f => f.includes('Ana-Silva-Souza')), 'PDF nomeado com nome do funcionário (Ana)');
  ok(arquivos.some(f => f.includes('Joao-Pecanha')), 'acentos tratados no nome (João→Joao)');
  ok(arquivos.every(f => f.endsWith('.pdf')), 'todos são PDFs');
  ok(arquivos.some(f => f.includes('apuracao') && arquivos.some(g => g.includes('espelho'))), 'tem apuração E espelho');

  // só apuração (espelho off)
  const zip2 = await trat.gerarLoteZip(t.id, ids, '2026-08-29', '2026-08-31', { apuracao:true, espelho:false });
  const z2 = await JSZip.loadAsync(zip2.buffer);
  const arqs2 = Object.keys(z2.files).filter(f => !z2.files[f]!.dir);
  ok(arqs2.length === 3 && arqs2.every(f => f.includes('apuracao')), `só apuração = 3 PDFs (veio ${arqs2.length})`);

  console.log(falhas===0?'\n>>> APURACAO-LOTE OK <<<':`\n>>> ${falhas} FALHA(S) <<<`);
  await client.end(); process.exit(falhas===0?0:1);
}
main().catch(e=>{console.error(e);process.exit(1);});
