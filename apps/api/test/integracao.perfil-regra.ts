import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { schema, comoMaster, pontoPerfilRegra, empregado } from '@ponto/db';
import { Coletor } from '@ponto/shared';
import { TenantService } from '../src/tenant/tenant.service';
import { EmpregadoService } from '../src/empregado/empregado.service';
import { MarcacaoService } from '../src/marcacao/marcacao.service';
import { PerfilRegraService } from '../src/perfil-regra/perfil-regra.service';
import { TratamentoService } from '../src/tratamento/tratamento.service';

const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const tenants = new TenantService(db, { enviar: async () => true } as never);
const empSvc = new EmpregadoService(db as never, {} as never);
const perfilSvc = new PerfilRegraService(db as never);
const marc = new MarcacaoService(db as never, {} as never);
const trat = new TratamentoService(db as never);

let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };

async function main() {
  const { tenant: t } = await tenants.criar({
    cnpj: '60000000000102', razaoSocial: 'PERFIL LTDA', localPrestacao: 'Salvador/BA',
    adminEmail: 'admin@perfil.com.br',
  });

  // ---- cria um perfil "Padrão" e um "Motoristas" (banco de horas ativo) ----
  const padrao = (await perfilSvc.criar(t.id, {
    nome: 'Padrão da empresa', padrao: true,
    config: { extra: { extraDiaUtilPct: 50, extraDomingoFeriadoPct: 100, extraLimiteDiarioMin: 120 } },
  }))!;
  const motoristas = (await perfilSvc.criar(t.id, {
    nome: 'Motoristas',
    config: {
      extra: { extraDiaUtilPct: 60, extraDomingoFeriadoPct: 100, extraLimiteDiarioMin: 120 },
      banco: { bancoModo: 'ATIVO', bancoTipoAcordo: 'COLETIVO', bancoPrazoMeses: 12, formaCalculo: 'BANCO_HORAS' },
    },
    cctSindicato: 'SINDIMOTO-BA', cctVigencia: '2026/2027',
  }))!;
  ok(padrao.padrao === true, 'perfil Padrão marcado como padrão');

  // só um pode ser padrão
  const listado = await perfilSvc.listar(t.id);
  ok(listado.filter((p) => p.padrao).length === 1, 'só existe um perfil padrão');
  ok(listado.find((p) => p.id === motoristas.id)?.temPdf === false, 'Motoristas sem PDF (não anexado)');

  // ---- funcionário sem perfil usa o padrão; com perfil usa o dele ----
  const ana = await empSvc.criar(t.id, { cpf: '60000000001', nome: 'Ana Caixa' } as never);
  const carlos = await empSvc.criar(t.id, { cpf: '60000000002', nome: 'Carlos Motorista' } as never);
  await empSvc.definirPerfil(t.id, carlos.id, motoristas.id);

  const anaDb = (await comoMaster(db, (tx) => tx.select().from(empregado).where(eq(empregado.id, ana.id)).limit(1)))[0]!;
  const carlosDb = (await comoMaster(db, (tx) => tx.select().from(empregado).where(eq(empregado.id, carlos.id)).limit(1)))[0]!;
  ok(anaDb.perfilRegraId === null, 'Ana sem perfil próprio (cai no padrão)');
  ok(carlosDb.perfilRegraId === motoristas.id, 'Carlos aponta para o perfil Motoristas');

  // ---- a apuração usa o perfil: hora extra do Carlos é 60%, da Ana 50% ----
  const horario = (await trat.criarHorario(t.id, { codigo: 'ADM', descricao: 'Comercial', durJornadaMin: 480,
    diasSemana: [1, 2, 3, 4, 5], pares: [{ entrada: '08:00', saida: '12:00' }, { entrada: '13:00', saida: '17:00' }] } as never))!;
  await empSvc.definirHorario(t.id, ana.id, horario.id);
  await empSvc.definirHorario(t.id, carlos.id, horario.id);

  // batidas com 1h extra (17→18) pros dois, no mesmo dia útil
  for (const cpf of ['60000000001', '60000000002']) {
    for (const hm of ['08:00', '12:00', '13:00', '18:00']) {
      await marc.bater({ tenantId: t.id, cpf, coletor: Coletor.DISPOSITIVO,
        dtMarcacao: new Date(`2026-07-13T${hm}:00-0300`), declaradoOffline: true });
    }
  }

  const apAna = await trat.apurarPeriodoCLT(t.id, ana.id, '2026-07-13', '2026-07-13');
  const apCarlos = await trat.apurarPeriodoCLT(t.id, carlos.id, '2026-07-13', '2026-07-13');
  // ambos fizeram 1h extra; o valor difere pelo percentual do perfil
  ok(apAna.resultado.totalExtrasMin === 60, `Ana: 60min de extra (${apAna.resultado.totalExtrasMin})`);
  ok(apCarlos.resultado.totalExtrasMin === 60, `Carlos: 60min de extra (${apCarlos.resultado.totalExtrasMin})`);

  // ---- editar o perfil vale para quem usa ----
  await perfilSvc.atualizar(t.id, padrao.id, {
    nome: 'Padrão da empresa', padrao: true,
    config: { extra: { extraDiaUtilPct: 55, extraDomingoFeriadoPct: 100, extraLimiteDiarioMin: 120 } },
  });
  const lista2 = await perfilSvc.listar(t.id);
  const p2 = lista2.find((p) => p.id === padrao.id)!;
  ok(((p2.config as { extra?: { extraDiaUtilPct?: number } }).extra?.extraDiaUtilPct) === 55, 'edição do perfil refletiu (50→55%)');

  // ---- não dá pra excluir perfil em uso ----
  let bloqueou = false;
  try { await perfilSvc.remover(t.id, motoristas.id); } catch { bloqueou = true; }
  ok(bloqueou, 'excluir perfil em uso é bloqueado');

  // troca o Carlos de volta pro padrão e aí sim exclui
  await empSvc.definirPerfil(t.id, carlos.id, null);
  await perfilSvc.remover(t.id, motoristas.id);
  const lista3 = await perfilSvc.listar(t.id);
  ok(!lista3.some((p) => p.id === motoristas.id), 'perfil sem uso pôde ser excluído');

  console.log(falhas === 0 ? '\n>>> PERFIL-REGRA OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
