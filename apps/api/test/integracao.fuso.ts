import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { schema, comoMaster, comTenant, tenant, pontoRep, empregado, pontoMarcacao } from '@ponto/db';
import { Coletor } from '@ponto/shared';
import { verificarCadeia, dataLocalDe } from '@ponto/rep-core';
import { MarcacaoService } from '../src/marcacao/marcacao.service';
import { CertificadoService } from '../src/certificado/certificado.service';
import { CriptoService } from '../src/common/cripto.service';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { FiscalService } from '../src/fiscal/fiscal.service';

const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const certs = new CertificadoService(db, new CriptoService());
const marc = new MarcacaoService(db, certs);
const trat = new TratamentoService(db);
const fisc = new FiscalService(db, certs);

let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };

async function criarTenant(cnpj: string, fuso: string) {
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj, razaoSocial: `Empresa ${fuso}`, localPrestacao: 'X', fuso }).returning()))[0]!;
  await comoMaster(db, (tx) => tx.insert(pontoRep).values({ tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: cnpj, razaoSocial: `Empresa ${fuso}`, numeroInpi: 'BR512024001234-5', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188' }).returning());
  const e = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: '43461292850', nome: 'Maria' }).returning()))[0]!;
  return { t, e };
}

async function main() {
  const hoje = new Date().toISOString().slice(0, 10);

  // ---- Tenant de Brasília (-0300): o fuso default e o gravado batem ----
  const br = await criarTenant('11111111000111', '-0300');
  await marc.bater({ tenantId: br.t.id, cpf: '43461292850', coletor: Coletor.DISPOSITIVO });
  const mBr = (await comTenant(db, br.t.id, (tx) => tx.select().from(pontoMarcacao).where(eq(pontoMarcacao.tenantId, br.t.id)).limit(1)))[0]!;
  ok(mBr.fuso === '-0300', `batida de Brasília grava fuso -0300 (gravou ${mBr.fuso})`);

  // ---- Tenant de Manaus (-0400): a batida grava o fuso do tenant ----
  const am = await criarTenant('22222222000122', '-0400');
  const g = await marc.bater({ tenantId: am.t.id, cpf: '43461292850', coletor: Coletor.DISPOSITIVO });
  const mAm = (await comTenant(db, am.t.id, (tx) => tx.select().from(pontoMarcacao).where(eq(pontoMarcacao.tenantId, am.t.id)).limit(1)))[0]!;
  ok(mAm.fuso === '-0400', `batida de Manaus grava fuso -0400 (gravou ${mAm.fuso})`);

  // A cadeia grava com o fuso da linha e verifica íntegra usando esse fuso.
  ok(verificarCadeia([{
    nsr: Number(mAm.nsr), cpf: mAm.cpf, dtMarcacao: mAm.dtMarcacao, dtGravacao: mAm.dtGravacao,
    coletor: mAm.coletor, onlineOffline: mAm.onlineOffline as 0 | 1,
    hashRegistro: mAm.hashRegistro, hashAnterior: mAm.hashAnterior, fuso: mAm.fuso ?? undefined,
  }]).integro, 'cadeia de Manaus íntegra com o fuso da linha');

  // Se alguém "corrigisse" o fuso da linha para -0300, a cadeia quebraria.
  ok(!verificarCadeia([{
    nsr: Number(mAm.nsr), cpf: mAm.cpf, dtMarcacao: mAm.dtMarcacao, dtGravacao: mAm.dtGravacao,
    coletor: mAm.coletor, onlineOffline: mAm.onlineOffline as 0 | 1,
    hashRegistro: mAm.hashRegistro, hashAnterior: mAm.hashAnterior, fuso: '-0300',
  }]).integro, 'trocar o fuso da linha para -0300 quebra a verificação (fuso é imutável)');

  // ---- AFD do tenant de Manaus reproduz o fuso -0400 na marcação ----
  const afd = await fisc.gerarAfd(am.t.id);
  const linhas = afd.conteudo.toString('latin1').split('\r\n').filter(Boolean);
  const regMarc = linhas.find((l) => l.length === 137 && l.slice(9, 10) === '7')!;
  ok(regMarc.includes('-0400'), 'AFD de Manaus formata a marcação em -0400');
  // A hora de parede no AFD corresponde ao instante convertido para -0400.
  const dtNoAfd = regMarc.slice(10, 35); // AAAA-MM-ddThh:mm:00-0400
  const esperado = dataLocalDe(mAm.dtMarcacao, '-0400');
  ok(dtNoAfd.startsWith(esperado), `data local do AFD (${dtNoAfd.slice(0,10)}) = calendário Manaus (${esperado})`);

  // ---- apurarDia encontra a batida quando a data bate (janela por fuso) ----
  const hojeManaus = dataLocalDe(mAm.dtMarcacao, '-0400');
  const ap = await trat.apurarDia(am.t.id, am.e.id, hojeManaus);
  ok(ap.marcacoes === 1, `apurarDia acha a batida na janela local de Manaus (achou ${ap.marcacoes})`);

  // Espelho do dia também respeita a janela local.
  const esp = await trat.espelhoDia(am.t.id, am.e.id, hojeManaus);
  ok(esp.marcacoes.length === 1, `espelho do dia respeita a janela local de Manaus (${esp.marcacoes.length})`);

  console.log(falhas === 0 ? '\n>>> FUSO E2E OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
