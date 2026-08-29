import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema } from '@ponto/db';
import { Coletor } from '@ponto/shared';
import { TenantService } from '../src/tenant/tenant.service';
import { EmpregadoService } from '../src/empregado/empregado.service';
import { MarcacaoService } from '../src/marcacao/marcacao.service';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { AjusteService } from '../src/ajuste/ajuste.service';

const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const tenants = new TenantService(db, { enviar: async () => true } as never);
const empSvc = new EmpregadoService(db as never, {} as never, { exigirVaga: async () => {} } as never);
const marc = new MarcacaoService(db as never, {} as never);
const trat = new TratamentoService(db as never);
const ajuste = new AjusteService(db as never, { enviar: async () => true } as never);

let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };
const temPdf = (b: Buffer) => b.subarray(0, 4).toString('latin1') === '%PDF';

async function main() {
  const { tenant: t } = await tenants.criar({
    cnpj: '70000000000103', razaoSocial: 'ESPELHO LTDA', localPrestacao: 'Salvador/BA',
    adminEmail: 'admin@espelho.com.br',
  });
  const horario = (await trat.criarHorario(t.id, { codigo: 'ADM', descricao: 'Comercial', durJornadaMin: 480,
    diasSemana: [1, 2, 3, 4, 5], pares: [{ entrada: '08:00', saida: '12:00' }, { entrada: '13:00', saida: '17:00' }] } as never))!;
  const ana = await empSvc.criar(t.id, { cpf: '70000000001', nome: 'Ana Ribeiro' } as never);
  await empSvc.definirHorario(t.id, ana.id, horario.id);

  // dia 1: normal com 1h extra. dia 2: esqueceu a saída (ímpar).
  for (const hm of ['08:00', '12:00', '13:00', '18:00']) {
    await marc.bater({ tenantId: t.id, cpf: '70000000001', coletor: Coletor.DISPOSITIVO,
      dtMarcacao: new Date(`2026-07-13T${hm}:00-0300`), declaradoOffline: true });
  }
  await marc.bater({ tenantId: t.id, cpf: '70000000001', coletor: Coletor.DISPOSITIVO,
    dtMarcacao: new Date('2026-07-14T08:00:00-0300'), declaradoOffline: true });

  // RH inclui a saída faltante do dia 14 via ajuste (solicita como RH e aprova)
  // Solicitado pelo RH já entra aprovado.
  await ajuste.solicitar(t.id, {
    empregadoId: ana.id, tipo: 'INCLUSAO', data: '2026-07-14',
    hora: '17:00', tpMarc: 'S', observacao: 'Esqueceu de bater a saída',
  }, 'RH');

  const { buffer, nomeArquivo } = await trat.gerarEspelhoPdf(t.id, ana.id, '2026-07-01', '2026-07-31');
  ok(temPdf(buffer), `espelho gera PDF válido (${buffer.length} bytes)`);
  ok(nomeArquivo.startsWith('espelho_') && nomeArquivo.endsWith('.pdf'), `nome do arquivo (${nomeArquivo})`);
  ok(buffer.length > 3000, 'PDF tem conteúdo (mês inteiro)');

  // versão com carimbo de assinatura eletrônica
  const assinado = await trat.gerarEspelhoPdf(t.id, ana.id, '2026-07-01', '2026-07-31', {
    nome: 'Ana Ribeiro', cpf: '70000000001', em: '06/08/2026 09:42', via: 'PIN no app + auditoria',
    hashDocumento: 'a3f9b8c21b7e029d14', referencia: 'A7F291',
  });
  ok(temPdf(assinado.buffer), 'espelho com carimbo de assinatura também gera PDF');
  ok(assinado.buffer.length !== buffer.length, 'a versão assinada difere da não assinada (carimbo entrou)');

  console.log(falhas === 0 ? '\n>>> ESPELHO OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
