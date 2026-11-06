import 'reflect-metadata';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import {
  schema, comoMaster, tenant, empregado, pontoRep, pontoHorarioContratual, pontoMarcacao, usuario, usuarioTenant,
  empregadoFoto, pushSubscription, pontoAusencia, pontoBancoMov, pontoDocumento, pontoAjuste, pessoalPrestador,
} from '@ponto/db';
import { and, eq } from 'drizzle-orm';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { BancoService } from '../src/banco/banco.service';
import { CriptoService } from '../src/common/cripto.service';
import { CadastroService } from '../src/cadastro/cadastro.service';
import { TransferenciaService } from '../src/transferencia/transferencia.service';

/**
 * Transferência entre CNPJs leva tudo (menos arquivo fiscal):
 *  - Banco de horas: saldo vai lote a lote com a data original (vence igual);
 *    a origem zera; idempotente. Transferência no meio do mês: o último mês da
 *    origem vem quando ela fecha. Destino sem banco: o saldo fica na origem.
 *  - Foto de perfil (CLT e prestador) e notificações do celular.
 *  - Folga do banco marcada pra depois (ausência + débito), atestado que pega
 *    os dois lados (copiado) e o que é só depois (movido), ajuste em análise.
 *  - Reparo de quem foi transferido antes: foto, push e dias; rodar de novo não duplica.
 */
const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const trat = new TratamentoService(db);
const banco = new BancoService(db as never, trat);
const cripto = new CriptoService();
const cad = new CadastroService(db as never, cripto);
const svc = new TransferenciaService(db as never, { exigirVaga: async () => {} } as never, banco);

let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };
const em = (data: string, hm: string) => new Date(`${data}T${hm}:00-0300`);
type TxM = Parameters<Parameters<typeof comoMaster>[1]>[0];
const M = <T>(f: (tx: TxM) => Promise<T>) => comoMaster(db, f);
const HOJE = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

async function main() {
  const suf = String(Date.now()).slice(-10);
  const mk = async (cnpj: string, nome: string, comBanco = true) => {
    const t = (await M((tx) => tx.insert(tenant).values({ cnpj, razaoSocial: nome, ...(comBanco ? { bancoTipoAcordo: 'INDIVIDUAL', bancoPrazoMeses: 6 } : {}) }).returning()))[0]!;
    const rep = (await M((tx) => tx.insert(pontoRep).values({ tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: cnpj, razaoSocial: nome,
      numeroInpi: 'BR512024004444-4', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188' }).returning()))[0]!;
    return { t, rep };
  };
  const A = await mk(`81${suf}01`, 'IG SERVICOS DE ENTREGAS LTDA');
  const B = await mk(`82${suf}02`, 'TUTS INTERMEDIACAO LTDA');
  const S = await mk(`83${suf}03`, 'SEM BANCO LTDA', false);
  const adm = (await M((tx) => tx.insert(usuario).values({ email: `adm${suf}@x.com`, senhaHash: 'x', perfil: 'ADMIN_CLIENTE', tenantId: A.t.id }).returning()))[0]!;
  await M((tx) => tx.insert(usuarioTenant).values([A, B, S].map((x) => ({ usuarioId: adm.id, tenantId: x.t.id, perfil: 'ADMIN_CLIENTE' as const }))));
  const hor = (await M((tx) => tx.insert(pontoHorarioContratual).values({ tenantId: A.t.id, codigo: 'ADM', durJornadaMin: 480, diasSemana: [1, 2, 3, 4, 5], regime: 'normal',
    pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }] }).returning()))[0]!;

  let nsr = 1;
  /** Dia de 9h (uma hora extra = +60 no banco). */
  const extra = async (cpf: string, d: string) => {
    const bs = [em(d, '08:00'), em(d, '12:00'), em(d, '13:00'), em(d, '18:00')];
    await M((tx) => tx.insert(pontoMarcacao).values(bs.map((b) => ({ tenantId: A.t.id, repId: A.rep.id, nsr, cpf, dtMarcacao: b, coletor: 1, hashRegistro: String(nsr++).padStart(64, '0') }))));
  };
  const novoEmp = async (nome: string, cpf: string, inicio: string) =>
    (await M((tx) => tx.insert(empregado).values({ tenantId: A.t.id, cpf, nome, horarioContratualId: hor.id, dataInicioPonto: inicio, dataAdmissao: inicio }).returning()))[0]!;
  const sucessor = async (id: string) => (await M((tx) => tx.select().from(empregado).where(eq(empregado.empregadoAnteriorId, id))))[0]!;
  const movsDe = (t: string, e: string) => M((tx) => tx.select().from(pontoBancoMov).where(and(eq(pontoBancoMov.tenantId, t), eq(pontoBancoMov.empregadoId, e))));
  const saldo = async (t: string, e: string, hoje = HOJE) => (await banco.saldo(t, e, hoje)).saldo?.saldoMin ?? null;
  const fotoBin = cripto.cifrarBytes(Buffer.from('foto')), miniBin = cripto.cifrarBytes(Buffer.from('mini'));

  // ── Ana: banco de setembro/outubro, foto, push, folga marcada, atestados, ajuste ──
  const ana = await novoEmp('Ana Banco', `8${suf}`, '2026-09-01');
  for (const d of ['2026-09-15', '2026-09-16', '2026-10-14', '2026-10-15', '2026-10-16']) await extra(ana.cpf, d);
  const loginAna = (await M((tx) => tx.insert(usuario).values({ email: `ana${suf}@x.com`, senhaHash: 'x', perfil: 'COLABORADOR', tenantId: A.t.id, empregadoId: ana.id }).returning()))[0]!;
  await M((tx) => tx.insert(empregadoFoto).values({ empregadoId: ana.id, tenantId: A.t.id, foto: fotoBin, miniatura: miniBin, status: 'APROVADA' }));
  await M((tx) => tx.insert(pushSubscription).values({ tenantId: A.t.id, usuarioId: loginAna.id, endpoint: `https://push/${suf}a`, p256dh: 'k', auth: 'a' }));
  await M((tx) => tx.insert(pontoAusencia).values({ tenantId: A.t.id, empregadoId: ana.id, tipo: 4, data: '2026-11-10', qtMinutos: 120, origem: 'BANCO_PARCIAL' }));
  await M((tx) => tx.insert(pontoBancoMov).values({ tenantId: A.t.id, empregadoId: ana.id, data: '2026-11-10', minutos: -120, tipo: 'DEBITO', descricao: 'Folga compensatória' }));
  const atest = (ini: string, fim: string) => ({ tenantId: A.t.id, empregadoId: ana.id, tipo: 'ATESTADO', dataInicio: ini, dataFim: fim, arquivo: cripto.cifrarBytes(Buffer.from('pdf')), arquivoNome: 'a.pdf', arquivoMime: 'application/pdf', arquivoBytes: 3, status: 'ABONADO' });
  await M((tx) => tx.insert(pontoDocumento).values([atest('2026-10-01', '2026-10-01'), atest('2026-10-30', '2026-11-03'), atest('2026-11-20', '2026-11-20')] as never));
  await M((tx) => tx.insert(pontoAjuste).values({ tenantId: A.t.id, empregadoId: ana.id, tipo: 'INCLUSAO', data: '2026-11-04', dtMarcacao: em('2026-11-04', '17:00'), tpMarc: 'S', observacao: 'esqueci', status: 'EM_ANALISE' } as never));

  const antes = await saldo(A.t.id, ana.id);
  ok(antes === 300 - 120, `saldo na IG antes: 5h de extra menos a folga marcada (= ${antes})`);
  const r = await svc.transferirClt(A.t.id, adm.id, ana.id, { destinoTenantId: B.t.id, data: '2026-11-01', preservarAdmissao: true, motivo: 'TRANSFERENCIA' });
  const anaB = await sucessor(ana.id);
  ok(r.bancoTrazidoMin === 300, `trouxe 5h00 de crédito (folga foi junto com o dia) (= ${r.bancoTrazidoMin})`);
  ok(r.avisos.some((a) => a.includes('Banco de horas') && a.includes('5h00')), 'aviso conta o saldo levado');
  ok(!r.avisos.some((a) => a.includes('não vai junto')), 'some o aviso antigo de "não vai junto"');
  const movB = await movsDe(B.t.id, anaB.id);
  const trazidos = movB.filter((m) => (m.descricao ?? '').includes('trazido de'));
  ok(trazidos.length === 5 && trazidos.map((m) => m.data).sort()[0] === '2026-09-15', 'destino: 5 lotes com as datas originais');
  const sB = await banco.saldo(B.t.id, anaB.id, HOJE);
  ok(sB.saldo?.saldoMin === 180, `saldo na TUTS: 5h - 2h da folga = 3h (= ${sB.saldo?.saldoMin})`);
  ok(sB.saldo?.proximoVencimento === '2027-04-14', `vencimento mantido: a folga consome 15 e 16/09; o próximo, de 14/10, vence em 14/04 como venceria na IG (= ${sB.saldo?.proximoVencimento})`);
  ok((await saldo(A.t.id, ana.id)) === 0, 'saldo na IG zerado');
  ok((await movsDe(A.t.id, ana.id)).some((m) => (m.descricao ?? '').startsWith('Saldo levado para TUTS')), 'IG: lançamento "levado para TUTS"');
  ok((await banco.trazerSaldoDaTransferencia(B.t.id, anaB.id, HOJE)) === 0 && (await saldo(B.t.id, anaB.id)) === 180, 'rodar de novo não traz duas vezes');
  // foto, push, dias
  const av = await cad.avatares(B.t.id);
  ok(!!av.empregados[anaB.id]?.foto, 'foto aparece no destino');
  const pushs = await M((tx) => tx.select().from(pushSubscription).where(eq(pushSubscription.usuarioId, loginAna.id)));
  ok(pushs.length === 1 && pushs[0]!.tenantId === B.t.id, 'celular passa a receber notificação do destino');
  const ausB = await M((tx) => tx.select().from(pontoAusencia).where(eq(pontoAusencia.empregadoId, anaB.id)));
  ok(ausB.length === 1 && ausB[0]!.data === '2026-11-10' && ausB[0]!.tenantId === B.t.id, 'folga de 10/11 foi para o destino');
  const docsA = await M((tx) => tx.select().from(pontoDocumento).where(eq(pontoDocumento.empregadoId, ana.id)));
  const docsB = await M((tx) => tx.select().from(pontoDocumento).where(eq(pontoDocumento.empregadoId, anaB.id)));
  ok(docsA.length === 2 && docsB.length === 2, `atestados: IG fica com 01/10 e 30/10–03/11; TUTS com 30/10–03/11 (cópia) e 20/11 (${docsA.length}/${docsB.length})`);
  const ajB = await M((tx) => tx.select().from(pontoAjuste).where(eq(pontoAjuste.empregadoId, anaB.id)));
  ok(ajB.length === 1 && ajB[0]!.tenantId === B.t.id, 'pedido de ajuste de 04/11 em análise foi para o destino');

  // ── Lucas: transferência no meio do mês; o último mês da origem vem depois ──
  const lucas = await novoEmp('Lucas Meio', `7${suf}`, '2026-10-01');
  for (const d of ['2026-10-20', '2026-11-03', '2026-11-04']) await extra(lucas.cpf, d);
  const r2 = await svc.transferirClt(A.t.id, adm.id, lucas.id, { destinoTenantId: B.t.id, data: '2026-11-16', preservarAdmissao: true, motivo: 'TRANSFERENCIA' });
  const lucasB = await sucessor(lucas.id);
  ok(r2.bancoTrazidoMin === 60, `na hora: só outubro (fechado) = 1h (= ${r2.bancoTrazidoMin})`);
  ok(r2.avisos.some((a) => a.includes('quando o mês fechar')), 'aviso: o resto vem quando novembro fechar na origem');
  const depois = await banco.trazerSaldoDaTransferencia(B.t.id, lucasB.id, '2026-12-02');
  ok(depois === 120, `em dezembro: novembro da IG (03 e 04/11) = 2h (= ${depois})`);
  ok((await saldo(A.t.id, lucas.id, '2026-12-02')) === 0, 'IG zerada depois do fechamento de novembro');
  ok((await saldo(B.t.id, lucasB.id, '2026-12-02')) === 180, 'TUTS com as 3h');

  // ── Bia: destino sem banco de horas: o saldo fica na origem ──
  const bia = await novoEmp('Bia SemBanco', `6${suf}`, '2026-10-01');
  await extra(bia.cpf, '2026-10-21');
  const r3 = await svc.transferirClt(A.t.id, adm.id, bia.id, { destinoTenantId: S.t.id, data: '2026-11-01', preservarAdmissao: true, motivo: 'TRANSFERENCIA' });
  ok(r3.bancoTrazidoMin === 0 && r3.avisos.some((a) => a.includes('sem banco de horas')), 'destino sem banco: avisa e não leva');
  ok((await saldo(A.t.id, bia.id)) === 60, 'saldo continua na origem para acertar lá');

  // ── Prestador: foto e push ──
  const mei = (await M((tx) => tx.insert(pessoalPrestador).values({ tenantId: A.t.id, tipo: 'MEI', nome: 'Duda MEI', documento: `5${suf}0001`, valorMensal: '3000.00', competenciaInicio: '2026-06' }).returning()))[0]!;
  const loginMei = (await M((tx) => tx.insert(usuario).values({ email: `mei${suf}@x.com`, senhaHash: 'x', perfil: 'PRESTADOR', tenantId: A.t.id, prestadorId: mei.id } as never).returning()))[0]!;
  await M((tx) => tx.insert(empregadoFoto).values({ empregadoId: mei.id, tenantId: A.t.id, foto: fotoBin, miniatura: miniBin, status: 'REVISAR' }));
  await M((tx) => tx.insert(pushSubscription).values({ tenantId: A.t.id, usuarioId: loginMei.id, endpoint: `https://push/${suf}m`, p256dh: 'k', auth: 'a' }));
  const rp = await svc.transferirPrestador(A.t.id, adm.id, mei.id, { destinoTenantId: B.t.id, competencia: '2026-11' });
  const avP = await cad.avatares(B.t.id);
  ok(!!avP.prestadores[rp.novoPrestadorId]?.foto, 'MEI: foto aparece no destino');
  const pm = await M((tx) => tx.select().from(pushSubscription).where(eq(pushSubscription.usuarioId, loginMei.id)));
  ok(pm[0]?.tenantId === B.t.id, 'MEI: notificação vem do destino');

  // ── Reparo: transferidos antes da correção (sem foto/push/dias no destino) ──
  await M((tx) => tx.delete(empregadoFoto).where(eq(empregadoFoto.empregadoId, anaB.id)));
  await M((tx) => tx.delete(empregadoFoto).where(eq(empregadoFoto.empregadoId, rp.novoPrestadorId)));
  await M((tx) => tx.update(pushSubscription).set({ tenantId: A.t.id }).where(eq(pushSubscription.usuarioId, loginAna.id)));
  await M((tx) => tx.update(pontoAusencia).set({ tenantId: A.t.id, empregadoId: ana.id }).where(eq(pontoAusencia.empregadoId, anaB.id)));
  await M((tx) => tx.update(pontoDocumento).set({ tenantId: A.t.id, empregadoId: ana.id }).where(and(eq(pontoDocumento.empregadoId, anaB.id), eq(pontoDocumento.dataInicio, '2026-11-20'))));
  await M((tx) => tx.delete(pontoDocumento).where(eq(pontoDocumento.empregadoId, anaB.id)));
  const rep1 = await svc.repararTransferidos();
  const rep2 = await svc.repararTransferidos();
  ok(rep1.fotos >= 2 && rep2.fotos === 0, `reparo copia as fotos que faltavam (${rep1.fotos}), e de novo não faz nada (${rep2.fotos})`);
  ok(!!(await cad.avatares(B.t.id)).empregados[anaB.id]?.foto && !!(await cad.avatares(B.t.id)).prestadores[rp.novoPrestadorId]?.foto, 'reparo: fotos de volta (CLT e MEI)');
  ok((await M((tx) => tx.select().from(pushSubscription).where(eq(pushSubscription.usuarioId, loginAna.id))))[0]?.tenantId === B.t.id, 'reparo: push de volta no destino');
  ok((await M((tx) => tx.select().from(pontoAusencia).where(eq(pontoAusencia.empregadoId, anaB.id)))).length === 1, 'reparo: folga de volta no destino');
  ok((await M((tx) => tx.select().from(pontoDocumento).where(eq(pontoDocumento.empregadoId, anaB.id)))).length === 2, 'reparo: atestados no destino, sem duplicar');
  ok((await movsDe(A.t.id, ana.id)).some((m) => (m.descricao ?? '').startsWith('Saldo levado')) && (await saldo(A.t.id, ana.id)) === 0, 'reparo não mexe no "levado para" da origem');
  ok((await saldo(B.t.id, anaB.id)) === 180, 'saldo do destino intacto depois do reparo');

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\n>>> TRANSFERENCIA-COMPLETA OK <<<');
  await client.end();
  process.exit(falhas ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await client.end(); process.exit(1); });
