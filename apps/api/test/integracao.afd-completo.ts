import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { schema, comoMaster, pontoRep, pontoEventoRep, pontoMarcacao } from '@ponto/db';
import { Coletor } from '@ponto/shared';
import { TenantService } from '../src/tenant/tenant.service';
import { EmpregadoService } from '../src/empregado/empregado.service';
import { MarcacaoService } from '../src/marcacao/marcacao.service';
import { FiscalService } from '../src/fiscal/fiscal.service';
import { DisponibilidadeService } from '../src/fiscal/disponibilidade.service';
import { verificarCadeia } from '@ponto/rep-core';

const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const tenants = new TenantService(db, { enviar: async () => true } as never);
const empSvc = new EmpregadoService(db as never, {} as never);
const marc = new MarcacaoService(db as never, {} as never);
const fisc = new FiscalService(db as never, {} as never);
const disp = new DisponibilidadeService(db);

let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };

async function main() {
  // ---- cadastro da empresa: deve nascer o registro 2 com NSR 1 ----
  const r = await tenants.criar({
    cnpj: '50000000000101', razaoSocial: 'AFD COMPLETO LTDA',
    localPrestacao: 'Salvador/BA', adminEmail: 'admin@afdcompleto.com.br',
  });
  const t = r.tenant;
  const evs1 = await comoMaster(db, (tx) => tx.select().from(pontoEventoRep).where(eq(pontoEventoRep.tenantId, t.id)));
  ok(evs1.length === 1 && evs1[0]!.tipo === 2 && evs1[0]!.nsr === 1,
    `cadastro da empresa gera o registro 2 no NSR 1 (tipo ${evs1[0]?.tipo}, nsr ${evs1[0]?.nsr})`);

  // ---- funcionário: registro 5 "I", continuando a MESMA sequência ----
  const e1 = await empSvc.criar(t.id, { cpf: '50000000001', nome: 'Ana Primeira' } as never);
  const e2 = await empSvc.criar(t.id, { cpf: '50000000002', nome: 'Bruno Segundo' } as never);
  const evs2 = await comoMaster(db, (tx) => tx.select().from(pontoEventoRep).where(eq(pontoEventoRep.tenantId, t.id)));
  const inclusoes = evs2.filter((x) => x.tipo === 5 && x.operacao === 'I');
  ok(inclusoes.length === 2, `cada funcionário gera registro 5 "I" (${inclusoes.length})`);
  ok(inclusoes.map((x) => x.nsr).sort((a, b) => a - b).join(',') === '2,3',
    `os registros 5 seguem o NSR da empresa (${inclusoes.map((x) => x.nsr).join(',')})`);

  // ---- batidas continuam a mesma sequência, sem colidir ----
  for (const hm of ['08:00', '12:00', '13:00', '17:00']) {
    await marc.bater({ tenantId: t.id, cpf: '50000000001', coletor: Coletor.DISPOSITIVO,
      dtMarcacao: new Date(`2026-07-13T${hm}:00-0300`), declaradoOffline: true });
  }
  // ---- inativar: registro 5 "E" ----
  await empSvc.definirAtivo(t.id, e2.id, false);
  // ---- disponibilidade/indisponibilidade: registro 6 ----
  await disp.aoSubir();
  await disp.aoParar();

  // ---- o AFD tem tudo, ordenado por NSR, sem lacuna ----
  const afd = (await fisc.gerarAfd(t.id)).conteudo.toString('latin1');
  const linhas = afd.split('\r\n').filter((l) => l.length > 0);
  const corpo = linhas.filter((l) => /^\d{9}[24567]/.test(l) && !l.startsWith('999999999'));
  const nsrs = corpo.map((l) => Number(l.slice(0, 9)));
  const tipos = corpo.map((l) => l[9]);

  ok(nsrs.join(',') === Array.from({ length: nsrs.length }, (_, i) => i + 1).join(','),
    `NSR sequencial, sem lacunas e ordenado: 1..${nsrs.length}`);
  ok(new Set(nsrs).size === nsrs.length, 'nenhum NSR repetido entre os tipos de registro');
  ok(tipos.includes('2') && tipos.includes('5') && tipos.includes('6') && tipos.includes('7'),
    `AFD traz os tipos 2, 5, 6 e 7 (${[...new Set(tipos)].sort().join(',')})`);

  // tamanhos fixos de cada tipo, conforme o leiaute
  const tam = (t2: string) => corpo.filter((l) => l[9] === t2).map((l) => l.length);
  ok(tam('2').every((n) => n === 331), `registro 2 com 331 posições (${tam('2')})`);
  ok(tam('5').every((n) => n === 118), `registro 5 com 118 posições (${[...new Set(tam('5'))]})`);
  ok(tam('6').every((n) => n === 36), `registro 6 com 36 posições (${[...new Set(tam('6'))]})`);
  ok(tam('7').every((n) => n === 137), `registro 7 com 137 posições (${[...new Set(tam('7'))]})`);

  // trailer confere com o que está no arquivo
  const tr = linhas.find((l) => l.startsWith('999999999'))!;
  const conta = (t2: string) => corpo.filter((l) => l[9] === t2).length;
  ok(Number(tr.slice(9, 18)) === conta('2'), `trailer conta ${conta('2')} registro(s) tipo 2`);
  ok(Number(tr.slice(36, 45)) === conta('5'), `trailer conta ${conta('5')} registro(s) tipo 5`);
  ok(Number(tr.slice(45, 54)) === conta('6'), `trailer conta ${conta('6')} registro(s) tipo 6`);
  ok(Number(tr.slice(54, 63)) === conta('7'), `trailer conta ${conta('7')} registro(s) tipo 7`);

  // eventos de serviço com os códigos do REP-P
  const evsFinal = await comoMaster(db, (tx) => tx.select().from(pontoEventoRep).where(eq(pontoEventoRep.tenantId, t.id)));
  const sens = evsFinal.filter((x) => x.tipo === 6).map((x) => x.tipoEvento);
  ok(sens.includes(7) && sens.includes(8), `eventos de serviço 07 e 08 gravados (${sens.join(',')})`);
  ok(evsFinal.some((x) => x.tipo === 5 && x.operacao === 'E'), 'inativar funcionário gera registro 5 "E"');

  // ---- a cadeia de hash das batidas continua intacta ----
  const linhasMarc = await comoMaster(db, (tx) =>
    tx.select().from(pontoMarcacao).where(eq(pontoMarcacao.tenantId, t.id)).orderBy(pontoMarcacao.nsr));
  const cadeia = linhasMarc.map((m) => ({
    nsr: Number(m.nsr), cpf: m.cpf, dtMarcacao: m.dtMarcacao, dtGravacao: m.dtGravacao,
    coletor: m.coletor, onlineOffline: m.onlineOffline, fuso: m.fuso ?? '-0300',
    hashRegistro: m.hashRegistro.trim(), hashAnterior: m.hashAnterior ? m.hashAnterior.trim() : null,
  }));
  ok(verificarCadeia(cadeia as never).integro, 'cadeia de hash das marcações intacta mesmo com eventos no meio');
  ok(cadeia[0]!.hashAnterior === null && cadeia[0]!.nsr > 1,
    `1ª batida começa depois dos eventos (NSR ${cadeia[0]?.nsr}) e sem hash anterior`);

  // ---- o contador do REP reflete o último NSR ----
  const rep = (await comoMaster(db, (tx) => tx.select().from(pontoRep).where(eq(pontoRep.tenantId, t.id)).limit(1)))[0]!;
  ok(rep.ultimoNsr === nsrs.length, `contador do REP em dia (${rep.ultimoNsr} = ${nsrs.length})`);
  void e1;

  console.log(falhas === 0 ? '\n>>> AFD COMPLETO OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
