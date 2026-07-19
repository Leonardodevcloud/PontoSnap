import 'reflect-metadata';
process.env.APP_CRYPTO_KEY = Buffer.alloc(32, 9).toString('base64');
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { schema, comoMaster, comTenant, tenant, empregado, usuario, pontoRep, pontoHorarioContratual, pontoAusencia, pontoBancoMov } from '@ponto/db';
import { BancoService } from '../src/banco/banco.service';
import { DocumentoService } from '../src/documento/documento.service';
import { TratamentoService } from '../src/tratamento/tratamento.service';
import { CriptoService } from '../src/common/cripto.service';

const client = postgres({ host: process.env.PGSOCKET!, database: 'postgres', user: 'app_user', password: 'x', max: 5 });
const db = drizzle(client, { schema });
const trat = new TratamentoService(db);
const banco = new BancoService(db, trat);
const docs = new DocumentoService(db, new CriptoService(), { enviar: async () => true } as never);
const B64 = Buffer.from('atestado-no-papel').toString('base64');

let falhas = 0;
const ok = (c: boolean, m: string) => { if (!c) falhas++; console.log(`${c ? 'OK  ' : 'FALHA'} — ${m}`); };

async function main() {
  const t = (await comoMaster(db, (tx) => tx.insert(tenant).values({
    cnpj: '66666666000166', razaoSocial: 'Folga LTDA', bancoTipoAcordo: 'INDIVIDUAL', bancoPrazoMeses: 6,
  }).returning()))[0]!;
  await comoMaster(db, (tx) => tx.insert(pontoRep).values({
    tenantId: t.id, tipoIdEmpregador: 1, documentoEmpregador: '66666666000166', razaoSocial: 'Folga LTDA',
    numeroInpi: 'BR512024009999-9', tipoIdDesenvolvedor: 1, documentoDesenvolvedor: '98765432000188',
  }).returning());
  const hor = (await comoMaster(db, (tx) => tx.insert(pontoHorarioContratual).values({
    tenantId: t.id, codigo: 'CH-COML', durJornadaMin: 480, pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }], diasSemana: [1, 2, 3, 4, 5], regime: 'normal',
  }).returning()))[0]!;
  const emp = (await comoMaster(db, (tx) => tx.insert(empregado).values({ tenantId: t.id, cpf: '77777777777', nome: 'João', horarioContratualId: hor.id }).returning()))[0]!;
  const admin = (await comoMaster(db, (tx) => tx.insert(usuario).values({ tenantId: t.id, email: 'rh@f.com', senhaHash: 'x', perfil: 'RH' }).returning()))[0]!;

  // ---------- FOLGA COMPENSATÓRIA ----------
  const DIA = '2026-07-13'; // segunda-feira, dia útil
  const folga = await banco.registrarFolga(t.id, emp.id, DIA);
  ok(folga.minutos === 480, `folga usa a jornada do dia (${folga.minutos} = 480)`);

  const aus = await comTenant(db, t.id, (tx) => tx.select().from(pontoAusencia).where(and(
    eq(pontoAusencia.empregadoId, emp.id), eq(pontoAusencia.data, DIA))));
  ok(aus.length === 1 && aus[0]!.tipo === 4, 'cria ausência tipo 4 (folga compensatória)');

  const movs = await comTenant(db, t.id, (tx) => tx.select().from(pontoBancoMov).where(and(
    eq(pontoBancoMov.empregadoId, emp.id), eq(pontoBancoMov.data, DIA))));
  ok(movs.length === 1 && movs[0]!.minutos === -480 && movs[0]!.tipo === 'DEBITO', 'debita 480min no banco');

  // A apuração daquele dia NÃO pode virar falta.
  const ap = await trat.apurarPeriodoCLT(t.id, emp.id, DIA, DIA, []);
  const dia = ap.resultado.dias.find((d) => d.data === DIA);
  ok(!!dia && dia.faltaMin === 0, `dia da folga não conta falta (falta=${dia?.faltaMin})`);
  ok(!!dia && dia.ehDescansoDia === true, 'dia da folga vira descanso na apuração');

  // Idempotência: registrar de novo o mesmo dia é rejeitado.
  let barrou = false;
  try { await banco.registrarFolga(t.id, emp.id, DIA); } catch { barrou = true; }
  ok(barrou, 'não deixa registrar folga duplicada no mesmo dia');

  // Folga parcial com horas informadas.
  const parcial = await banco.registrarFolga(t.id, emp.id, '2026-07-14', 120);
  ok(parcial.minutos === 120, `folga parcial usa as horas informadas (${parcial.minutos})`);

  // ---------- ATESTADO PELO RH ----------
  const abonado = await docs.registrarPeloRh(t.id, admin.id, {
    empregadoId: emp.id, tipo: 'ATESTADO', dataInicio: '2026-07-20', dataFim: '2026-07-21',
    arquivoBase64: B64, arquivoNome: 'papel.png', arquivoMime: 'image/png', abonar: true,
  });
  ok(abonado!.status === 'ABONADO', 'RH lança já abonado quando pede');

  const emAnalise = await docs.registrarPeloRh(t.id, admin.id, {
    empregadoId: emp.id, tipo: 'ATESTADO', dataInicio: '2026-07-22', dataFim: '2026-07-22',
    arquivoBase64: B64, arquivoNome: 'papel2.png', arquivoMime: 'image/png', abonar: false,
  });
  ok(emAnalise!.status === 'EM_ANALISE', 'RH pode deixar em análise se preferir');

  const naLista = await docs.meus(t.id, emp.id);
  ok(naLista.length === 2, `os 2 atestados lançados pelo RH aparecem pro funcionário (${naLista.length})`);

  console.log(falhas === 0 ? '\n>>> FOLGA + ATESTADO RH OK <<<' : `\n>>> ${falhas} FALHA(S) <<<`);
  await client.end();
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
