import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema, comoMaster, tenant, empregado, usuario, pessoalPrestador } from '@ponto/db';
import { CadastroService } from '../src/cadastro/cadastro.service';
import { CriptoService } from '../src/common/cripto.service';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { PessoalService } from '../src/pessoal/pessoal.service';
import { AtencaoService } from '../src/pessoal/atencao.service';

/** Atualização cadastral com foto: obrigatória, revisão do RH e caricatura. */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const cripto = new CriptoService();
const cad = new CadastroService(db, cripto);
const trat = new TratamentoService(db);
const at = new AtencaoService(db, trat, new PessoalService(db, trat, cripto));
let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };
const JPG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCABgAGADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDeooorkOoKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//2Q==';
async function erro(p: Promise<unknown>): Promise<string> { try { await p; return ''; } catch (e) { return (e as Error).message; } }

async function main() {
  const CNPJ = `77${String(Date.now()).slice(-12)}`;
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({ cnpj: CNPJ, razaoSocial: 'Foto LTDA' }).returning()))[0]!;
  const ana = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: CNPJ.slice(0, 11), nome: 'Ana Clara Souza' }).returning()))[0]!;
  const u = (await comoMaster(db, (tx) => tx.insert(usuario).values({ tenantId: t.id, email: `ana${CNPJ}@x.com`, senhaHash: 'x', perfil: 'COLABORADOR', empregadoId: ana.id }).returning()))[0]!;
  const mei = (await comoMaster(db, (tx) => tx.insert(pessoalPrestador).values({ tenantId: t.id, tipo: 'MEI', nome: 'Carlos MEI', competenciaInicio: '2026-10' }).returning()))[0]!;

  ok(await cad.empregadoDoUsuario(t.id, u.id) === ana.id, 'acesso do app chega no funcionário certo');
  const m0 = await cad.meu(t.id, ana.id);
  ok(m0.precisaAtualizar && m0.foto === null, 'sem foto: o app pede a atualização');
  ok((await erro(cad.salvarMeu(t.id, ana.id, { celular: '71988123344' }))).includes('Falta a foto'), 'não deixa concluir sem foto');
  ok((await erro(cad.salvarMeu(t.id, ana.id, { foto: Buffer.from('nao e jpeg nem de longe, so texto qualquer para passar de cem bytes de tamanho........................').toString('base64'), miniatura: JPG }))).includes('JPEG'), 'recusa arquivo que não é JPEG');
  ok((await erro(cad.salvarMeu(t.id, ana.id, { foto: JPG, miniatura: JPG, emailPessoal: 'sem-arroba' }))).includes('E-mail'), 'valida e-mail');

  const m1 = await cad.salvarMeu(t.id, ana.id, { foto: JPG, miniatura: JPG, origem: 'GALERIA', celular: '(71) 98812-3344', emailPessoal: 'ana@gmail.com' });
  ok(!m1.precisaAtualizar && m1.foto?.status === 'REVISAR' && m1.foto.miniatura.startsWith('data:image/jpeg;base64,'), 'foto salva já vale (status REVISAR)');
  ok(m1.celular === '(71) 98812-3344' && m1.emailPessoal === 'ana@gmail.com', 'celular e e-mail gravados');
  const raw = await comoMaster(db, (tx) => tx.select().from(schema.empregadoFoto));
  const minha = raw.find((r) => r.empregadoId === ana.id)!;
  ok(!minha.foto.equals(Buffer.from(JPG, 'base64')), 'foto cifrada em repouso');
  ok((await cad.foto(t.id, ana.id)).equals(Buffer.from(JPG, 'base64')), 'foto decifrada volta igual');

  const av = await cad.avatares(t.id);
  ok(!!av.empregados[ana.id]?.foto && av.resumo.comFoto === 1 && av.resumo.revisar === 1, 'lista de avatares traz a miniatura e o resumo');
  ok(av.prestadores[mei.id] !== undefined && av.prestadores[mei.id]!.semente === null, 'prestador aparece só com caricatura');
  ok((await at.listar(t.id)).itens.some((i) => i.tipo === 'FOTO_REVISAR' && i.acao.abrir === 'FOTOS'), 'Início mostra "foto nova para revisar"');

  ok((await erro(cad.revisar(t.id, ana.id, false, '', null))).includes('motivo'), 'recusar exige motivo');
  await cad.revisar(t.id, ana.id, false, 'Óculos escuros', 'rh@x.com');
  const m2 = await cad.meu(t.id, ana.id);
  ok(m2.precisaAtualizar && m2.foto?.status === 'RECUSADA' && m2.foto.motivo === 'Óculos escuros', 'recusada: o app pede outra e mostra o motivo');
  ok((await cad.avatares(t.id)).empregados[ana.id]!.foto === null, 'foto recusada some das listas (volta a caricatura)');

  await cad.salvarMeu(t.id, ana.id, { foto: JPG, miniatura: JPG });
  await cad.revisar(t.id, ana.id, true, null, 'rh@x.com');
  ok((await cad.meu(t.id, ana.id)).foto?.status === 'APROVADA', 'nova foto aprovada');

  await cad.definirSemente(t.id, 'PRESTADOR', mei.id, 7);
  await cad.definirSemente(t.id, 'CLT', ana.id, 3);
  const av2 = await cad.avatares(t.id);
  ok(av2.prestadores[mei.id]!.semente === 7 && av2.empregados[ana.id]!.semente === 3, 'RH troca o desenho (semente) de prestador e CLT');

  await client.end();
  if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
  console.log('\n>>> CADASTRO E FOTO OK <<<');
}
main().catch(async (e) => { console.error(e); await client.end(); process.exit(1); });
