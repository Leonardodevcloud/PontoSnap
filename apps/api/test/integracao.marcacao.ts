import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { schema, comoMaster, comTenant, tenant, pontoRep, empregado, pontoMarcacao } from '@ponto/db';
import { verificarCadeia } from '@ponto/rep-core';
import { Coletor } from '@ponto/shared';
import { MarcacaoService } from '../src/marcacao/marcacao.service';
import { CertificadoService } from '../src/certificado/certificado.service';
import { CriptoService } from '../src/common/cripto.service';

const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const certs = new CertificadoService(db, new CriptoService());

async function main() {
  // --- seed (como MASTER) ---
  const ts = await comoMaster(db, (tx) => tx.insert(tenant).values({
    cnpj: '11111111000111', razaoSocial: 'Cliente A', localPrestacao: 'Av. Teste, 100 - Salvador/BA',
  }).returning());
  const tenantId = ts[0]!.id;
  const reps = await comoMaster(db, (tx) => tx.insert(pontoRep).values({
    tenantId, tipoIdEmpregador: 1, documentoEmpregador: '11111111000111', razaoSocial: 'Cliente A',
    numeroInpi: 'BR512024001234-5', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188',
  }).returning());
  const repId = reps[0]!.id;
  await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId, cpf: '43461292850', nome: 'Maria A' }).returning());
  console.log('Seed: 1 tenant, 1 REP-P, 1 empregado.');

  // --- bater ponto 5x usando o MarcacaoService REAL ---
  const service = new MarcacaoService(db, certs);
  const horarios: Array<[number, number]> = [[8, 0], [12, 0], [13, 0], [17, 0], [18, 30]];
  const nsrs: number[] = [];
  for (const [h, m] of horarios) {
    const dt = new Date('2026-07-13T00:00:00-0300'); dt.setHours(h, m, 0, 0);
    const g = await service.bater({ tenantId, cpf: '43461292850', coletor: Coletor.DISPOSITIVO, dtMarcacao: dt });
    nsrs.push(g.nsr);
  }
  console.log('Batidas gravadas (NSR):', nsrs.join(', '));

  // --- ler do banco e verificar a cadeia ---
  const linhas = await comTenant(db, tenantId, (tx) =>
    tx.select().from(pontoMarcacao).orderBy(pontoMarcacao.nsr));
  const cadeia = linhas.map((m) => ({
    nsr: Number(m.nsr), cpf: m.cpf, dtMarcacao: m.dtMarcacao, dtGravacao: m.dtGravacao,
    coletor: m.coletor, onlineOffline: m.onlineOffline,
    hashRegistro: m.hashRegistro.trim(), hashAnterior: m.hashAnterior ? m.hashAnterior.trim() : null,
  }));
  const chk = verificarCadeia(cadeia as never);
  console.log('Cadeia íntegra:', chk.integro, '| nsrQuebrado:', chk.nsrQuebrado);
  console.log('1º hashAnterior é null:', cadeia[0]!.hashAnterior === null);
  console.log('2º encadeia o 1º:', cadeia[1]!.hashAnterior === cadeia[0]!.hashRegistro);

  // --- imutabilidade: tentar alterar deve falhar ---
  let bloqueado = false;
  try {
    await comTenant(db, tenantId, (tx) =>
      tx.execute(sql`UPDATE ponto_marcacao SET cpf = '00000000000' WHERE nsr = 2 AND rep_id = ${repId}`));
  } catch (e) {
    bloqueado = String((e as Error).message ?? e).toLowerCase().includes('imutaveis');
  }
  console.log('UPDATE bloqueado pela trigger:', bloqueado);

  await client.end();
  const tudoOk = chk.integro && bloqueado && cadeia[0]!.hashAnterior === null
    && cadeia[1]!.hashAnterior === cadeia[0]!.hashRegistro && nsrs.join(',') === '1,2,3,4,5';
  console.log(tudoOk ? '\n>>> INTEGRAÇÃO OK <<<' : '\n>>> FALHOU <<<');
  process.exit(tudoOk ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
