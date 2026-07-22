import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import {
  pontoRep, pontoMarcacao, empregado, pontoHorarioContratual, pontoTratamento, pontoAusencia, pontoBancoMov, tenant,
  comTenant, type Db,
} from '@ponto/db';
import { montarAFD, montarAEJ, assinarCAdESDestacado, inicioDoDia, fimDoDia } from '@ponto/rep-core';
import type { MarcacaoGravada } from '@ponto/shared';
import { Coletor, OnlineOffline } from '@ponto/shared';
import { DB } from '../database/database.module';
import { CertificadoService } from '../certificado/certificado.service';

// Registro 07 do AEJ — movimento de banco de horas.
// tipoMovBH: 1 = crédito ao banco, 2 = débito do banco.
// ⚠️ O código de "tipo" do registro de banco deve ser conferido contra o leiaute
// oficial do AEJ (item A3 do checklist) antes de gerar em produção.
const TIPO_AEJ_MOV_BANCO = 5;
const MOV_BH_CREDITO = 1;
const MOV_BH_DEBITO = 2;

/** Período por datas locais "YYYY-MM-DD". Os limites em instante UTC são
 *  construídos no service, com o fuso do tenant. */
export interface Periodo { inicio?: string; fim?: string; }

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

  private filtroPeriodo(repId: string, p: Periodo, fuso: string) {
    const conds = [eq(pontoMarcacao.repId, repId)];
    if (p.inicio) conds.push(gte(pontoMarcacao.dtMarcacao, inicioDoDia(p.inicio, fuso)));
    if (p.fim) conds.push(lte(pontoMarcacao.dtMarcacao, fimDoDia(p.fim, fuso)));
    return and(...conds);
  }

  async gerarAfd(tenantId: string, p: Periodo = {}) {
    return comTenant(this.db, tenantId, async (tx) => {
      const rep = (await tx.select().from(pontoRep).where(eq(pontoRep.tenantId, tenantId)).limit(1))[0];
      if (!rep) throw new NotFoundException('REP-P não configurado');
      const fusoTenant = (await tx.select({ fuso: tenant.fuso }).from(tenant).where(eq(tenant.id, tenantId)).limit(1))[0]?.fuso ?? '-0300';
      const linhas = await tx.select().from(pontoMarcacao)
        .where(this.filtroPeriodo(rep.id, p, fusoTenant)).orderBy(asc(pontoMarcacao.nsr));
      const marcacoes: MarcacaoGravada[] = linhas.map((m) => ({
        nsr: Number(m.nsr), cpf: m.cpf, dtMarcacao: m.dtMarcacao, dtGravacao: m.dtGravacao,
        coletor: m.coletor as Coletor, onlineOffline: m.onlineOffline as OnlineOffline,
        hashRegistro: m.hashRegistro, hashAnterior: m.hashAnterior,
        // Cada marcação reproduz o fuso com que foi hasheada (imutável).
        fuso: m.fuso ?? '-0300',
      }));
      return montarAFD({
        rep: {
          tipoIdEmpregador: rep.tipoIdEmpregador, documentoEmpregador: rep.documentoEmpregador,
          cnoCaepf: rep.cnoCaepf, razaoSocial: rep.razaoSocial, numeroInpi: rep.numeroInpi,
          tipoIdDesenvolvedor: rep.tipoIdDesenvolvedor, documentoDesenvolvedor: rep.documentoDesenvolvedor,
        },
        marcacoes,
        fuso: fusoTenant,
      });
    });
  }

  async gerarAej(tenantId: string, _p: Periodo = {}) {
    return comTenant(this.db, tenantId, async (tx) => {
      const rep = (await tx.select().from(pontoRep).where(eq(pontoRep.tenantId, tenantId)).limit(1))[0];
      if (!rep) throw new NotFoundException('REP-P não configurado');
      const fusoTenant = (await tx.select({ fuso: tenant.fuso }).from(tenant).where(eq(tenant.id, tenantId)).limit(1))[0]?.fuso ?? '-0300';
      const emps = await tx.select().from(empregado).where(eq(empregado.tenantId, tenantId));
      const cpfPorId = new Map(emps.map((e) => [e.id, e.cpf] as const));
      const horarios = await tx.select().from(pontoHorarioContratual).where(eq(pontoHorarioContratual.tenantId, tenantId));
      const tratamentos = await tx.select().from(pontoTratamento)
        .where(eq(pontoTratamento.tenantId, tenantId)).orderBy(asc(pontoTratamento.dtMarcacao));
      const ausencias = await tx.select().from(pontoAusencia).where(eq(pontoAusencia.tenantId, tenantId));
      // Ponte: os movimentos de banco calculados pelas regras (pontoBancoMov)
      // entram no AEJ como registro 07 de banco de horas (tipoMovBH 1=crédito,
      // 2=débito). É a fonte única do banco no arquivo — pontoAusencia fica só
      // pras ausências/folgas (por isso o tipoMovBH delas não é emitido).
      const bancoMovs = await tx.select().from(pontoBancoMov).where(eq(pontoBancoMov.tenantId, tenantId));
      const ausenciasBanco = bancoMovs.map((m) => ({
        empregadoId: m.empregadoId, tipo: TIPO_AEJ_MOV_BANCO, data: m.data,
        qtMinutos: Math.abs(m.minutos), tipoMovBh: m.tipo === 'CREDITO' ? MOV_BH_CREDITO : MOV_BH_DEBITO,
      }));
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
        ausencias: [
          ...ausencias.map((a) => ({
            cpf: cpfPorId.get(a.empregadoId) ?? '', tipo: a.tipo, data: new Date(a.data),
            qtMinutos: a.qtMinutos, tipoMovBH: null,
          })),
          ...ausenciasBanco.map((a) => ({
            cpf: cpfPorId.get(a.empregadoId) ?? '', tipo: a.tipo, data: new Date(a.data),
            qtMinutos: a.qtMinutos, tipoMovBH: a.tipoMovBh,
          })),
        ],
        fuso: fusoTenant,
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
