import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import {
  pontoRep, pontoMarcacao, empregado, tenant, usuario, pontoHorarioContratual, comTenant, type Db,
} from '@ponto/db';
import { proximaMarcacao, gerarComprovante, assinarPdfPAdES, resolverBatida, inicioDoDia, fimDoDia, diaDaSemanaLocal } from '@ponto/rep-core';
import { Coletor, OnlineOffline, TipoIdentificador } from '@ponto/shared';
import { DB } from '../database/database.module';
import { CertificadoService } from '../certificado/certificado.service';
import { ajustesAprovados } from '../tratamento/ajustes';

export interface BaterParams {
  tenantId: string; cpf: string; coletor: Coletor;
  onlineOffline?: OnlineOffline; dtMarcacao?: Date;
  ipOrigem?: string | null; latitude?: number | null; longitude?: number | null;
  observacao?: string | null;
  /** Hora do relógio do aparelho (offline). */
  dtAparelho?: Date | null;
  /** O app capturou esta batida sem rede? */
  declaradoOffline?: boolean;
}

@Injectable()
export class MarcacaoService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly certs: CertificadoService,
  ) {}

  async bater(p: BaterParams) {
    return comTenant(this.db, p.tenantId, async (tx) => {
      const reps = await tx.select().from(pontoRep)
        .where(eq(pontoRep.tenantId, p.tenantId)).for('update').limit(1);
      const rep = reps[0];
      if (!rep) throw new NotFoundException('REP-P não configurado para este tenant');

      // Fuso vigente do tenant: entra no hash e fica gravado na marcação.
      const t = (await tx.select({ fuso: tenant.fuso }).from(tenant).where(eq(tenant.id, p.tenantId)).limit(1))[0];
      const fuso = t?.fuso ?? '-0300';

      // O NSR vem do contador do REP, que é compartilhado com os registros
      // 2, 5 e 6 do AFD. O hash anterior vem da última MARCAÇÃO e pode ser
      // nulo mesmo com NSR já avançado (ex.: empresa e funcionários gravados
      // antes da primeira batida).
      const anterior = { nsr: Number(rep.ultimoNsr ?? 0), hashRegistro: rep.ultimoHash ?? null };

      // Resolve hora e flag: offline usa a hora do aparelho e marca a divergência;
      // online confia no servidor. Nunca recusa — só sinaliza.
      const r = resolverBatida(
        { dtAparelho: p.dtAparelho ?? p.dtMarcacao ?? null, declaradoOffline: p.declaradoOffline },
        new Date());
      const dtMarcacao = r.dtMarcacao;
      const dtGravacao = r.dtGravacao;
      const onlineOffline = r.onlineOffline;

      const g = proximaMarcacao(
        { cpf: p.cpf, dtMarcacao, dtGravacao, coletor: p.coletor, onlineOffline }, anterior, fuso);

      await tx.insert(pontoMarcacao).values({
        tenantId: p.tenantId, repId: rep.id, nsr: g.nsr, cpf: p.cpf,
        dtMarcacao, dtGravacao, coletor: p.coletor, onlineOffline, fuso,
        hashRegistro: g.hashRegistro, hashAnterior: g.hashAnterior,
        ipOrigem: p.ipOrigem ?? null,
        latitude: p.latitude != null ? String(p.latitude) : null,
        longitude: p.longitude != null ? String(p.longitude) : null,
        // Vai no INSERT: o gatilho de imutabilidade nunca deixaria isso virar UPDATE.
        observacao: p.observacao?.trim() || null,
        defasagemSeg: r.defasagemSeg || null,
      });
      await tx.update(pontoRep).set({ ultimoNsr: g.nsr, ultimoHash: g.hashRegistro }).where(eq(pontoRep.id, rep.id));
      return g;
    });
  }

  async baterAutenticado(
    usuarioId: string, tenantId: string, coletor: Coletor,
    geo?: {
      latitude?: number | null; longitude?: number | null;
      ipOrigem?: string | null; observacao?: string | null;
      dtAparelho?: Date | null; declaradoOffline?: boolean;
    },
  ) {
    const cpf = await comTenant(this.db, tenantId, async (tx) => {
      const us = await tx.select().from(usuario).where(eq(usuario.id, usuarioId)).limit(1);
      const u = us[0];
      if (!u?.empregadoId) throw new BadRequestException('Usuário não vinculado a um empregado');
      const es = await tx.select().from(empregado).where(eq(empregado.id, u.empregadoId)).limit(1);
      const e = es[0];
      if (!e) throw new NotFoundException('Empregado não encontrado');
      return e.cpf;
    });
    return this.bater({ tenantId, cpf, coletor, ...geo });
  }

  /** Lista as marcações do próprio usuário autenticado (opcionalmente de um dia). */
  async listarDoUsuario(usuarioId: string, tenantId: string, dataStr?: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const us = (await tx.select().from(usuario).where(eq(usuario.id, usuarioId)).limit(1))[0];
      if (!us?.empregadoId) throw new BadRequestException('Usuário não vinculado a um empregado');
      const e = (await tx.select().from(empregado).where(eq(empregado.id, us.empregadoId)).limit(1))[0];
      if (!e) throw new NotFoundException('Empregado não encontrado');
      const rep = (await tx.select().from(pontoRep).where(eq(pontoRep.tenantId, tenantId)).limit(1))[0];
      if (!rep) throw new NotFoundException('REP-P não configurado');

      const t = (await tx.select().from(tenant).where(eq(tenant.id, tenantId)).limit(1))[0];
      const fuso = t?.fuso ?? '-0300';

      const conds = [eq(pontoMarcacao.repId, rep.id), eq(pontoMarcacao.cpf, e.cpf)];
      if (dataStr) {
        conds.push(gte(pontoMarcacao.dtMarcacao, inicioDoDia(dataStr, fuso)));
        conds.push(lte(pontoMarcacao.dtMarcacao, fimDoDia(dataStr, fuso)));
      }
      const linhas = await tx.select({
        id: pontoMarcacao.id,
        nsr: pontoMarcacao.nsr, dtMarcacao: pontoMarcacao.dtMarcacao, coletor: pontoMarcacao.coletor,
        latitude: pontoMarcacao.latitude, longitude: pontoMarcacao.longitude,
        observacao: pontoMarcacao.observacao,
      }).from(pontoMarcacao).where(and(...conds)).orderBy(asc(pontoMarcacao.dtMarcacao));

      // Ajustes aprovados: a batida incluída precisa aparecer pro funcionário
      // (senão o dia continua ímpar na tela), e a desconsiderada some da conta.
      // O AFD segue com tudo — isto é só o que vale na jornada.
      const aj = dataStr
        ? await ajustesAprovados(tx as never, tenantId, e.id, dataStr, dataStr)
        : { desconsideradas: new Map<string, string | null>(), inclusoes: [] };
      const efetivas = [
        ...linhas.filter((l) => !aj.desconsideradas.has(l.id)),
        ...aj.inclusoes.map((i) => ({
          id: i.id, nsr: null as number | null, dtMarcacao: i.dtMarcacao, coletor: 0,
          latitude: null, longitude: null, observacao: i.motivo, incluida: true,
        })),
      ].sort((a, b) => a.dtMarcacao.getTime() - b.dtMarcacao.getTime());

      // Quantas marcações o dia prevê (2 por par do horário contratual).
      // 0 = desconhecido: o app rotula pelo que já foi batido, sem inventar descanso.
      let esperadas = 0;
      if (e.horarioContratualId) {
        const h = (await tx.select().from(pontoHorarioContratual)
          .where(eq(pontoHorarioContratual.id, e.horarioContratualId)).limit(1))[0];
        if (h) {
          const dia = diaDaSemanaLocal(dataStr ?? new Date().toISOString().slice(0, 10), fuso);
          if (h.diasSemana.includes(dia)) esperadas = h.pares.length * 2;
        }
      }

      // Local do estabelecimento: o app usa só para decidir se pede observação.
      const local = t?.latitude && t?.longitude
        ? { latitude: Number(t.latitude), longitude: Number(t.longitude), raioMetros: t.raioMetros }
        : null;

      return {
        nome: e.nome,
        esperadas,
        local,
        marcacoes: efetivas.map((m) => ({
          nsr: m.nsr != null ? Number(m.nsr) : null,
          dtMarcacao: m.dtMarcacao, coletor: m.coletor,
          latitude: m.latitude != null ? Number(m.latitude) : null,
          longitude: m.longitude != null ? Number(m.longitude) : null,
          observacao: m.observacao,
          // Batida que entrou por ajuste aprovado: não tem NSR nem comprovante.
          incluida: 'incluida' in m,
        })),
      };
    });
  }

  /** Resolve o empregado do usuário logado. Usado pelas telas do colaborador. */
  async empregadoDoUsuario(usuarioId: string, tenantId: string): Promise<string> {
    return comTenant(this.db, tenantId, async (tx) => {
      const us = (await tx.select().from(usuario).where(eq(usuario.id, usuarioId)).limit(1))[0];
      if (!us?.empregadoId) throw new BadRequestException('Usuário não vinculado a um empregado');
      return us.empregadoId;
    });
  }

  /** Horário contratual do empregado — o que está combinado no contrato. */
  async meuHorario(tenantId: string, empregadoId: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const e = (await tx.select().from(empregado).where(eq(empregado.id, empregadoId)).limit(1))[0];
      if (!e) throw new NotFoundException('Empregado não encontrado');
      if (!e.horarioContratualId) return null;
      const h = (await tx.select().from(pontoHorarioContratual)
        .where(eq(pontoHorarioContratual.id, e.horarioContratualId)).limit(1))[0];
      if (!h) return null;
      return {
        codigo: h.codigo, pares: h.pares, diasSemana: h.diasSemana,
        durJornadaMin: h.durJornadaMin,
      };
    });
  }

  /** Local do estabelecimento — usado só para decidir quando pedir observação. */
  async obterLocal(tenantId: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const t = (await tx.select().from(tenant).where(eq(tenant.id, tenantId)).limit(1))[0];
      if (!t) throw new NotFoundException('Cliente não encontrado');
      return {
        localPrestacao: t.localPrestacao,
        latitude: t.latitude != null ? Number(t.latitude) : null,
        longitude: t.longitude != null ? Number(t.longitude) : null,
        raioMetros: t.raioMetros,
      };
    });
  }

  async definirLocal(tenantId: string, p: {
    latitude?: number | null; longitude?: number | null;
    raioMetros?: number | null; localPrestacao?: string;
  }) {
    if (p.raioMetros != null && (p.raioMetros < 20 || p.raioMetros > 50_000)) {
      throw new BadRequestException('Raio deve ficar entre 20 e 50000 metros');
    }
    // Devolve o que foi gravado usando returning() — ler numa segunda transação
    // enquanto esta não commitou traz o valor ANTIGO.
    return comTenant(this.db, tenantId, async (tx) => {
      const [t] = await tx.update(tenant).set({
        latitude: p.latitude != null ? String(p.latitude) : null,
        longitude: p.longitude != null ? String(p.longitude) : null,
        raioMetros: p.raioMetros ?? null,
        ...(p.localPrestacao !== undefined ? { localPrestacao: p.localPrestacao } : {}),
      }).where(eq(tenant.id, tenantId)).returning();
      if (!t) throw new NotFoundException('Cliente não encontrado');
      return {
        localPrestacao: t.localPrestacao,
        latitude: t.latitude != null ? Number(t.latitude) : null,
        longitude: t.longitude != null ? Number(t.longitude) : null,
        raioMetros: t.raioMetros,
      };
    });
  }

  /** Comprovante em PDF; assina em PAdES se o tenant tiver certificado. */
  async gerarComprovantePdf(tenantId: string, nsr: number): Promise<Buffer> {
    const pdf = await comTenant(this.db, tenantId, async (tx) => {
      const rep = (await tx.select().from(pontoRep).where(eq(pontoRep.tenantId, tenantId)).limit(1))[0];
      if (!rep) throw new NotFoundException('REP-P não encontrado');
      const m = (await tx.select().from(pontoMarcacao)
        .where(and(eq(pontoMarcacao.repId, rep.id), eq(pontoMarcacao.nsr, nsr))).limit(1))[0];
      if (!m) throw new NotFoundException('Marcação não encontrada');
      const emp = (await tx.select().from(empregado)
        .where(and(eq(empregado.tenantId, tenantId), eq(empregado.cpf, m.cpf))).limit(1))[0];
      const ten = (await tx.select().from(tenant).where(eq(tenant.id, tenantId)).limit(1))[0];
      return gerarComprovante({
        rep: {
          razaoSocial: rep.razaoSocial, tipoIdEmpregador: rep.tipoIdEmpregador as TipoIdentificador,
          documentoEmpregador: rep.documentoEmpregador, numeroInpi: rep.numeroInpi,
        },
        empregado: { nome: emp?.nome ?? m.cpf, cpf: m.cpf },
        marcacao: { nsr: m.nsr, dtMarcacao: m.dtMarcacao, hashRegistro: m.hashRegistro },
        localPrestacao: ten?.localPrestacao ?? '',
        // Fuso da própria batida — é a hora que o comprovante deve mostrar.
        fuso: m.fuso ?? ten?.fuso ?? '-0300',
      });
    });

    if (await this.certs.temCertificado(tenantId)) {
      const { pfxBuffer, senha } = await this.certs.carregar(tenantId);
      return assinarPdfPAdES(pdf, { pfxBuffer, senha }, { motivo: 'Comprovante de Registro de Ponto' });
    }
    return pdf;
  }
}
