import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema } from '@ponto/db';
import { Coletor } from '@ponto/shared';
import { TenantService } from '../src/tenant/tenant.service';
import { EmpregadoService } from '../src/empregado/empregado.service';
import { MarcacaoService } from '../src/marcacao/marcacao.service';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { EspelhoAssinaturaService } from '../src/espelho-assinatura/espelho-assinatura.service';

const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const tenants = new TenantService(db, { enviar: async () => true } as never);
const empSvc = new EmpregadoService(db as never, {} as never, { exigirVaga: async () => {} } as never);
const marc = new MarcacaoService(db as never, {} as never);
const trat = new TratamentoService(db as never);
const svc = new EspelhoAssinaturaService(db as never, trat);

let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };

async function main() {
  const { tenant: t } = await tenants.criar({ cnpj: '72000000000105', razaoSocial: 'ASSIN LTDA', localPrestacao: 'Salvador/BA', adminEmail: 'a@as.com' });
  const horario = (await trat.criarHorario(t.id, { codigo: 'ADM', descricao: 'Com', durJornadaMin: 480, diasSemana: [1,2,3,4,5], pares: [{entrada:'08:00',saida:'12:00'},{entrada:'13:00',saida:'17:00'}] } as never))!;
  const ana = await empSvc.criar(t.id, { cpf: '72000000001', nome: 'Ana Ribeiro' } as never);
  await empSvc.definirHorario(t.id, ana.id, horario.id);
  await empSvc.definirPin(t.id, ana.id, '4321');

  for (const hm of ['08:00','12:00','13:00','17:00']) {
    await marc.bater({ tenantId: t.id, cpf: '72000000001', coletor: Coletor.DISPOSITIVO, dtMarcacao: new Date(`2026-07-13T${hm}:00-0300`), declaradoOffline: true });
  }

  // status antes de assinar
  const s0 = await svc.status(t.id, ana.id, '2026-07');
  ok(s0.assinado === false, 'antes de assinar: não assinado');
  ok(!!s0.hashAtual && s0.hashAtual.length === 64, 'hash do espelho calculado (sha-256)');

  // PIN errado é recusado
  let recusou = false;
  try { await svc.assinar(t.id, ana.id, '2026-07', '0000'); } catch { recusou = true; }
  ok(recusou, 'PIN errado é recusado');

  // assina com PIN certo
  const r = await svc.assinar(t.id, ana.id, '2026-07', '4321', '203.0.113.7');
  ok(r.assinado === true, 'assinou com PIN correto');

  const s1 = await svc.status(t.id, ana.id, '2026-07');
  ok(s1.assinado && s1.confere, 'depois de assinar: assinado e confere');

  // carimbo disponível para o RH
  const carimbo = await svc.paraCarimbo(t.id, ana.id, '2026-07');
  ok(carimbo?.nome === 'Ana Ribeiro' && !!carimbo?.hashDocumento, 'carimbo traz nome e hash');

  // muda o espelho depois de assinado: nova batida no dia 14
  await marc.bater({ tenantId: t.id, cpf: '72000000001', coletor: Coletor.DISPOSITIVO, dtMarcacao: new Date('2026-07-14T08:00:00-0300'), declaradoOffline: true });
  const s2 = await svc.status(t.id, ana.id, '2026-07');
  ok(s2.assinado && !s2.confere, 'após mudança, assinatura não confere mais (hash divergiu)');
  const semCarimbo = await svc.paraCarimbo(t.id, ana.id, '2026-07');
  ok(semCarimbo === null, 'sem carimbo quando o espelho mudou (evita selo mentiroso)');

  // reassinar volta a conferir
  await svc.assinar(t.id, ana.id, '2026-07', '4321');
  const s3 = await svc.status(t.id, ana.id, '2026-07');
  ok(s3.assinado && s3.confere, 'reassinatura volta a conferir');

  console.log(falhas === 0 ? '\n>>> ESPELHO-ASSINATURA OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
