import 'reflect-metadata';
import fs from 'node:fs';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema, comoMaster, tenant, pontoRep, empregado } from '@ponto/db';
import { Coletor } from '@ponto/shared';
import { MarcacaoService } from '../src/marcacao/marcacao.service';
import { FiscalService } from '../src/fiscal/fiscal.service';
import { CertificadoService } from '../src/certificado/certificado.service';
import { CriptoService } from '../src/common/cripto.service';

const dir = process.env.OUTDIR!;
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const certs = new CertificadoService(db, new CriptoService());
const marc = new MarcacaoService(db, certs);
const fisc = new FiscalService(db, certs);

async function main() {
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: '11111111000111', razaoSocial: 'Cliente A' }).returning()))[0]!;
  await comoMaster(db, (tx) => tx.insert(pontoRep).values({ tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: '11111111000111', razaoSocial: 'Cliente A', numeroInpi: 'BR512024001234-5', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188' }).returning());
  await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: '43461292850', nome: 'Maria A' }).returning());
  for (const [h, m] of [[8, 0], [12, 0]] as [number, number][]) {
    const dt = new Date('2026-07-13T00:00:00-0300'); dt.setHours(h, m, 0, 0);
    await marc.bater({ tenantId: t.id, cpf: '43461292850', coletor: Coletor.DISPOSITIVO, dtMarcacao: dt });
  }

  const info = await certs.salvar(t.id, fs.readFileSync(`${dir}/cert.pfx`), '1234');
  console.log('Certificado cifrado e salvo. CN:', info.cn);

  const r = await fisc.gerarAfdAssinado(t.id);
  fs.writeFileSync(`${dir}/${r.nomeArquivo}`, r.conteudo);
  fs.writeFileSync(`${dir}/${r.nomeP7s}`, r.p7s);
  console.log('AFD assinado gerado:', r.nomeArquivo, '| .p7s', r.p7s.length, 'bytes');
  console.log('ARQUIVO=' + r.nomeArquivo);
  await client.end();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
