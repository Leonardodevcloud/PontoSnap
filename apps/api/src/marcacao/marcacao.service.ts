import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import {
  pontoRep, pontoMarcacao, empregado, tenant, usuario, pontoHorarioContratual, comTenant, type Db,
} from '@ponto/db';
import { proximaMarcacao, gerarComprovante, assinarPdfPAdES } from '@ponto/rep-core';
import { Coletor, OnlineOffline, TipoIdentificador } from '@ponto/shared';
import { DB } from '../database/database.module';
import { CertificadoService } from '../certificado/certificado.service';

export interface BaterParams {
  tenantId: string; cpf: string; coletor: Coletor;
  onlineOffline?: OnlineOffline; dtMarcacao?: Date;
  ipOrigem?: string | null; latitude?: number | null; longitude?: number | null;
  observacao?: string | null;
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

      const anterior = rep.ultimoNsr > 0 && rep.ultimoHash
        ? { nsr: rep.ultimoNsr, hashRegistro: rep.ultimoHash } : null;

      const dtMarcacao = p.dtMarcacao ?? new Date();
      const dtGravacao = new Date();
      const onlineOffline = p.onlineOffline ?? OnlineOffline.ONLINE;

      const g = proximaMarcacao(
        { cpf: p.cpf, dtMarcacao, dtGravacao, coletor: p.coletor, onlineOffline }, anterior);

      await tx.insert(pontoMarcacao).values({
        tenantId: p.tenantId, repId: rep.id, nsr: g.nsr, cpf: p.cpf,
        dtMarcacao, dtGravacao, coletor: p.coletor, onlineOffline,
        hashRegistro: g.hashRegistro, hashAnterior: g.hashAnterior,
        ipOrigem: p.ipOrigem ?? null,
        latitude: p.latitude != null ? String(p.latitude) : null,
        longitude: p.longitude != null ? String(p.longitude) : null,
        // Vai no INSERT: o gatilho de imutabilidade nunca deixaria isso virar UPDATE.
        observacao: p.observacao?.trim() || null,
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

      const conds = [eq(pontoMarcacao.repId, rep.id), eq(pontoMarcacao.cpf, e.cpf)];
      if (dataStr) {
        conds.push(gte(pontoMarcacao.dtMarcacao, new Date(`${dataStr}T00:00:00-0300`)));
        conds.push(lte(pontoMarcacao.dtMarcacao, new Date(`${dataStr}T23:59:59-0300`)));
      }
      const linhas = await tx.select({
        nsr: pontoMarcacao.nsr, dtMarcacao: pontoMarcacao.dtMarcacao, coletor: pontoMarcacao.coletor,
        latitude: pontoMarcacao.latitude, longitude: pontoMarcacao.longitude,
        observacao: pontoMarcacao.observacao,
      }).from(pontoMarcacao).where(and(...conds)).orderBy(asc(pontoMarcacao.dtMarcacao));

      // Quantas marcações o dia prevê (2 por par do horário contratual).
      // 0 = desconhecido: o app rotula pelo que já foi batido, sem inventar descanso.
      let esperadas = 0;
      if (e.horarioContratualId) {
        const h = (await tx.select().from(pontoHorarioContratual)
          .where(eq(pontoHorarioContratual.id, e.horarioContratualId)).limit(1))[0];
        if (h) {
          const dia = new Date(`${dataStr ?? new Date().toISOString().slice(0, 10)}T12:00:00-0300`).getDay();
          if (h.diasSemana.includes(dia)) esperadas = h.pares.length * 2;
        }
      }

      // Local do estabelecimento: o app usa só para decidir se pede observação.
      const t = (await tx.select().from(tenant).where(eq(tenant.id, tenantId)).limit(1))[0];
      const local = t?.latitude && t?.longitude
        ? { latitude: Number(t.latitude), longitude: Number(t.longitude), raioMetros: t.raioMetros }
        : null;

      return {
        nome: e.nome,
        esperadas,
        local,
        marcacoes: linhas.map((m) => ({
          nsr: Number(m.nsr), dtMarcacao: m.dtMarcacao, coletor: m.coletor,
          latitude: m.latitude != null ? Number(m.latitude) : null,
          longitude: m.longitude != null ? Number(m.longitude) : null,
          observacao: m.observacao,
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
      });
    });

    if (await this.certs.temCertificado(tenantId)) {
      const { pfxBuffer, senha } = await this.certs.carregar(tenantId);
      return assinarPdfPAdES(pdf, { pfxBuffer, senha }, { motivo: 'Comprovante de Registro de Ponto' });
    }
    return pdf;
  }
}
