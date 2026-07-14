import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import {
  pontoRep, pontoMarcacao, empregado, pontoHorarioContratual, pontoTratamento, pontoAusencia,
  comTenant, type Db,
} from '@ponto/db';
import { montarAFD, montarAEJ, assinarCAdESDestacado } from '@ponto/rep-core';
import type { MarcacaoGravada } from '@ponto/shared';
import { Coletor, OnlineOffline } from '@ponto/shared';
import { DB } from '../database/database.module';
import { CertificadoService } from '../certificado/certificado.service';

export interface Periodo { inicio?: Date; fim?: Date; }

@Injectable()
export class FiscalService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly certs: CertificadoService,
  ) {}

  private ptrp() {
    return {
      nome: process.env.PLATAFORMA_NOME ?? 'Ponto Eletronico',
      versao: process.env.PLATAFORMA_VERSAO ?? '1.0.0',
      tpIdtDesenv: Number(process.env.PLATAFORMA_TIPO_ID_DEV ?? '1'),
      idtDesenv: process.env.PLATAFORMA_DOC_DEV ?? '00000000000000',
      razaoNome: process.env.PLATAFORMA_RAZAO ?? 'Desenvolvedora',
      email: process.env.PLATAFORMA_EMAIL ?? 'contato@exemplo.com',
    };
  }

  private filtroPeriodo(repId: string, p: Periodo) {
    const conds = [eq(pontoMarcacao.repId, repId)];
    if (p.inicio) conds.push(gte(pontoMarcacao.dtMarcacao, p.inicio));
    if (p.fim) conds.push(lte(pontoMarcacao.dtMarcacao, p.fim));
    return and(...conds);
  }

  async gerarAfd(tenantId: string, p: Periodo = {}) {
    return comTenant(this.db, tenantId, async (tx) => {
      const rep = (await tx.select().from(pontoRep).where(eq(pontoRep.tenantId, tenantId)).limit(1))[0];
      if (!rep) throw new NotFoundException('REP-P não configurado');
      const linhas = await tx.select().from(pontoMarcacao)
        .where(this.filtroPeriodo(rep.id, p)).orderBy(asc(pontoMarcacao.nsr));
      const marcacoes: MarcacaoGravada[] = linhas.map((m) => ({
        nsr: Number(m.nsr), cpf: m.cpf, dtMarcacao: m.dtMarcacao, dtGravacao: m.dtGravacao,
        coletor: m.coletor as Coletor, onlineOffline: m.onlineOffline as OnlineOffline,
        hashRegistro: m.hashRegistro, hashAnterior: m.hashAnterior,
      }));
      return montarAFD({
        rep: {
          tipoIdEmpregador: rep.tipoIdEmpregador, documentoEmpregador: rep.documentoEmpregador,
          cnoCaepf: rep.cnoCaepf, razaoSocial: rep.razaoSocial, numeroInpi: rep.numeroInpi,
          tipoIdDesenvolvedor: rep.tipoIdDesenvolvedor, documentoDesenvolvedor: rep.documentoDesenvolvedor,
        },
        marcacoes,
      });
    });
  }

  async gerarAej(tenantId: string, _p: Periodo = {}) {
    return comTenant(this.db, tenantId, async (tx) => {
      const rep = (await tx.select().from(pontoRep).where(eq(pontoRep.tenantId, tenantId)).limit(1))[0];
      if (!rep) throw new NotFoundException('REP-P não configurado');
      const emps = await tx.select().from(empregado).where(eq(empregado.tenantId, tenantId));
      const cpfPorId = new Map(emps.map((e) => [e.id, e.cpf] as const));
      const horarios = await tx.select().from(pontoHorarioContratual).where(eq(pontoHorarioContratual.tenantId, tenantId));
      const tratamentos = await tx.select().from(pontoTratamento)
        .where(eq(pontoTratamento.tenantId, tenantId)).orderBy(asc(pontoTratamento.dtMarcacao));
      const ausencias = await tx.select().from(pontoAusencia).where(eq(pontoAusencia.tenantId, tenantId));
      return montarAEJ({
        rep: {
          tipoIdEmpregador: rep.tipoIdEmpregador, documentoEmpregador: rep.documentoEmpregador,
          cnoCaepf: rep.cnoCaepf, razaoSocial: rep.razaoSocial, numeroInpi: rep.numeroInpi,
          tipoIdDesenvolvedor: rep.tipoIdDesenvolvedor, documentoDesenvolvedor: rep.documentoDesenvolvedor,
        },
        ptrp: this.ptrp(),
        empregados: emps.map((e) => ({ cpf: e.cpf, nome: e.nome, matriculaEsocial: e.matriculaEsocial })),
        horarios: horarios.map((h) => ({ codigo: h.codigo, durJornadaMin: h.durJornadaMin, pares: h.pares })),
        tratamentos: tratamentos.map((t) => ({
          cpf: cpfPorId.get(t.empregadoId) ?? '', dtMarcacao: t.dtMarcacao, tpMarc: t.tpMarc,
          seqEntSaida: t.seqEntSaida, fonteMarc: t.fonteMarc, codHorContratual: t.codHorContratual, motivo: t.motivo,
        })),
        ausencias: ausencias.map((a) => ({
          cpf: cpfPorId.get(a.empregadoId) ?? '', tipo: a.tipo, data: new Date(a.data),
          qtMinutos: a.qtMinutos, tipoMovBH: a.tipoMovBh,
        })),
      });
    });
  }

  /** Gera o AFD e sua assinatura CAdES destacada (.p7s) com o cert do tenant. */
  async gerarAfdAssinado(tenantId: string, p: Periodo = {}) {
    const { conteudo, nomeArquivo } = await this.gerarAfd(tenantId, p);
    const { icp } = await this.certs.carregar(tenantId);
    return { conteudo, nomeArquivo, p7s: assinarCAdESDestacado(conteudo, icp), nomeP7s: `${nomeArquivo}.p7s` };
  }

  async gerarAejAssinado(tenantId: string, p: Periodo = {}) {
    const { conteudo, nomeArquivo } = await this.gerarAej(tenantId, p);
    const { icp } = await this.certs.carregar(tenantId);
    return { conteudo, nomeArquivo, p7s: assinarCAdESDestacado(conteudo, icp), nomeP7s: `${nomeArquivo}.p7s` };
  }
}
