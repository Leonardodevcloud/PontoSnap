import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, gte } from 'drizzle-orm';
import {
  comoMaster, type Db,
  empregado, empregadoSalario, empregadoFoto, empregadoEscalaVigencia,
  pessoalCltConfig, pessoalCltCesta, pessoalDebito, pessoalExclusao,
  pessoalPrestador, pessoalPrestadorValor,
  pontoPerfilRegra, pontoHorarioContratual, pontoMarcacao,
  usuario, usuarioTenant, tenant,
} from '@ponto/db';
import { DB } from '../database/database.module';
import { PlanoLimiteService } from '../cobranca/plano-limite.service';

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_COMP = /^\d{4}-\d{2}$/;

type TxMaster = Parameters<Parameters<typeof comoMaster>[1]>[0];

interface TransferirCltDto {
  destinoTenantId: string;
  data: string;             // AAAA-MM-DD (data da transferência)
  preservarAdmissao: boolean;
  novaAdmissao?: string | null;
  motivo: 'TRANSFERENCIA' | 'DESLIGAMENTO';
}
interface TransferirPrestadorDto {
  destinoTenantId: string;
  competencia: string;      // AAAA-MM (a partir de quando sai da origem / entra no destino)
}

/**
 * Transferência de pessoa entre CNPJs do grupo. Mantém o histórico na origem e
 * recria a pessoa no destino (sem recadastrar), reaproveitando o mesmo login.
 * Roda tudo numa transação master (cruza duas empresas) para nunca deixar a
 * pessoa "no limbo".
 */
@Injectable()
export class TransferenciaService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly limites: PlanoLimiteService,
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

  // ─────────────────────────── info (pro formulário) ───────────────────────────

  async info(origem: string, usuarioId: string, tipo: 'CLT' | 'PRESTADOR', id: string, data?: string) {
    const empresas = await this.empresasDoUsuario(usuarioId);
    const origemNome = empresas.find((e) => e.tenantId === origem)?.razaoSocial ?? 'Empresa atual';
    const destinos = empresas
      .filter((e) => e.tenantId !== origem)
      .map((e) => ({ tenantId: e.tenantId, razaoSocial: e.razaoSocial, cnpj: e.cnpj }));
    const origemInfo = { razaoSocial: origemNome };

    if (tipo === 'CLT') {
      return comoMaster(this.db, async (tx) => {
        const e = (await tx.select().from(empregado).where(and(eq(empregado.tenantId, origem), eq(empregado.id, id))).limit(1))[0];
        if (!e) throw new NotFoundException('Funcionário não encontrado.');
        const debitos = (await tx.select().from(pessoalDebito)
          .where(and(eq(pessoalDebito.tenantId, origem), eq(pessoalDebito.pessoaTipo, 'CLT'), eq(pessoalDebito.pessoaId, id)))).length;
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
            chavePix: e.chavePix ?? null, debitosAbertos: debitos, batidasApos,
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

  // ─────────────────────────── transferir CLT ───────────────────────────

  async transferirClt(origem: string, usuarioId: string, empregadoId: string, p: TransferirCltDto) {
    if (!RE_DATA.test(p.data)) throw new BadRequestException('Data da transferência inválida.');
    if (!p.preservarAdmissao && p.novaAdmissao && !RE_DATA.test(p.novaAdmissao)) throw new BadRequestException('Data de admissão inválida.');
    await this.validarRota(usuarioId, origem, p.destinoTenantId);
    await this.limites.exigirVaga(p.destinoTenantId, 1);

    return comoMaster(this.db, async (tx) => {
      const e = (await tx.select().from(empregado).where(and(eq(empregado.tenantId, origem), eq(empregado.id, empregadoId))).limit(1))[0];
      if (!e) throw new NotFoundException('Funcionário não encontrado.');
      if (!e.ativo) throw new BadRequestException('Funcionário já está inativo na origem.');
      const jaLa = (await tx.select({ id: empregado.id }).from(empregado)
        .where(and(eq(empregado.tenantId, p.destinoTenantId), eq(empregado.cpf, e.cpf))).limit(1))[0];
      if (jaLa) throw new ConflictException('Esse CPF já tem cadastro na empresa de destino.');

      // Definições por empresa: remapeia perfil de regra e horários.
      const novoPerfil = e.perfilRegraId ? await this.copiarPerfil(tx, p.destinoTenantId, e.perfilRegraId) : null;
      const mapaHorario = new Map<string, string | null>();
      const copiarHorario = async (hid: string | null) => {
        if (!hid) return null;
        if (mapaHorario.has(hid)) return mapaHorario.get(hid)!;
        const nid = await this.copiarHorario(tx, p.destinoTenantId, hid);
        mapaHorario.set(hid, nid);
        return nid;
      };
      const novoHorarioEmp = await copiarHorario(e.horarioContratualId);

      const dataAdmissao = p.preservarAdmissao ? e.dataAdmissao : (p.novaAdmissao ?? p.data);
      const [novo] = await tx.insert(empregado).values({
        tenantId: p.destinoTenantId, cpf: e.cpf, nome: e.nome, pis: e.pis, matricula: e.matricula, pinHash: e.pinHash,
        horarioContratualId: novoHorarioEmp, cctId: null, perfilRegraId: novoPerfil, matriculaEsocial: e.matriculaEsocial,
        ativo: true, dataInicioPonto: p.data, dataAdmissao, cliente: e.cliente, cargo: e.cargo, chavePix: e.chavePix, salarioMensal: e.salarioMensal,
        celular: e.celular, emailPessoal: e.emailPessoal, contatoEmergencia: e.contatoEmergencia, avatarSemente: e.avatarSemente,
        trabalhoUf: e.trabalhoUf, trabalhoMunicipio: e.trabalhoMunicipio, trabalhoMunicipioNome: e.trabalhoMunicipioNome,
        empregadoAnteriorId: e.id,
      }).returning({ id: empregado.id });
      const novoId = novo!.id;

      // Salário (vigências)
      for (const s of await tx.select().from(empregadoSalario).where(and(eq(empregadoSalario.tenantId, origem), eq(empregadoSalario.empregadoId, empregadoId)))) {
        const { id: _i, tenantId: _t, empregadoId: _e, criadoEm: _c, ...rest } = s;
        await tx.insert(empregadoSalario).values({ ...rest, tenantId: p.destinoTenantId, empregadoId: novoId } as typeof empregadoSalario.$inferInsert);
      }
      // Benefícios (VR/VT/Pix/cargo)
      for (const c of await tx.select().from(pessoalCltConfig).where(and(eq(pessoalCltConfig.tenantId, origem), eq(pessoalCltConfig.empregadoId, empregadoId)))) {
        const { id: _i, tenantId: _t, empregadoId: _e, ...rest } = c;
        await tx.insert(pessoalCltConfig).values({ ...rest, tenantId: p.destinoTenantId, empregadoId: novoId } as typeof pessoalCltConfig.$inferInsert);
      }
      // Carência da cesta
      for (const c of await tx.select().from(pessoalCltCesta).where(and(eq(pessoalCltCesta.tenantId, origem), eq(pessoalCltCesta.empregadoId, empregadoId)))) {
        const { id: _i, tenantId: _t, empregadoId: _e, atualizadoEm: _a, ...rest } = c;
        await tx.insert(pessoalCltCesta).values({ ...rest, tenantId: p.destinoTenantId, empregadoId: novoId } as typeof pessoalCltCesta.$inferInsert);
      }
      // Escala (remapeia o horário contratual de cada vigência)
      for (const v of await tx.select().from(empregadoEscalaVigencia).where(and(eq(empregadoEscalaVigencia.tenantId, origem), eq(empregadoEscalaVigencia.empregadoId, empregadoId)))) {
        const { id: _i, tenantId: _t, empregadoId: _e, horarioContratualId, criadoEm: _c, ...rest } = v;
        const nh = await copiarHorario(horarioContratualId);
        if (!nh) continue;
        await tx.insert(empregadoEscalaVigencia).values({ ...rest, tenantId: p.destinoTenantId, empregadoId: novoId, horarioContratualId: nh } as typeof empregadoEscalaVigencia.$inferInsert);
      }
      // Débitos em aberto (seguem a pessoa)
      for (const d of await tx.select().from(pessoalDebito).where(and(eq(pessoalDebito.tenantId, origem), eq(pessoalDebito.pessoaTipo, 'CLT'), eq(pessoalDebito.pessoaId, empregadoId)))) {
        const { id: _i, tenantId: _t, pessoaId: _p, criadoEm: _c, ...rest } = d;
        await tx.insert(pessoalDebito).values({ ...rest, tenantId: p.destinoTenantId, pessoaId: novoId } as typeof pessoalDebito.$inferInsert);
      }
      // Foto
      const foto = (await tx.select().from(empregadoFoto).where(and(eq(empregadoFoto.tenantId, origem), eq(empregadoFoto.empregadoId, empregadoId))).limit(1))[0];
      if (foto) {
        const { empregadoId: _e, tenantId: _t, ...rest } = foto;
        await tx.insert(empregadoFoto).values({ ...rest, tenantId: p.destinoTenantId, empregadoId: novoId } as typeof empregadoFoto.$inferInsert);
      }
      // Login: a pessoa passa a ver o destino no app (mesmo e-mail e senha)
      await tx.update(usuario).set({ tenantId: p.destinoTenantId, empregadoId: novoId }).where(eq(usuario.empregadoId, empregadoId));
      // Encerra o vínculo na origem (histórico preservado)
      await tx.update(empregado).set({ ativo: false, dataSaida: p.data, motivoSaida: p.motivo })
        .where(and(eq(empregado.tenantId, origem), eq(empregado.id, empregadoId)));

      return { novoEmpregadoId: novoId, destinoTenantId: p.destinoTenantId };
    });
  }

  // ─────────────────────────── transferir prestador ───────────────────────────

  async transferirPrestador(origem: string, usuarioId: string, prestadorId: string, p: TransferirPrestadorDto) {
    if (!RE_COMP.test(p.competencia)) throw new BadRequestException('Competência inválida (use AAAA-MM).');
    await this.validarRota(usuarioId, origem, p.destinoTenantId);

    return comoMaster(this.db, async (tx) => {
      const pr = (await tx.select().from(pessoalPrestador).where(and(eq(pessoalPrestador.tenantId, origem), eq(pessoalPrestador.id, prestadorId))).limit(1))[0];
      if (!pr) throw new NotFoundException('Prestador não encontrado.');

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
      // Débitos em aberto (seguem a pessoa)
      for (const d of await tx.select().from(pessoalDebito).where(and(eq(pessoalDebito.tenantId, origem), eq(pessoalDebito.pessoaTipo, pr.tipo), eq(pessoalDebito.pessoaId, prestadorId)))) {
        const { id: _di, tenantId: _dt, pessoaId: _dp, criadoEm: _dc, ...drest } = d;
        await tx.insert(pessoalDebito).values({ ...drest, tenantId: p.destinoTenantId, pessoaId: novoId } as typeof pessoalDebito.$inferInsert);
      }
      // Login do portal (se houver)
      await tx.update(usuario).set({ tenantId: p.destinoTenantId, empregadoId: novoId }).where(eq(usuario.empregadoId, prestadorId));
      // Sai da folha da origem a partir da competência (os meses já fechados ficam na Tutts)
      await tx.insert(pessoalExclusao).values({ tenantId: origem, pessoaTipo: pr.tipo, pessoaId: prestadorId, competencia: p.competencia, escopo: 'DIANTE' })
        .onConflictDoUpdate({ target: [pessoalExclusao.tenantId, pessoalExclusao.pessoaTipo, pessoalExclusao.pessoaId, pessoalExclusao.competencia], set: { escopo: 'DIANTE' } });

      return { novoPrestadorId: novoId, destinoTenantId: p.destinoTenantId };
    });
  }
}
