import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, gt, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import {
  comoMaster, type Db,
  empregado, empregadoSalario, empregadoFoto, empregadoEscalaVigencia,
  pessoalCltConfig, pessoalCltCesta, pessoalDebito, pessoalExclusao, pessoalFechamento, pessoalLancamento,
  pessoalPrestador, pessoalPrestadorValor, pessoalNota, pessoalNfArquivo, prestadorConvite,
  pontoPerfilRegra, pontoHorarioContratual, pontoMarcacao, pontoCct, pontoEscala, pontoAfastamento,
  notificacaoPreferencia, usuario, usuarioTenant, tenant,
  pontoAusencia, pontoBancoMov, pontoBancoFechamento, pontoDocumento, pontoAjuste, pushSubscription,
} from '@ponto/db';
import { DB } from '../database/database.module';
import { PlanoLimiteService } from '../cobranca/plano-limite.service';
import { BancoService } from '../banco/banco.service';
import { registrarEventoRep } from '../fiscal/evento-rep';
import { centavos, parcelaNoMes } from '../pessoal/calculo';

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_COMP = /^\d{4}-(0[1-9]|1[0-2])$/;

type TxMaster = Parameters<Parameters<typeof comoMaster>[1]>[0];
type DebitoRow = typeof pessoalDebito.$inferSelect;

interface TransferirCltDto {
  destinoTenantId: string;
  data: string;             // AAAA-MM-DD: primeiro dia no destino
  preservarAdmissao: boolean;
  novaAdmissao?: string | null;
  motivo: 'TRANSFERENCIA' | 'DESLIGAMENTO';
}
interface TransferirPrestadorDto {
  destinoTenantId: string;
  competencia: string;      // AAAA-MM (a partir de quando sai da origem / entra no destino)
}

const somarDias = (data: string, n: number) => { const d = new Date(`${data}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mesLongo = (comp: string) => {
  const M = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return `${M[Number(comp.slice(5, 7)) - 1]} de ${comp.slice(0, 4)}`;
};

/**
 * Débito que ainda tem desconto a partir de `comp` (parcela no mês, ou começa
 * depois). Os já quitados ou encerrados antes não vão para o destino.
 */
function debitoAbertoEm(d: DebitoRow, comp: string): boolean {
  if (d.competenciaInicio > comp) return true;
  return parcelaNoMes({
    valorTotalCent: centavos(d.valorTotal), parcelas: d.parcelas, competenciaInicio: d.competenciaInicio, parcelasPagas: d.parcelasPagas,
    tipo: d.tipo === 'FIXO' ? 'FIXO' : 'PARCELADO', competenciaFim: d.competenciaFim,
  }, comp) != null;
}

/**
 * Transferência de pessoa entre CNPJs do grupo. Mantém o histórico na origem e
 * recria a pessoa no destino (sem recadastrar), reaproveitando o mesmo login.
 * Roda tudo numa transação master (cruza duas empresas) para nunca deixar a
 * pessoa "no limbo".
 *
 * Regra do mês da transferência: tudo o que é "do mês" (cesta, débitos e a
 * carga de benefícios do mês seguinte) fica com a empresa onde a pessoa
 * termina o mês — o destino. A origem fica com o ponto até o último dia lá.
 */
@Injectable()
export class TransferenciaService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly limites: PlanoLimiteService,
    private readonly banco: BancoService,
  ) {}

  /** Empresas que o usuário administra (origem + destinos possíveis). */
  private async empresasDoUsuario(usuarioId: string) {
    return comoMaster(this.db, (tx) =>
      tx.select({ tenantId: usuarioTenant.tenantId, razaoSocial: tenant.razaoSocial, cnpj: tenant.cnpj })
        .from(usuarioTenant).innerJoin(tenant, eq(tenant.id, usuarioTenant.tenantId))
        .where(eq(usuarioTenant.usuarioId, usuarioId)));
  }

  private async validarRota(usuarioId: string, origem: string, destino: string) {
    if (destino === origem) throw new BadRequestException('A empresa de destino é a mesma da origem.');
    const ids = new Set((await this.empresasDoUsuario(usuarioId)).map((e) => e.tenantId));
    if (!ids.has(origem) || !ids.has(destino)) throw new ForbiddenException('Empresa fora do seu acesso.');
  }

  /** Mês fechado na Gestão de Pessoal (retrato): não dá para tirar nem pôr gente nele. */
  private async exigirMesAberto(tx: TxMaster, tenantId: string, comp: string, quem: string) {
    const f = (await tx.select({ id: pessoalFechamento.id }).from(pessoalFechamento)
      .where(and(eq(pessoalFechamento.tenantId, tenantId), eq(pessoalFechamento.competencia, comp))).limit(1))[0];
    if (f) throw new BadRequestException(`${mesLongo(comp)} já está fechado na ${quem}. Reabra o mês lá ou escolha uma data no mês seguinte.`);
  }

  // ─────────────────────────── info (pro formulário) ───────────────────────────

  async info(origem: string, usuarioId: string, tipo: 'CLT' | 'PRESTADOR', id: string, data?: string) {
    const empresas = await this.empresasDoUsuario(usuarioId);
    const origemNome = empresas.find((e) => e.tenantId === origem)?.razaoSocial ?? 'Empresa atual';
    const destinos = empresas
      .filter((e) => e.tenantId !== origem)
      .map((e) => ({ tenantId: e.tenantId, razaoSocial: e.razaoSocial, cnpj: e.cnpj }));
    const origemInfo = { razaoSocial: origemNome };

    if (tipo === 'CLT') {
      // Saldo do banco que vai junto (null = sem banco na origem).
      let bancoSaldoMin: number | null = null;
      try { bancoSaldoMin = (await this.banco.saldo(origem, id, await this.hojeDe(origem))).saldo?.saldoMin ?? null; } catch { /* sem apuração: não mostra */ }
      return comoMaster(this.db, async (tx) => {
        const e = (await tx.select().from(empregado).where(and(eq(empregado.tenantId, origem), eq(empregado.id, id))).limit(1))[0];
        if (!e) throw new NotFoundException('Funcionário não encontrado.');
        const comp = data && RE_DATA.test(data) ? data.slice(0, 7) : null;
        const debitos = (await tx.select().from(pessoalDebito)
          .where(and(eq(pessoalDebito.tenantId, origem), eq(pessoalDebito.pessoaTipo, 'CLT'), eq(pessoalDebito.pessoaId, id))))
          .filter((d) => !comp || debitoAbertoEm(d, comp)).length;
        let batidasApos = 0;
        if (data && RE_DATA.test(data)) {
          batidasApos = (await tx.select({ id: pontoMarcacao.id }).from(pontoMarcacao)
            .where(and(eq(pontoMarcacao.tenantId, origem), eq(pontoMarcacao.cpf, e.cpf), gte(pontoMarcacao.dtMarcacao, new Date(`${data}T00:00:00-03:00`))))).length;
        }
        return {
          origem: origemInfo, destinos,
          pessoa: {
            tipo: 'CLT' as const, nome: e.nome, documento: e.cpf,
            cargo: e.cargo ?? null, salarioMensal: e.salarioMensal, dataAdmissao: e.dataAdmissao,
            chavePix: e.chavePix ?? null, debitosAbertos: debitos, batidasApos, bancoSaldoMin,
          },
        };
      });
    }

    return comoMaster(this.db, async (tx) => {
      const pr = (await tx.select().from(pessoalPrestador).where(and(eq(pessoalPrestador.tenantId, origem), eq(pessoalPrestador.id, id))).limit(1))[0];
      if (!pr) throw new NotFoundException('Prestador não encontrado.');
      const debitos = (await tx.select().from(pessoalDebito)
        .where(and(eq(pessoalDebito.tenantId, origem), eq(pessoalDebito.pessoaTipo, pr.tipo), eq(pessoalDebito.pessoaId, id)))).length;
      return {
        origem: origemInfo, destinos,
        pessoa: {
          tipo: pr.tipo as 'MEI' | 'MOTORISTA', nome: pr.nome, documento: pr.documento,
          valorMensal: pr.valorMensal, baseDias: pr.baseDias, chavePix: pr.chavePix,
          empresa: pr.empresa, debitosAbertos: debitos,
        },
      };
    });
  }

  // ─────────────────────────── helpers de cópia ───────────────────────────

  /** Copia o perfil de regra pro destino (reaproveita se já existir um com o mesmo nome). */
  private async copiarPerfil(tx: TxMaster, destino: string, perfilId: string): Promise<string | null> {
    const p = (await tx.select().from(pontoPerfilRegra).where(eq(pontoPerfilRegra.id, perfilId)).limit(1))[0];
    if (!p) return null;
    const existe = (await tx.select({ id: pontoPerfilRegra.id }).from(pontoPerfilRegra)
      .where(and(eq(pontoPerfilRegra.tenantId, destino), eq(pontoPerfilRegra.nome, p.nome))).limit(1))[0];
    if (existe) return existe.id;
    const { id: _i, tenantId: _t, criadoEm: _c, padrao: _p, ...rest } = p;
    const [n] = await tx.insert(pontoPerfilRegra)
      .values({ ...rest, tenantId: destino, padrao: false } as typeof pontoPerfilRegra.$inferInsert)
      .returning({ id: pontoPerfilRegra.id });
    return n!.id;
  }

  /** Copia a CCT (convenção coletiva) pro destino (reaproveita se já existir uma com o mesmo nome). */
  private async copiarCct(tx: TxMaster, destino: string, cctId: string): Promise<string | null> {
    const c = (await tx.select().from(pontoCct).where(eq(pontoCct.id, cctId)).limit(1))[0];
    if (!c) return null;
    const existe = (await tx.select({ id: pontoCct.id }).from(pontoCct)
      .where(and(eq(pontoCct.tenantId, destino), eq(pontoCct.nome, c.nome))).limit(1))[0];
    if (existe) return existe.id;
    const { id: _i, tenantId: _t, criadoEm: _c, ...rest } = c;
    const [n] = await tx.insert(pontoCct).values({ ...rest, tenantId: destino } as typeof pontoCct.$inferInsert).returning({ id: pontoCct.id });
    return n!.id;
  }

  /** Copia o horário contratual pro destino (reaproveita se já existir um com o mesmo código). */
  private async copiarHorario(tx: TxMaster, destino: string, horarioId: string): Promise<string | null> {
    const h = (await tx.select().from(pontoHorarioContratual).where(eq(pontoHorarioContratual.id, horarioId)).limit(1))[0];
    if (!h) return null;
    const existe = (await tx.select({ id: pontoHorarioContratual.id }).from(pontoHorarioContratual)
      .where(and(eq(pontoHorarioContratual.tenantId, destino), eq(pontoHorarioContratual.codigo, h.codigo))).limit(1))[0];
    if (existe) return existe.id;
    const { id: _i, tenantId: _t, criadoEm: _c, ...rest } = h;
    const [n] = await tx.insert(pontoHorarioContratual)
      .values({ ...rest, tenantId: destino } as typeof pontoHorarioContratual.$inferInsert)
      .returning({ id: pontoHorarioContratual.id });
    return n!.id;
  }

  /** Débitos que ainda têm desconto a partir de `comp` seguem a pessoa (mesma numeração de parcelas). */
  private async copiarDebitos(tx: TxMaster, origem: string, destino: string, tipo: string, deId: string, paraId: string, comp: string) {
    let n = 0;
    for (const d of await tx.select().from(pessoalDebito).where(and(eq(pessoalDebito.tenantId, origem), eq(pessoalDebito.pessoaTipo, tipo), eq(pessoalDebito.pessoaId, deId)))) {
      if (!debitoAbertoEm(d, comp)) continue;
      const { id: _i, tenantId: _t, pessoaId: _p, criadoEm: _c, ...rest } = d;
      await tx.insert(pessoalDebito).values({ ...rest, tenantId: destino, pessoaId: paraId } as typeof pessoalDebito.$inferInsert);
      n++;
    }
    return n;
  }

  // ─────────────────────────── transferir CLT ───────────────────────────

  /**
   * Foto de perfil (CLT e prestador ficam na mesma tabela, pela id da pessoa).
   * Não sobrescreve a que já existir no destino.
   */
  private async copiarFoto(tx: TxMaster, origem: string, destino: string, deId: string, paraId: string): Promise<boolean> {
    const foto = (await tx.select().from(empregadoFoto).where(and(eq(empregadoFoto.tenantId, origem), eq(empregadoFoto.empregadoId, deId))).limit(1))[0];
    if (!foto) return false;
    const { empregadoId: _e, tenantId: _t, ...rest } = foto;
    const r = await tx.insert(empregadoFoto).values({ ...rest, tenantId: destino, empregadoId: paraId } as typeof empregadoFoto.$inferInsert)
      .onConflictDoNothing().returning({ id: empregadoFoto.empregadoId });
    return r.length > 0;
  }

  /** Aparelhos com notificação ligada passam a receber do destino (o push é por empresa). */
  private async moverPush(tx: TxMaster, origem: string, destino: string, usuarioIds: string[]) {
    if (!usuarioIds.length) return;
    await tx.update(pushSubscription).set({ tenantId: destino })
      .where(and(eq(pushSubscription.tenantId, origem), inArray(pushSubscription.usuarioId, usuarioIds)));
  }

  /**
   * O que é de um dia em que a pessoa já está no destino passa para lá:
   * folgas e ausências marcadas, lançamentos avulsos do banco (a folga
   * compensatória e o débito dela andam juntos), atestados e pedidos de ajuste
   * em análise. Atestado que pega os dois lados vai copiado (cada empresa abona
   * os seus dias). Nada disso é arquivo fiscal: o AFD e as batidas ficam.
   */
  private async moverDiasDoDestino(tx: TxMaster, origem: string, destino: string, deId: string, paraId: string, data: string, reabrirBancoOrigem: boolean) {
    const aus = await tx.update(pontoAusencia).set({ tenantId: destino, empregadoId: paraId, repId: null })
      .where(and(eq(pontoAusencia.tenantId, origem), eq(pontoAusencia.empregadoId, deId), gte(pontoAusencia.data, data)))
      .returning({ id: pontoAusencia.id });
    const movs = await tx.update(pontoBancoMov).set({ tenantId: destino, empregadoId: paraId })
      .where(and(eq(pontoBancoMov.tenantId, origem), eq(pontoBancoMov.empregadoId, deId), gte(pontoBancoMov.data, data), isNull(pontoBancoMov.competencia),
        // o "levado para" do saldo transferido é da origem
        sql`coalesce(${pontoBancoMov.descricao}, '') not like '%(transferência)'`))
      .returning({ id: pontoBancoMov.id });
    const docsInteiros = await tx.update(pontoDocumento).set({ tenantId: destino, empregadoId: paraId })
      .where(and(eq(pontoDocumento.tenantId, origem), eq(pontoDocumento.empregadoId, deId), gte(pontoDocumento.dataInicio, data)))
      .returning({ id: pontoDocumento.id });
    let docsCopiados = 0;
    for (const d of await tx.select().from(pontoDocumento).where(and(eq(pontoDocumento.tenantId, origem), eq(pontoDocumento.empregadoId, deId),
      lt(pontoDocumento.dataInicio, data), gte(pontoDocumento.dataFim, data)))) {
      const ja = (await tx.select({ id: pontoDocumento.id }).from(pontoDocumento).where(and(eq(pontoDocumento.tenantId, destino), eq(pontoDocumento.empregadoId, paraId),
        eq(pontoDocumento.tipo, d.tipo), eq(pontoDocumento.dataInicio, d.dataInicio), eq(pontoDocumento.enviadoEm, d.enviadoEm))).limit(1))[0];
      if (ja) continue;
      const { id: _i, tenantId: _t, empregadoId: _e, analisadoPor: _a, ...rest } = d;
      await tx.insert(pontoDocumento).values({ ...rest, tenantId: destino, empregadoId: paraId } as typeof pontoDocumento.$inferInsert);
      docsCopiados++;
    }
    const ajustes = await tx.update(pontoAjuste).set({ tenantId: destino, empregadoId: paraId })
      .where(and(eq(pontoAjuste.tenantId, origem), eq(pontoAjuste.empregadoId, deId), gte(pontoAjuste.data, data),
        eq(pontoAjuste.status, 'EM_ANALISE'), isNull(pontoAjuste.marcacaoId)))
      .returning({ id: pontoAjuste.id });
    // Banco da origem: mês já fechado que pega dias depois da saída é refeito
    // (sem esses dias) na próxima sincronização. Só na hora da transferência:
    // depois disso o fechamento da origem já está certo e não se mexe.
    if (reabrirBancoOrigem) await tx.delete(pontoBancoFechamento).where(and(eq(pontoBancoFechamento.tenantId, origem), eq(pontoBancoFechamento.empregadoId, deId),
      gte(pontoBancoFechamento.competencia, data.slice(0, 7))));
    return { ausencias: aus.length, bancoAvulsos: movs.length, atestados: docsInteiros.length + docsCopiados, ajustes: ajustes.length };
  }

  /**
   * Corrige quem já foi transferido antes de a transferência levar tudo:
   * foto (CLT e prestador), notificações, e os dias do destino (folgas,
   * atestados, ajustes, avulsos do banco). Não sobrescreve nada que já exista
   * no destino. O saldo do banco vem sozinho na sincronização do banco.
   * Idempotente; roda no boot (ver TransferenciaReparoService).
   */
  async repararTransferidos(): Promise<{ pessoas: number; fotos: number }> {
    return comoMaster(this.db, async (tx) => {
      let pessoas = 0, fotos = 0;
      const clts = await tx.select({ id: empregado.id, tenantId: empregado.tenantId, anterior: empregado.empregadoAnteriorId })
        .from(empregado).where(sql`${empregado.empregadoAnteriorId} is not null`);
      for (const n of clts) {
        const a = (await tx.select({ id: empregado.id, tenantId: empregado.tenantId, saida: empregado.dataSaida }).from(empregado)
          .where(eq(empregado.id, n.anterior!)).limit(1))[0];
        if (!a?.saida) continue;
        pessoas++;
        if (await this.copiarFoto(tx, a.tenantId, n.tenantId, a.id, n.id)) fotos++;
        const us = (await tx.select({ id: usuario.id }).from(usuario).where(eq(usuario.empregadoId, n.id))).map((u) => u.id);
        await this.moverPush(tx, a.tenantId, n.tenantId, us);
        await this.moverDiasDoDestino(tx, a.tenantId, n.tenantId, a.id, n.id, a.saida, false);
      }
      const prests = await tx.select({ id: pessoalPrestador.id, tenantId: pessoalPrestador.tenantId, anterior: pessoalPrestador.prestadorAnteriorId })
        .from(pessoalPrestador).where(sql`${pessoalPrestador.prestadorAnteriorId} is not null`);
      for (const n of prests) {
        const a = (await tx.select({ id: pessoalPrestador.id, tenantId: pessoalPrestador.tenantId }).from(pessoalPrestador)
          .where(eq(pessoalPrestador.id, n.anterior!)).limit(1))[0];
        if (!a) continue;
        pessoas++;
        if (await this.copiarFoto(tx, a.tenantId, n.tenantId, a.id, n.id)) fotos++;
        const us = (await tx.select({ id: usuario.id }).from(usuario).where(eq(usuario.prestadorId, n.id))).map((u) => u.id);
        await this.moverPush(tx, a.tenantId, n.tenantId, us);
      }
      return { pessoas, fotos };
    });
  }

  async transferirClt(origem: string, usuarioId: string, empregadoId: string, p: TransferirCltDto) {
    if (!RE_DATA.test(p.data)) throw new BadRequestException('Data da transferência inválida.');
    if (!p.preservarAdmissao && p.novaAdmissao && !RE_DATA.test(p.novaAdmissao)) throw new BadRequestException('Data de admissão inválida.');
    await this.validarRota(usuarioId, origem, p.destinoTenantId);
    await this.limites.exigirVaga(p.destinoTenantId, 1);
    const compEntrada = p.data.slice(0, 7);

    const res = await comoMaster(this.db, async (tx) => {
      const e = (await tx.select().from(empregado).where(and(eq(empregado.tenantId, origem), eq(empregado.id, empregadoId))).limit(1))[0];
      if (!e) throw new NotFoundException('Funcionário não encontrado.');
      if (!e.ativo) throw new BadRequestException('Funcionário já está inativo na origem.');
      if (e.dataInicioPonto && p.data <= e.dataInicioPonto) throw new BadRequestException('A transferência tem que ser depois do início dele no ponto da origem.');
      const jaLa = (await tx.select({ id: empregado.id }).from(empregado)
        .where(and(eq(empregado.tenantId, p.destinoTenantId), eq(empregado.cpf, e.cpf))).limit(1))[0];
      if (jaLa) throw new ConflictException('Esse CPF já tem cadastro na empresa de destino.');
      // O mês da entrada não pode estar fechado em nenhum dos dois lados: na
      // origem o retrato já teria a pessoa no mês inteiro; no destino, sem ela.
      await this.exigirMesAberto(tx, origem, compEntrada, 'empresa de origem');
      await this.exigirMesAberto(tx, p.destinoTenantId, compEntrada, 'empresa de destino');

      const avisos: string[] = [];
      // Definições por empresa: remapeia perfil de regra, CCT e horários.
      const novoPerfil = e.perfilRegraId ? await this.copiarPerfil(tx, p.destinoTenantId, e.perfilRegraId) : null;
      const novaCct = e.cctId ? await this.copiarCct(tx, p.destinoTenantId, e.cctId) : null;
      const mapaHorario = new Map<string, string | null>();
      const copiarHorario = async (hid: string | null) => {
        if (!hid) return null;
        if (mapaHorario.has(hid)) return mapaHorario.get(hid)!;
        const nid = await this.copiarHorario(tx, p.destinoTenantId, hid);
        mapaHorario.set(hid, nid);
        return nid;
      };
      const novoHorarioEmp = await copiarHorario(e.horarioContratualId);

      // Matrícula é única por empresa: se já existe no destino, entra sem.
      let matricula = e.matricula;
      if (matricula) {
        const usada = (await tx.select({ id: empregado.id }).from(empregado)
          .where(and(eq(empregado.tenantId, p.destinoTenantId), eq(empregado.matricula, matricula))).limit(1))[0];
        if (usada) { avisos.push(`A matrícula ${matricula} já existe no destino: ele entrou sem matrícula (defina em Funcionários › Cadastro).`); matricula = null; }
      }

      const dataAdmissao = p.preservarAdmissao ? e.dataAdmissao : (p.novaAdmissao ?? p.data);
      const [novo] = await tx.insert(empregado).values({
        tenantId: p.destinoTenantId, cpf: e.cpf, nome: e.nome, pis: e.pis, matricula, pinHash: e.pinHash,
        horarioContratualId: novoHorarioEmp, cctId: novaCct, perfilRegraId: novoPerfil, matriculaEsocial: e.matriculaEsocial,
        ativo: true, dataInicioPonto: p.data, dataAdmissao, cliente: e.cliente, cargo: e.cargo, chavePix: e.chavePix, salarioMensal: e.salarioMensal,
        celular: e.celular, emailPessoal: e.emailPessoal, contatoEmergencia: e.contatoEmergencia, avatarSemente: e.avatarSemente,
        trabalhoUf: e.trabalhoUf, trabalhoMunicipio: e.trabalhoMunicipio, trabalhoMunicipioNome: e.trabalhoMunicipioNome,
        cadastroAtualizadoEm: e.cadastroAtualizadoEm, empregadoAnteriorId: e.id,
      }).returning({ id: empregado.id });
      const novoId = novo!.id;

      // Salário (vigências)
      for (const s of await tx.select().from(empregadoSalario).where(and(eq(empregadoSalario.tenantId, origem), eq(empregadoSalario.empregadoId, empregadoId)))) {
        const { id: _i, tenantId: _t, empregadoId: _e, criadoEm: _c, ...rest } = s;
        await tx.insert(empregadoSalario).values({ ...rest, tenantId: p.destinoTenantId, empregadoId: novoId } as typeof empregadoSalario.$inferInsert);
      }
      // Benefícios (VR/VT, home office), com as vigências
      for (const c of await tx.select().from(pessoalCltConfig).where(and(eq(pessoalCltConfig.tenantId, origem), eq(pessoalCltConfig.empregadoId, empregadoId)))) {
        const { id: _i, tenantId: _t, empregadoId: _e, ...rest } = c;
        await tx.insert(pessoalCltConfig).values({ ...rest, tenantId: p.destinoTenantId, empregadoId: novoId } as typeof pessoalCltConfig.$inferInsert);
      }
      // Cesta: "recebe sim/não" sempre segue. O mês escolhido da carência só
      // segue se a admissão foi mantida; com admissão nova, a carência recomeça.
      for (const c of await tx.select().from(pessoalCltCesta).where(and(eq(pessoalCltCesta.tenantId, origem), eq(pessoalCltCesta.empregadoId, empregadoId)))) {
        const cestaDesde = p.preservarAdmissao ? c.cestaDesde : null;
        if (c.recebe && !cestaDesde) continue; // recebe, no automático = sem linha
        await tx.insert(pessoalCltCesta).values({ tenantId: p.destinoTenantId, empregadoId: novoId, recebe: c.recebe, cestaDesde });
      }
      // Escala (remapeia o horário contratual de cada vigência)
      for (const v of await tx.select().from(empregadoEscalaVigencia).where(and(eq(empregadoEscalaVigencia.tenantId, origem), eq(empregadoEscalaVigencia.empregadoId, empregadoId)))) {
        const { id: _i, tenantId: _t, empregadoId: _e, horarioContratualId, criadoEm: _c, ...rest } = v;
        const nh = await copiarHorario(horarioContratualId);
        if (!nh) continue;
        await tx.insert(empregadoEscalaVigencia).values({ ...rest, tenantId: p.destinoTenantId, empregadoId: novoId, horarioContratualId: nh } as typeof empregadoEscalaVigencia.$inferInsert);
      }
      // Dias da escala 12x36 já gerados a partir da data
      const dias12 = await tx.select({ data: pontoEscala.data }).from(pontoEscala)
        .where(and(eq(pontoEscala.tenantId, origem), eq(pontoEscala.empregadoId, empregadoId), gte(pontoEscala.data, p.data)));
      if (dias12.length) await tx.insert(pontoEscala).values(dias12.map((x) => ({ tenantId: p.destinoTenantId, empregadoId: novoId, data: x.data })));
      // Férias e afastamentos que ainda vão acontecer (o pedaço a partir da data)
      for (const a of await tx.select().from(pontoAfastamento).where(and(eq(pontoAfastamento.tenantId, origem), eq(pontoAfastamento.empregadoId, empregadoId), gte(pontoAfastamento.dataFim, p.data)))) {
        await tx.insert(pontoAfastamento).values({
          tenantId: p.destinoTenantId, empregadoId: novoId, tipo: a.tipo, dataInicio: a.dataInicio > p.data ? a.dataInicio : p.data, dataFim: a.dataFim,
          observacao: a.observacao, criadoPor: a.criadoPor,
        });
      }
      // Débitos em aberto (seguem a pessoa; o do mês da entrada já é do destino)
      const nDeb = await this.copiarDebitos(tx, origem, p.destinoTenantId, 'CLT', empregadoId, novoId, compEntrada);
      // Lançamentos de meses que já são do destino (observação do mês)
      const compPrimeiroDestinoInteiro = p.data.endsWith('-01') ? compEntrada : null;
      if (compPrimeiroDestinoInteiro) {
        await tx.update(pessoalLancamento).set({ tenantId: p.destinoTenantId, pessoaId: novoId })
          .where(and(eq(pessoalLancamento.tenantId, origem), eq(pessoalLancamento.pessoaTipo, 'CLT'), eq(pessoalLancamento.pessoaId, empregadoId), gte(pessoalLancamento.competencia, compPrimeiroDestinoInteiro)));
      }
      // Foto de perfil
      await this.copiarFoto(tx, origem, p.destinoTenantId, empregadoId, novoId);
      // Folgas, atestados, ajustes e avulsos do banco de dias que já são do destino
      await this.moverDiasDoDestino(tx, origem, p.destinoTenantId, empregadoId, novoId, p.data, true);
      // Preferências de notificação do app
      const pref = (await tx.select().from(notificacaoPreferencia).where(eq(notificacaoPreferencia.empregadoId, empregadoId)).limit(1))[0];
      if (pref) {
        const { id: _i, tenantId: _t, empregadoId: _e, criadoEm: _c, atualizadoEm: _a, ...rest } = pref;
        await tx.insert(notificacaoPreferencia).values({ ...rest, tenantId: p.destinoTenantId, empregadoId: novoId } as typeof notificacaoPreferencia.$inferInsert);
      }
      // Login: a pessoa passa a ver o destino no app (mesmo e-mail e senha), e
      // os aparelhos dela seguem recebendo as notificações.
      const logins = await tx.update(usuario).set({ tenantId: p.destinoTenantId, empregadoId: novoId }).where(eq(usuario.empregadoId, empregadoId)).returning({ id: usuario.id });
      await this.moverPush(tx, origem, p.destinoTenantId, logins.map((l) => l.id));
      // Encerra o vínculo na origem (histórico preservado; o ponto vai até a véspera da data)
      await tx.update(empregado).set({ ativo: false, dataSaida: p.data, motivoSaida: p.motivo })
        .where(and(eq(empregado.tenantId, origem), eq(empregado.id, empregadoId)));

      // Registro 5 do AFD: exclusão no REP da origem, inclusão no REP do destino.
      await registrarEventoRep(tx as never, origem, { tipo: 5, operacao: 'E', cpfEmpregado: e.cpf, nomeEmpregado: e.nome });
      await registrarEventoRep(tx as never, p.destinoTenantId, { tipo: 5, operacao: 'I', cpfEmpregado: e.cpf, nomeEmpregado: e.nome });

      if (!p.data.endsWith('-01')) {
        avisos.push(`Como a data não é dia 1, ${mesLongo(compEntrada)} fica dividido: a origem fica com o ponto até ${somarDias(p.data, -1).split('-').reverse().join('/')}; o destino, com o resto do mês, a cesta, os débitos e a carga de benefícios do mês seguinte.`);
      }
      return { novoEmpregadoId: novoId, destinoTenantId: p.destinoTenantId, debitosLevados: nDeb, avisos };
    });
    // Banco de horas: o saldo da origem vai para o destino (fora da transação
    // acima, porque o cálculo apura a origem). O que a origem só fecha depois
    // (o último mês dela) vem sozinho na sincronização do banco.
    const r = { ...res, bancoTrazidoMin: 0 };
    try {
      r.bancoTrazidoMin = await this.banco.trazerSaldoDaTransferencia(p.destinoTenantId, r.novoEmpregadoId, await this.hojeDe(p.destinoTenantId));
      if (r.bancoTrazidoMin !== 0) {
        const m = Math.abs(r.bancoTrazidoMin);
        r.avisos.push(`Banco de horas: ${r.bancoTrazidoMin > 0 ? 'saldo' : 'saldo negativo'} de ${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')} foi para o destino.`);
      }
    } catch { /* sem banco/apuração: segue; a sincronização tenta de novo */ }
    const cfgO = await this.banco.configBanco(origem, empregadoId);
    const cfgD = await this.banco.configBanco(p.destinoTenantId, r.novoEmpregadoId);
    if (cfgO.ativo && !cfgD.ativo) r.avisos.push('No destino ele está sem banco de horas: o saldo dele fica na origem para acertar lá (pagar ou compensar).');
    else if (cfgO.ativo && p.data > `${(await this.hojeDe(origem)).slice(0, 7)}-01`) r.avisos.push('O saldo do banco que ele ainda fizer na origem até a data vai para o destino quando o mês fechar lá.');
    return r;
  }

  private async hojeDe(tenantId: string): Promise<string> {
    const t = (await comoMaster(this.db, (tx) => tx.select({ fuso: tenant.fuso }).from(tenant).where(eq(tenant.id, tenantId)).limit(1)))[0];
    const fuso = (t?.fuso ?? '-0300').replace(':', '');
    const sinal = fuso.startsWith('-') ? -1 : 1;
    const min = sinal * (Number(fuso.slice(1, 3)) * 60 + Number(fuso.slice(3, 5)));
    return new Date(Date.now() + min * 60_000).toISOString().slice(0, 10);
  }

  // ─────────────────────────── transferir prestador ───────────────────────────

  async transferirPrestador(origem: string, usuarioId: string, prestadorId: string, p: TransferirPrestadorDto) {
    if (!RE_COMP.test(p.competencia)) throw new BadRequestException('Competência inválida (use AAAA-MM).');
    await this.validarRota(usuarioId, origem, p.destinoTenantId);

    return comoMaster(this.db, async (tx) => {
      const pr = (await tx.select().from(pessoalPrestador).where(and(eq(pessoalPrestador.tenantId, origem), eq(pessoalPrestador.id, prestadorId))).limit(1))[0];
      if (!pr) throw new NotFoundException('Prestador não encontrado.');
      if (p.competencia < pr.competenciaInicio) throw new BadRequestException(`Ele só entrou na origem em ${mesLongo(pr.competenciaInicio)}.`);
      // Já saiu da origem (transferência anterior ou "tirar daqui em diante")?
      const saiu = (await tx.select().from(pessoalExclusao).where(and(eq(pessoalExclusao.tenantId, origem), eq(pessoalExclusao.pessoaTipo, pr.tipo),
        eq(pessoalExclusao.pessoaId, prestadorId), eq(pessoalExclusao.escopo, 'DIANTE'), lte(pessoalExclusao.competencia, p.competencia))).limit(1))[0];
      if (saiu) throw new BadRequestException(`Ele já saiu da origem em ${mesLongo(saiu.competencia)}.`);
      // Mesmo documento já ativo no destino: seria cadastro duplicado.
      if (pr.documento) {
        const jaLa = await tx.select({ id: pessoalPrestador.id }).from(pessoalPrestador)
          .where(and(eq(pessoalPrestador.tenantId, p.destinoTenantId), eq(pessoalPrestador.tipo, pr.tipo), eq(pessoalPrestador.documento, pr.documento)));
        for (const j of jaLa) {
          const fora = (await tx.select({ id: pessoalExclusao.id }).from(pessoalExclusao).where(and(eq(pessoalExclusao.tenantId, p.destinoTenantId),
            eq(pessoalExclusao.pessoaId, j.id), eq(pessoalExclusao.escopo, 'DIANTE'), lte(pessoalExclusao.competencia, p.competencia))).limit(1))[0];
          if (!fora) throw new ConflictException('Esse documento já tem um prestador ativo na empresa de destino.');
        }
      }
      await this.exigirMesAberto(tx, origem, p.competencia, 'empresa de origem');
      await this.exigirMesAberto(tx, p.destinoTenantId, p.competencia, 'empresa de destino');
      // Nota liberada, NF enviada ou pagamento já registrado na origem para um
      // mês que passaria ao destino: o tomador da nota é a origem — não dá para
      // mover sem desfazer lá primeiro.
      const notas = await tx.select({ c: pessoalNota.competencia }).from(pessoalNota)
        .where(and(eq(pessoalNota.tenantId, origem), eq(pessoalNota.pessoaId, prestadorId), gte(pessoalNota.competencia, p.competencia)));
      const nfs = await tx.select({ c: pessoalNfArquivo.competencia }).from(pessoalNfArquivo)
        .where(and(eq(pessoalNfArquivo.tenantId, origem), eq(pessoalNfArquivo.pessoaTipo, pr.tipo), eq(pessoalNfArquivo.pessoaId, prestadorId), gte(pessoalNfArquivo.competencia, p.competencia)));
      const lancs = await tx.select().from(pessoalLancamento)
        .where(and(eq(pessoalLancamento.tenantId, origem), eq(pessoalLancamento.pessoaTipo, pr.tipo), eq(pessoalLancamento.pessoaId, prestadorId), gte(pessoalLancamento.competencia, p.competencia)));
      const travado = [...notas.map((x) => x.c), ...nfs.map((x) => x.c), ...lancs.filter((l) => l.pago || l.nfNumero).map((l) => l.competencia)].sort()[0];
      if (travado) throw new BadRequestException(`Já tem nota, NF ou pagamento de ${mesLongo(travado)} na origem. Transfira a partir do mês seguinte ou desfaça esses registros lá.`);

      // Cria o prestador no destino a partir da competência escolhida.
      const { id: _i, tenantId: _t, criadoEm: _c, competenciaInicio: _ci, prestadorAnteriorId: _pa, ...rest } = pr;
      const [novo] = await tx.insert(pessoalPrestador)
        .values({ ...rest, tenantId: p.destinoTenantId, competenciaInicio: p.competencia, prestadorAnteriorId: pr.id } as typeof pessoalPrestador.$inferInsert)
        .returning({ id: pessoalPrestador.id });
      const novoId = novo!.id;

      // Valores (vigências)
      for (const v of await tx.select().from(pessoalPrestadorValor).where(and(eq(pessoalPrestadorValor.tenantId, origem), eq(pessoalPrestadorValor.prestadorId, prestadorId)))) {
        const { id: _vi, tenantId: _vt, prestadorId: _vp, criadoEm: _vc, ...vrest } = v;
        await tx.insert(pessoalPrestadorValor).values({ ...vrest, tenantId: p.destinoTenantId, prestadorId: novoId } as typeof pessoalPrestadorValor.$inferInsert);
      }
      // Débitos em aberto (seguem a pessoa, mesma numeração de parcelas)
      const nDeb = await this.copiarDebitos(tx, origem, p.destinoTenantId, pr.tipo, prestadorId, novoId, p.competencia);
      // Lançamentos ainda sem nota/pagamento dos meses que passam ao destino (extras, faltas, dias da semana)
      if (lancs.length) {
        await tx.update(pessoalLancamento).set({ tenantId: p.destinoTenantId, pessoaId: novoId })
          .where(inArray(pessoalLancamento.id, lancs.map((l) => l.id)));
      }
      // Foto de perfil
      await this.copiarFoto(tx, origem, p.destinoTenantId, prestadorId, novoId);
      // Login do portal (se houver): o vínculo do prestador é usuario.prestador_id
      const logins = await tx.update(usuario).set({ tenantId: p.destinoTenantId, prestadorId: novoId }).where(eq(usuario.prestadorId, prestadorId)).returning({ id: usuario.id });
      await this.moverPush(tx, origem, p.destinoTenantId, logins.map((l) => l.id));
      // Convite de primeiro acesso ainda não usado: passa a criar o acesso no destino
      await tx.update(prestadorConvite).set({ tenantId: p.destinoTenantId, prestadorId: novoId })
        .where(and(eq(prestadorConvite.prestadorId, prestadorId), isNull(prestadorConvite.usadoEm), gt(prestadorConvite.expiraEm, new Date())));
      // Sai da folha da origem a partir da competência (os meses anteriores ficam na origem)
      await tx.insert(pessoalExclusao).values({ tenantId: origem, pessoaTipo: pr.tipo, pessoaId: prestadorId, competencia: p.competencia, escopo: 'DIANTE' })
        .onConflictDoUpdate({ target: [pessoalExclusao.tenantId, pessoalExclusao.pessoaTipo, pessoalExclusao.pessoaId, pessoalExclusao.competencia], set: { escopo: 'DIANTE' } });

      return { novoPrestadorId: novoId, destinoTenantId: p.destinoTenantId, debitosLevados: nDeb, avisos: [] as string[] };
    });
  }
}
