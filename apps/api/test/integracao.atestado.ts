import 'reflect-metadata';
process.env.APP_CRYPTO_KEY = Buffer.alloc(32, 7).toString('base64');
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema, comoMaster, tenant, empregado, usuario } from '@ponto/db';
import { DocumentoService } from '../src/documento/documento.service';
import { CriptoService } from '../src/common/cripto.service';

const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });

const enviados: { para: string; assunto: string }[] = [];
const emailFake = { enviar: async (e: { para: string; assunto: string }) => { enviados.push({ para: e.para, assunto: e.assunto }); return true; } };
const docs = new DocumentoService(db, new CriptoService(), emailFake as never);

const B64 = Buffer.from('conteudo-de-um-atestado-ficticio').toString('base64');

let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };

async function main() {
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: '44444444000144', razaoSocial: 'Atestado LTDA' }).returning()))[0]!;
  const emp = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: '55555555555', nome: 'Maria Andrade' }).returning()))[0]!;
  await comoMaster(db, (tx) => tx.insert(usuario).values([
    { tenantId: t.id, email: 'colab@x.com', senhaHash: 'x', perfil: 'COLABORADOR', empregadoId: emp.id },
    { tenantId: t.id, email: 'rh@x.com', senhaHash: 'x', perfil: 'RH' },
    { tenantId: t.id, email: 'admin@x.com', senhaHash: 'x', perfil: 'ADMIN_CLIENTE' },
    { tenantId: t.id, email: 'inativo@x.com', senhaHash: 'x', perfil: 'RH', ativo: false },
  ]).returning());

  const doc = await docs.enviar(t.id, emp.id, {
    tipo: 'ATESTADO', dataInicio: '2026-07-10', dataFim: '2026-07-11',
    arquivoBase64: B64, arquivoNome: 'atestado.png', arquivoMime: 'image/png',
  });
  if (!doc) { console.log('FALHA — enviar não retornou documento'); await client.end(); process.exit(1); }
  ok(!!doc.id, 'documento é inserido e retorna id');
  ok(doc.status === 'EM_ANALISE', 'nasce EM_ANALISE');
  ok(doc.arquivoBytes > 0, `bytes registrados (${doc.arquivoBytes})`);

  const meus = await docs.meus(t.id, emp.id);
  ok(meus.length === 1, `aparece na lista do funcionário (${meus.length})`);

  // A notificação é disparada com void — dá um tick pra resolver.
  await new Promise((r) => setTimeout(r, 150));
  ok(enviados.length === 2, `notificou os 2 admins/RH ativos (${enviados.length})`);
  ok(enviados.some((e) => e.para === 'rh@x.com') && enviados.some((e) => e.para === 'admin@x.com'), 'e-mails do RH e do admin');
  ok(!enviados.some((e) => e.para === 'colab@x.com'), 'não notifica o próprio colaborador');
  ok(!enviados.some((e) => e.para === 'inativo@x.com'), 'não notifica usuário inativo');
  ok(enviados[0]!.assunto.includes('Maria Andrade'), 'assunto traz o nome de quem enviou');

  const arq = await docs.baixar(t.id, doc.id, emp.id);
  ok(arq.bytes.length > 0 && arq.mime === 'image/png', 'arquivo decifra corretamente ao baixar');

  console.log(falhas === 0 ? '\n>>> ATESTADO OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
