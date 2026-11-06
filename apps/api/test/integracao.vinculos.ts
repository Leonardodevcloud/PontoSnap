import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createHash } from 'node:crypto';
import { schema, comoMaster, tenant, empregado, pontoRep, pontoHorarioContratual, pontoMarcacao, usuario, usuarioTenant, pontoHolerite, assinaturaDocumento } from '@ponto/db';
import { eq } from 'drizzle-orm';
import { Perfil } from '@ponto/shared';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { CriptoService } from '../src/common/cripto.service';
import { TransferenciaService } from '../src/transferencia/transferencia.service';
import { VinculoService } from '../src/vinculo/vinculo.service';
import { VinculoController } from '../src/vinculo/vinculo.controller';
import { HoleriteService } from '../src/holerite/holerite.service';
import { HoleriteController } from '../src/holerite/holerite.controller';
import { AssinaturaService } from '../src/assinatura/assinatura.service';
import { AssinaturaMeusController } from '../src/assinatura/assinatura.controller';
import { MarcacaoService } from '../src/marcacao/marcacao.service';
import { MarcacaoController } from '../src/marcacao/marcacao.controller';
import { EspelhoAssinaturaService } from '../src/espelho-assinatura/espelho-assinatura.service';
import { EspelhoAssinaturaController } from '../src/espelho-assinatura/espelho-assinatura.controller';
import { hashPin } from '../src/auth/pin';
import type { PayloadAcesso } from '../src/auth/token';

/**
 * App do funcionário transferido entre CNPJs do grupo: vê contracheques,
 * documentos, espelho e comprovantes da empresa anterior sem mover nada.
 *  - /meus-vinculos: atual primeiro, anterior com a saída; sem empregadoId/cpf na resposta.
 *  - Contracheques e documentos agregados das duas empresas, com empresa/atual.
 *  - Baixar da anterior só com ?vinculo; empresa fora da cadeia → 403; de outro funcionário → 403.
 *  - Espelho de outubro (anterior): apuração e status com ?vinculo; assina com o PIN de hoje.
 *  - Batidas do dia na anterior; comprovante de NSR de outra pessoa → 404 (furo antigo).
 *  - Quem nunca foi transferido: um vínculo só, tudo como antes.
 */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const trat = new TratamentoService(db);
const cripto = new CriptoService();
const transf = new TransferenciaService(db as never, { exigirVaga: async () => {} } as never);
const vinc = new VinculoService(db as never);
const push = { enviarParaEmpregado: async () => {}, enviar: async () => {} } as never;
const assin = new AssinaturaService(db as never, cripto, trat, push);
const hol = new HoleriteService(db as never, cripto, push, assin);
const marc = new MarcacaoService(db as never, { } as never);
const esp = new EspelhoAssinaturaService(db as never, trat);
const cHol = new HoleriteController(hol, vinc);
const cDoc = new AssinaturaMeusController(assin, vinc);
const cMarc = new MarcacaoController(marc, trat, {} as never, vinc);
const cEsp = new EspelhoAssinaturaController(esp, trat, vinc);
const cVinc = new VinculoController(vinc);

let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };
const em = (data: string, hm: string) => new Date(`${data}T${hm}:00-0300`);
const erroDe = async (f: () => Promise<unknown>) => { try { await f(); return ''; } catch (e) { return `${(e as { status?: number }).status ?? ''} ${(e as Error).message}`; } };
type TxM = Parameters<Parameters<typeof comoMaster>[1]>[0];
const M = <T>(f: (tx: TxM) => Promise<T>) => comoMaster(db, f);

async function main() {
  const suf = String(Date.now()).slice(-10);
  const mk = async (cnpj: string, nome: string) => {
    const t = (await M((tx) => tx.insert(tenant).values({ cnpj, razaoSocial: nome }).returning()))[0]!;
    const rep = (await M((tx) => tx.insert(pontoRep).values({ tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: cnpj, razaoSocial: nome,
      numeroInpi: 'BR512024004444-4', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188' }).returning()))[0]!;
    return { t, rep };
  };
  const A = await mk(`71${suf}01`, 'IG SERVICOS DE ENTREGAS LTDA');
  const B = await mk(`72${suf}02`, 'TUTS INTERMEDIACAO LTDA');
  const C = await mk(`73${suf}03`, 'OUTRO GRUPO LTDA');
  const adm = (await M((tx) => tx.insert(usuario).values({ email: `adm${suf}@x.com`, senhaHash: 'x', perfil: 'ADMIN_CLIENTE', tenantId: A.t.id }).returning()))[0]!;
  await M((tx) => tx.insert(usuarioTenant).values([{ usuarioId: adm.id, tenantId: A.t.id, perfil: 'ADMIN_CLIENTE' }, { usuarioId: adm.id, tenantId: B.t.id, perfil: 'ADMIN_CLIENTE' }]));
  const hor = (await M((tx) => tx.insert(pontoHorarioContratual).values({ tenantId: A.t.id, codigo: 'ADM', durJornadaMin: 480, diasSemana: [1, 2, 3, 4, 5], regime: 'normal',
    pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }] }).returning()))[0]!;

  const pin1 = await hashPin('1111');
  const ana = (await M((tx) => tx.insert(empregado).values({ tenantId: A.t.id, cpf: `7${suf}`, nome: 'Ana Transferida', matricula: '001',
    horarioContratualId: hor.id, salarioMensal: '2200.00', dataInicioPonto: '2026-08-01', dataAdmissao: '2025-03-10', pinHash: pin1 }).returning()))[0]!;
  const caio = (await M((tx) => tx.insert(empregado).values({ tenantId: A.t.id, cpf: `6${suf}`, nome: 'Caio Fica', matricula: '002',
    horarioContratualId: hor.id, dataInicioPonto: '2026-08-01' }).returning()))[0]!;
  const loginAna = (await M((tx) => tx.insert(usuario).values({ email: `ana${suf}@x.com`, senhaHash: 'x', perfil: 'COLABORADOR', tenantId: A.t.id, empregadoId: ana.id }).returning()))[0]!;
  const loginCaio = (await M((tx) => tx.insert(usuario).values({ email: `caio${suf}@x.com`, senhaHash: 'x', perfil: 'COLABORADOR', tenantId: A.t.id, empregadoId: caio.id }).returning()))[0]!;

  // Outubro na IG: batidas da Ana (NSR 1..4) e do Caio (NSR 5..8).
  let nsr = 1;
  const bater = async (cpf: string, d: string) => {
    const bs = [em(d, '08:00'), em(d, '12:00'), em(d, '13:00'), em(d, '17:00')];
    await M((tx) => tx.insert(pontoMarcacao).values(bs.map((b) => ({ tenantId: A.t.id, repId: A.rep.id, nsr, cpf, dtMarcacao: b, coletor: 1, hashRegistro: String(nsr++).padStart(64, '0') }))));
  };
  await bater(ana.cpf, '2026-10-14');
  await bater(caio.cpf, '2026-10-14');

  // Contracheques e documentos da IG (setembro e outubro); um do Caio.
  const pdf = cripto.cifrarBytes(Buffer.from('%PDF-1.4 teste'));
  const [holOut] = await M((tx) => tx.insert(pontoHolerite).values([
    { tenantId: A.t.id, empregadoId: ana.id, competencia: '2026-10', arquivo: pdf, arquivoNome: 'out.pdf', arquivoBytes: 14, liquidoCentavos: 169084 },
    { tenantId: A.t.id, empregadoId: ana.id, competencia: '2026-09', arquivo: pdf, arquivoNome: 'set.pdf', arquivoBytes: 14, liquidoCentavos: 170210 },
  ] as never).returning());
  const [holCaio] = await M((tx) => tx.insert(pontoHolerite).values({ tenantId: A.t.id, empregadoId: caio.id, competencia: '2026-10', arquivo: pdf, arquivoNome: 'c.pdf', arquivoBytes: 14 } as never).returning());
  const h = createHash('sha256').update('x').digest('hex');
  const [docOut] = await M((tx) => tx.insert(assinaturaDocumento).values([
    { tenantId: A.t.id, empregadoId: ana.id, competencia: '2026-10', tipo: 'ESPELHO', status: 'ENVIADO', arquivo: pdf, arquivoNome: 'esp.pdf', arquivoBytes: 14, hashSha256: h, enviadoEm: new Date() },
    { tenantId: A.t.id, empregadoId: ana.id, competencia: '2026-09', tipo: 'CONTRACHEQUE', status: 'ASSINADO', arquivo: pdf, arquivoNome: 'cc.pdf', arquivoBytes: 14, hashSha256: h, enviadoEm: new Date(), assinadoEm: new Date() },
  ] as never).returning());

  // Transferência para a TUTS em 01/11; depois a Ana troca o PIN na empresa nova.
  await transf.transferirClt(A.t.id, adm.id, ana.id, { destinoTenantId: B.t.id, data: '2026-11-01', preservarAdmissao: true, motivo: 'TRANSFERENCIA' });
  const anaB = (await M((tx) => tx.select().from(empregado).where(eq(empregado.empregadoAnteriorId, ana.id))))[0]!;
  const pin2 = await hashPin('2222');
  await M((tx) => tx.update(empregado).set({ pinHash: pin2 }).where(eq(empregado.id, anaB.id)));
  const login = (await M((tx) => tx.select().from(usuario).where(eq(usuario.id, loginAna.id))))[0]!;
  ok(login.tenantId === B.t.id && login.empregadoId === anaB.id, 'login da Ana aponta para a TUTS');
  const u: PayloadAcesso = { sub: loginAna.id, tenantId: B.t.id, perfil: Perfil.COLABORADOR } as PayloadAcesso;

  // Vínculos
  const vs = await cVinc.meus(u) as Array<Record<string, unknown>>;
  ok(vs.length === 2 && vs[0]!.tenantId === B.t.id && vs[0]!.atual === true && vs[1]!.tenantId === A.t.id && vs[1]!.atual === false, 'vínculos: TUTS atual, IG anterior');
  ok(vs[1]!.saida === '2026-11-01' && vs[0]!.saida === null, 'anterior com saída 01/11; atual sem saída');
  ok(!('empregadoId' in vs[0]!) && !('cpf' in vs[0]!), 'resposta não expõe empregadoId nem CPF');

  // Contracheques
  const hs = await cHol.meus(u) as Array<{ id: string; competencia: string; tenantId: string; empresa: string; atual: boolean }>;
  ok(hs.length === 2 && hs.every((x) => x.tenantId === A.t.id && x.atual === false && x.empresa === 'IG SERVICOS DE ENTREGAS LTDA'), 'contracheques da IG aparecem com a empresa (2)');
  ok(!hs.some((x) => x.id === (holCaio as { id: string }).id), 'contracheque do Caio não aparece');
  const baixa = await erroDe(() => cHol.arquivo(u, (holOut as { id: string }).id, A.t.id));
  ok(baixa === '', `baixa o de outubro com ?vinculo=IG (${baixa})`);
  const semV = await erroDe(() => cHol.arquivo(u, (holOut as { id: string }).id, undefined));
  ok(semV.startsWith('404'), `sem ?vinculo procura na TUTS e não acha (${semV})`);
  const doCaio = await erroDe(() => cHol.arquivo(u, (holCaio as { id: string }).id, A.t.id));
  ok(doCaio.startsWith('403'), `contracheque do Caio na IG → 403 (${doCaio})`);
  const fora = await erroDe(() => cHol.arquivo(u, (holOut as { id: string }).id, C.t.id));
  ok(fora.startsWith('403'), `empresa fora da cadeia → 403 (${fora})`);

  // Documentos
  const ds = await cDoc.meus(u) as { documentos: Array<{ id: string; tenantId: string; atual: boolean; status: string }>; pendentes: number };
  ok(ds.documentos.length === 2 && ds.pendentes === 1 && ds.documentos.every((d) => d.tenantId === A.t.id && !d.atual), 'documentos da IG: 2, um pendente (badge soma)');
  const arq = await erroDe(() => cDoc.arquivo(u, (docOut as { id: string }).id, A.t.id));
  ok(arq === '', `baixa o espelho de outubro da IG (${arq})`);
  const arqFora = await erroDe(() => cDoc.arquivo(u, (docOut as { id: string }).id, C.t.id));
  ok(arqFora.startsWith('403'), `documento com empresa fora da cadeia → 403 (${arqFora})`);

  // Espelho de outubro (IG)
  const ap = await cMarc.minhaApuracao(u, '2026-10-01', '2026-10-31', A.t.id) as { resultado: { dias: Array<{ data: string; marcacoes: unknown[] }> } };
  ok(ap.resultado.dias.find((d) => d.data === '2026-10-14')?.marcacoes.length === 4, 'apuração de outubro na IG traz as 4 batidas de 14/10');
  const apB = await cMarc.minhaApuracao(u, '2026-10-01', '2026-10-31') as { resultado: { dias: Array<{ marcacoes: unknown[] }> } };
  ok(apB.resultado.dias.every((d) => d.marcacoes.length === 0), 'sem ?vinculo, outubro na TUTS: nada');
  const st0 = await cEsp.status(u, '2026-10', A.t.id) as { assinado: boolean };
  ok(st0.assinado === false, 'espelho de outubro na IG: não assinado');
  const pinVelho = await erroDe(() => cEsp.assinar(u, { competencia: '2026-10', pin: '1111', vinculo: A.t.id }, {}));
  ok(pinVelho.startsWith('401'), `PIN antigo (da IG) não vale mais (${pinVelho})`);
  const ass = await erroDe(() => cEsp.assinar(u, { competencia: '2026-10', pin: '2222', vinculo: A.t.id }, {}));
  ok(ass === '', `assina outubro na IG com o PIN de hoje (${ass})`);
  const st1 = await cEsp.status(u, '2026-10', A.t.id) as { assinado: boolean; confere: boolean };
  ok(st1.assinado && st1.confere, 'status: assinado e conferindo, gravado na IG');
  const stFora = await erroDe(() => cEsp.status(u, '2026-10', C.t.id));
  ok(stFora.startsWith('403'), `status com empresa fora da cadeia → 403 (${stFora})`);

  // Batidas do dia e comprovante
  const dia = await cMarc.minhas(u, '2026-10-14', A.t.id) as { marcacoes: Array<{ nsr: number | null }> };
  ok(dia.marcacoes.length === 4 && dia.marcacoes.every((m) => m.nsr! <= 4), 'batidas de 14/10 na IG: só as 4 da Ana');
  const compCaio = await erroDe(() => marc.gerarComprovantePdf(A.t.id, 5, ana.cpf));
  ok(compCaio.startsWith('404'), `comprovante do NSR do Caio pedido pela Ana → 404 (${compCaio})`);
  const compFora = await erroDe(() => cMarc.comprovante(u, 1, C.t.id));
  ok(compFora.startsWith('403'), `comprovante com empresa fora da cadeia → 403 (${compFora})`);

  // Quem nunca foi transferido: um vínculo, tudo como antes.
  const uc: PayloadAcesso = { sub: loginCaio.id, tenantId: A.t.id, perfil: Perfil.COLABORADOR } as PayloadAcesso;
  const vc = await cVinc.meus(uc) as unknown[];
  ok(vc.length === 1, 'Caio: um vínculo só');
  const hc = await cHol.meus(uc) as Array<{ atual: boolean }>;
  ok(hc.length === 1 && hc[0]!.atual === true, 'Caio: o próprio contracheque, atual');
  const caioPedeAna = await erroDe(() => cHol.arquivo(uc, (holOut as { id: string }).id, undefined));
  ok(caioPedeAna.startsWith('403'), `Caio tentando o contracheque da Ana → 403 (${caioPedeAna})`);
  const caioNaTuts = await erroDe(() => cMarc.minhas(uc, '2026-10-14', B.t.id));
  ok(caioNaTuts.startsWith('403'), `Caio pedindo vínculo na TUTS → 403 (${caioNaTuts})`);

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK');
  await client.end();
  process.exit(falhas ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await client.end(); process.exit(1); });
