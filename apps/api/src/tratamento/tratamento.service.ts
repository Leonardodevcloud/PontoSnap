import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import {
  pontoHorarioContratual, pontoTratamento, pontoAusencia, pontoMarcacao, pontoRep, empregado, pontoFeriado, pontoEscala, pontoDocumento, tenant,
  comTenant, comoMaster, type Db,
} from '@ponto/db';
import { foraDoRaio } from '@ponto/shared';
import { DB } from '../database/database.module';
import { apurarJornada } from './apuracao';
import { apurarPeriodo, valorizarPeriodo, diaSemana, REGRAS_CLT_PADRAO, type EntradaDia, type ResultadoValores } from '@ponto/apuracao-clt';
import { gerarRelatorioApuracaoPdf, gerarRelatorioCompetenciaPdf as montarPdfCompetencia, type DiaRelatorio } from '@ponto/rep-core';
import ExcelJS from 'exceljs';

interface Par { entrada: string; saida: string; }

@Injectable()
export class TratamentoService {
  constructor(@Inject(DB) private readonly db: Db) {}

  // ---- Horário contratual ----
  criarHorario(tenantId: string, dto: { codigo: string; durJornadaMin: number; pares: Par[]; diasSemana?: number[]; regime?: string }) {
    return comTenant(this.db, tenantId, async (tx) =>
      (await tx.insert(pontoHorarioContratual).values({
        tenantId, codigo: dto.codigo, durJornadaMin: dto.durJornadaMin, pares: dto.pares,
        diasSemana: dto.diasSemana ?? [1, 2, 3, 4, 5], regime: dto.regime ?? 'normal',
      }).returning())[0]);
  }
  listarHorarios(tenantId: string) {
    return comTenant(this.db, tenantId, (tx) =>
      tx.select().from(pontoHorarioContratual).where(eq(pontoHorarioContratual.tenantId, tenantId)));
  }

  // ---- Ausências / banco de horas ----
  criarAusencia(tenantId: string, dto: { empregadoId: string; tipo: number; data: string; qtMinutos?: number; tipoMovBh?: number }) {
    return comTenant(this.db, tenantId, async (tx) =>
      (await tx.insert(pontoAusencia).values({
        tenantId, empregadoId: dto.empregadoId, tipo: dto.tipo, data: dto.data,
        qtMinutos: dto.qtMinutos ?? null, tipoMovBh: dto.tipoMovBh ?? null,
      }).returning())[0]);
  }

  // ---- Tratamento manual (inclusão/ajuste) ----
  criarTratamento(tenantId: string, dto: {
    empregadoId: string; dtMarcacao: string; tpMarc: string; seqEntSaida: number;
    fonteMarc?: string; codHorContratual?: string; motivo?: string;
  }) {
    return comTenant(this.db, tenantId, async (tx) =>
      (await tx.insert(pontoTratamento).values({
        tenantId, empregadoId: dto.empregadoId, dtMarcacao: new Date(dto.dtMarcacao),
        tpMarc: dto.tpMarc, seqEntSaida: dto.seqEntSaida, fonteMarc: dto.fonteMarc ?? 'I',
        codHorContratual: dto.codHorContratual ?? null, motivo: dto.motivo ?? null,
      }).returning())[0]);
  }
  listarTratamentos(tenantId: string, empregadoId?: string) {
    return comTenant(this.db, tenantId, (tx) => {
      const cond = empregadoId
        ? and(eq(pontoTratamento.tenantId, tenantId), eq(pontoTratamento.empregadoId, empregadoId))
        : eq(pontoTratamento.tenantId, tenantId);
      return tx.select().from(pontoTratamento).where(cond).orderBy(asc(pontoTratamento.dtMarcacao));
    });
  }

  /**
   * Apuração básica de um dia: pareia as marcações (batidas cegas) em
   * entrada/saída (E/S) alternadas, gerando os registros de tratamento.
   * É a fundação — o cálculo de extras/DSR/banco de horas fica para uma etapa
   * dedicada de motor de apuração CLT.
   */
  async apurarDia(tenantId: string, empregadoId: string, dataStr: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const emp = (await tx.select().from(empregado)
        .where(and(eq(empregado.id, empregadoId), eq(empregado.tenantId, tenantId))).limit(1))[0];
      if (!emp) throw new NotFoundException('Empregado não encontrado');
      const rep = (await tx.select().from(pontoRep).where(eq(pontoRep.tenantId, tenantId)).limit(1))[0];
      if (!rep) throw new NotFoundException('REP-P não configurado');

      const inicio = new Date(`${dataStr}T00:00:00-0300`);
      const fim = new Date(`${dataStr}T23:59:59-0300`);

      const marcs = await tx.select().from(pontoMarcacao)
        .where(and(eq(pontoMarcacao.repId, rep.id), eq(pontoMarcacao.cpf, emp.cpf),
          gte(pontoMarcacao.dtMarcacao, inicio), lte(pontoMarcacao.dtMarcacao, fim)))
        .orderBy(asc(pontoMarcacao.dtMarcacao));

      // reapuração idempotente: limpa o tratamento anterior desse dia
      await tx.delete(pontoTratamento).where(and(
        eq(pontoTratamento.empregadoId, empregadoId),
        gte(pontoTratamento.dtMarcacao, inicio), lte(pontoTratamento.dtMarcacao, fim)));

      const horario = emp.horarioContratualId
        ? (await tx.select().from(pontoHorarioContratual)
            .where(eq(pontoHorarioContratual.id, emp.horarioContratualId)).limit(1))[0]
        : undefined;
      const codHor = horario?.codigo ?? null;
      const durJornada = horario?.durJornadaMin ?? 0;

      let criados = 0;
      for (let i = 0; i < marcs.length; i++) {
        const m = marcs[i]!;
        const tpMarc = i % 2 === 0 ? 'E' : 'S';
        const seq = Math.floor(i / 2) + 1;
        await tx.insert(pontoTratamento).values({
          tenantId, empregadoId, marcacaoId: m.id, dtMarcacao: m.dtMarcacao,
          tpMarc, seqEntSaida: seq, fonteMarc: 'O',
          codHorContratual: tpMarc === 'E' && seq === 1 ? codHor : null,
        });
        criados++;
      }

      const resumo = apurarJornada(marcs.map((m) => m.dtMarcacao), durJornada);
      return {
        empregadoId, data: dataStr, marcacoes: marcs.length, tratamentosCriados: criados,
        avisoImpar: resumo.paresIncompletos ? 'Número ímpar de batidas — falta uma saída/entrada' : null,
        resumo,
      };
    });
  }

  /** Espelho do dia de um funcionário (somente leitura — não grava tratamento). */
  async espelhoDia(tenantId: string, empregadoId: string, dataStr: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const emp = (await tx.select().from(empregado)
        .where(and(eq(empregado.id, empregadoId), eq(empregado.tenantId, tenantId))).limit(1))[0];
      if (!emp) throw new NotFoundException('Empregado não encontrado');
      const rep = (await tx.select().from(pontoRep).where(eq(pontoRep.tenantId, tenantId)).limit(1))[0];
      if (!rep) throw new NotFoundException('REP-P não configurado');

      const inicio = new Date(`${dataStr}T00:00:00-0300`);
      const fim = new Date(`${dataStr}T23:59:59-0300`);
      const marcs = await tx.select({
        nsr: pontoMarcacao.nsr, dtMarcacao: pontoMarcacao.dtMarcacao,
        latitude: pontoMarcacao.latitude, longitude: pontoMarcacao.longitude,
        observacao: pontoMarcacao.observacao,
      })
        .from(pontoMarcacao)
        .where(and(eq(pontoMarcacao.repId, rep.id), eq(pontoMarcacao.cpf, emp.cpf),
          gte(pontoMarcacao.dtMarcacao, inicio), lte(pontoMarcacao.dtMarcacao, fim)))
        .orderBy(asc(pontoMarcacao.dtMarcacao));

      const dur = emp.horarioContratualId
        ? (await tx.select().from(pontoHorarioContratual)
            .where(eq(pontoHorarioContratual.id, emp.horarioContratualId)).limit(1))[0]?.durJornadaMin ?? 0
        : 0;

      // Local do estabelecimento para o RH ver de onde cada batida saiu.
      const t = (await tx.select().from(tenant).where(eq(tenant.id, tenantId)).limit(1))[0];
      const local = t?.latitude && t?.longitude
        ? { latitude: Number(t.latitude), longitude: Number(t.longitude), raioMetros: t.raioMetros }
        : null;

      return {
        nome: emp.nome, matricula: emp.matricula,
        marcacoes: marcs.map((m) => {
          const pos = m.latitude != null && m.longitude != null
            ? { latitude: Number(m.latitude), longitude: Number(m.longitude) } : null;
          const { fora, distancia } = foraDoRaio(local, pos);
          return {
            nsr: Number(m.nsr), dtMarcacao: m.dtMarcacao,
            latitude: pos?.latitude ?? null, longitude: pos?.longitude ?? null,
            observacao: m.observacao, fora, distancia,
          };
        }),
        resumo: apurarJornada(marcs.map((m) => m.dtMarcacao), dur),
      };
    });
  }

  // ---- Feriados (calendário por cliente) ----
  criarFeriado(tenantId: string, dto: { data: string; nome: string; tipo?: string }) {
    return comTenant(this.db, tenantId, async (tx) =>
      (await tx.insert(pontoFeriado).values({
        tenantId, data: dto.data, nome: dto.nome, tipo: dto.tipo ?? 'nacional',
      }).returning())[0]);
  }
  listarFeriados(tenantId: string, inicio?: string, fim?: string) {
    return comTenant(this.db, tenantId, (tx) => {
      const conds = [eq(pontoFeriado.tenantId, tenantId)];
      if (inicio) conds.push(gte(pontoFeriado.data, inicio));
      if (fim) conds.push(lte(pontoFeriado.data, fim));
      return tx.select().from(pontoFeriado).where(and(...conds)).orderBy(asc(pontoFeriado.data));
    });
  }
  removerFeriado(tenantId: string, id: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      await tx.delete(pontoFeriado).where(and(eq(pontoFeriado.tenantId, tenantId), eq(pontoFeriado.id, id)));
      return { removido: true };
    });
  }

  // ---- Escala (calendário de dias trabalhados, p/ 12x36) ----
  /** Gera a escala 12x36 (trabalha em dias alternados a partir de dataInicio). */
  async gerarEscala12x36(tenantId: string, empregadoId: string, inicioStr: string, fimStr: string, dataInicioStr: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const inicio = new Date(`${inicioStr}T12:00:00-0300`);
      const fim = new Date(`${fimStr}T12:00:00-0300`);
      const base = new Date(`${dataInicioStr}T12:00:00-0300`);
      const dias: string[] = [];
      // ciclo de 48h: trabalha um dia, folga o seguinte
      for (const cur = new Date(base); cur.getTime() <= fim.getTime(); cur.setUTCDate(cur.getUTCDate() + 2)) {
        if (cur.getTime() >= inicio.getTime()) dias.push(this.diaLocalISO(cur));
      }
      await tx.delete(pontoEscala).where(and(
        eq(pontoEscala.tenantId, tenantId), eq(pontoEscala.empregadoId, empregadoId),
        gte(pontoEscala.data, inicioStr), lte(pontoEscala.data, fimStr)));
      if (dias.length) {
        await tx.insert(pontoEscala).values(dias.map((data) => ({ tenantId, empregadoId, data })));
      }
      return { empregadoId, gerados: dias.length, inicio: inicioStr, fim: fimStr };
    });
  }
  listarEscala(tenantId: string, empregadoId: string, inicioStr: string, fimStr: string) {
    return comTenant(this.db, tenantId, (tx) =>
      tx.select({ data: pontoEscala.data }).from(pontoEscala).where(and(
        eq(pontoEscala.tenantId, tenantId), eq(pontoEscala.empregadoId, empregadoId),
        gte(pontoEscala.data, inicioStr), lte(pontoEscala.data, fimStr))).orderBy(asc(pontoEscala.data)));
  }

  /** Próximo dia de uma data YYYY-MM-DD, sem escorregar de fuso. */
  private static somarDias(dataStr: string, dias: number): string {
    const d = new Date(`${dataStr}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
  }

  /** Data no calendário de Brasília (-0300) a partir de um instante UTC. */
  private diaLocalISO(d: Date): string {
    return new Date(d.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  }

  /**
   * Apuração CLT completa de um período (competência), usando o motor de regras
   * @ponto/apuracao-clt: extras 50/100%, hora noturna reduzida + adicional,
   * intervalo (Art. 71), interjornada (Art. 66), tolerância (Súmula 366),
   * abonos e — quando a política permitir — banco de horas e reflexo de DSR.
   *
   * Observação: faltas de dia inteiro dependem de calendário de escala (por
   * enquanto só apuramos dias com marcação ou abono). Feriados entram por
   * parâmetro até existir um calendário configurável.
   */
  async apurarPeriodoCLT(
    tenantId: string, empregadoId: string, inicioStr: string, fimStr: string, feriados: string[] = [],
  ) {
    return comTenant(this.db, tenantId, async (tx) => {
      const emp = (await tx.select().from(empregado)
        .where(and(eq(empregado.id, empregadoId), eq(empregado.tenantId, tenantId))).limit(1))[0];
      if (!emp) throw new NotFoundException('Empregado não encontrado');
      const rep = (await tx.select().from(pontoRep).where(eq(pontoRep.tenantId, tenantId)).limit(1))[0];
      if (!rep) throw new NotFoundException('REP-P não configurado');

      const inicio = new Date(`${inicioStr}T00:00:00-0300`);
      const fim = new Date(`${fimStr}T23:59:59-0300`);

      const marcs = await tx.select({ dtMarcacao: pontoMarcacao.dtMarcacao }).from(pontoMarcacao)
        .where(and(eq(pontoMarcacao.repId, rep.id), eq(pontoMarcacao.cpf, emp.cpf),
          gte(pontoMarcacao.dtMarcacao, inicio), lte(pontoMarcacao.dtMarcacao, fim)))
        .orderBy(asc(pontoMarcacao.dtMarcacao));

      const horario = emp.horarioContratualId
        ? (await tx.select().from(pontoHorarioContratual)
            .where(eq(pontoHorarioContratual.id, emp.horarioContratualId)).limit(1))[0]
        : undefined;
      const durJornada = horario?.durJornadaMin ?? 0;
      const diasUteis = horario?.diasSemana ?? [1, 2, 3, 4, 5]; // seg–sex por padrão

      // Registro 07 do AEJ. Os quatro códigos NÃO abonam jornada:
      //  1 (DSR) e 4 (folga compensatória) marcam o dia como descanso;
      //  2 é falta não justificada — o oposto de abono;
      //  3 é movimento de banco de horas, que não mexe no esperado do dia.
      // Abonar jornada por atestado vem de ponto_documento, mais abaixo.
      const aus = await tx.select().from(pontoAusencia).where(and(
        eq(pontoAusencia.tenantId, tenantId), eq(pontoAusencia.empregadoId, empregadoId),
        gte(pontoAusencia.data, inicioStr), lte(pontoAusencia.data, fimStr)));
      const descansoPorAusencia = new Set<string>(
        aus.filter((a) => a.tipo === 1 || a.tipo === 4).map((a) => a.data));

      // Atestados/declarações já analisados e abonados pelo RH.
      // minutos = null significa dia inteiro: abate a jornada contratada daquele dia.
      const docs = await tx.select().from(pontoDocumento).where(and(
        eq(pontoDocumento.tenantId, tenantId), eq(pontoDocumento.empregadoId, empregadoId),
        eq(pontoDocumento.status, 'ABONADO'),
        lte(pontoDocumento.dataInicio, fimStr), gte(pontoDocumento.dataFim, inicioStr)));
      const abonoPorData = new Map<string, number>();
      const abonoDiaInteiro = new Set<string>();
      for (const d of docs) {
        for (let dt = d.dataInicio; dt <= d.dataFim; dt = TratamentoService.somarDias(dt, 1)) {
          if (dt < inicioStr || dt > fimStr) continue;
          if (d.minutos == null) abonoDiaInteiro.add(dt);
          else abonoPorData.set(dt, (abonoPorData.get(dt) ?? 0) + d.minutos);
        }
      }

      // feriados do banco (calendário do cliente) + os passados por parâmetro
      const feriadosBanco = await tx.select({ data: pontoFeriado.data }).from(pontoFeriado).where(and(
        eq(pontoFeriado.tenantId, tenantId), gte(pontoFeriado.data, inicioStr), lte(pontoFeriado.data, fimStr)));
      const feriadoSet = new Set<string>([...feriados, ...feriadosBanco.map((f) => f.data)]);

      // agrupa as batidas por dia local
      const porDia = new Map<string, Date[]>();
      for (const m of marcs) {
        const dataLocal = this.diaLocalISO(m.dtMarcacao);
        const arr = porDia.get(dataLocal) ?? [];
        arr.push(m.dtMarcacao);
        porDia.set(dataLocal, arr);
      }

      const regime = (horario?.regime === 'r12x36' ? 'r12x36' : 'normal') as 'normal' | 'r12x36';
      const dias: EntradaDia[] = [];

      if (regime === 'r12x36') {
        // escala 12x36 vem do calendário de dias trabalhados. Com escala, faltas
        // de dia inteiro aparecem; sem escala, apuramos só os dias com batida/abono.
        const escala = await tx.select({ data: pontoEscala.data }).from(pontoEscala).where(and(
          eq(pontoEscala.tenantId, tenantId), eq(pontoEscala.empregadoId, empregadoId),
          gte(pontoEscala.data, inicioStr), lte(pontoEscala.data, fimStr)));
        const escalaSet = new Set(escala.map((e) => e.data));

        const datas = new Set<string>([
          ...escalaSet, ...porDia.keys(), ...abonoPorData.keys(), ...abonoDiaInteiro,
        ]);
        for (const data of [...datas].sort()) {
          const trabalhaHoje = (escalaSet.size > 0 ? escalaSet.has(data) : porDia.has(data))
            && !descansoPorAusencia.has(data);
          const jornada = trabalhaHoje ? durJornada : 0;
          dias.push({
            data,
            marcacoes: porDia.get(data) ?? [],
            jornadaContratadaMin: jornada,
            ehDomingo: diaSemana(data) === 0,
            ehFeriado: feriadoSet.has(data),
            ehDescanso: (escalaSet.size > 0 ? !trabalhaHoje : false) || descansoPorAusencia.has(data),
            regime: 'r12x36',
            janelaPrevista: horario?.pares,
            // Atestado de dia inteiro abate a jornada daquele dia — é isso que
            // impede o dia de virar falta na apuração.
            ausenciaAbonadaMin: abonoDiaInteiro.has(data) ? jornada : abonoPorData.get(data),
          });
        }
      } else {
        // varre TODOS os dias do período — assim faltas de dia inteiro aparecem
        const cursor = new Date(`${inicioStr}T12:00:00-0300`);
        const ultimo = new Date(`${fimStr}T12:00:00-0300`);
        while (cursor.getTime() <= ultimo.getTime()) {
          const data = this.diaLocalISO(cursor);
          const dow = diaSemana(data);
          const ehFeriado = feriadoSet.has(data);
          const ehDomingo = dow === 0;
          const ehUtil = diasUteis.includes(dow) && !ehFeriado && !descansoPorAusencia.has(data);
          const ehDescanso = descansoPorAusencia.has(data)
            || (!ehDomingo && !ehFeriado && !diasUteis.includes(dow)); // ex.: sábado de folga
          const jornada = ehUtil ? durJornada : 0;
          dias.push({
            data,
            marcacoes: porDia.get(data) ?? [],
            jornadaContratadaMin: jornada,
            ehDomingo, ehFeriado, ehDescanso,
            regime: 'normal',
            janelaPrevista: ehUtil ? horario?.pares : undefined,
            ausenciaAbonadaMin: abonoDiaInteiro.has(data) ? jornada : abonoPorData.get(data),
          });
          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
      }

      const resultado = apurarPeriodo(dias, REGRAS_CLT_PADRAO);

      let valores: ResultadoValores | null = null;
      if (emp.salarioMensal != null) {
        const salarioMensalCentavos = Math.round(Number(emp.salarioMensal) * 100);
        valores = valorizarPeriodo(resultado, { salarioMensalCentavos, horasMensaisFolha: 220 }, REGRAS_CLT_PADRAO);
      }

      return {
        nome: emp.nome, matricula: emp.matricula, inicio: inicioStr, fim: fimStr,
        regras: regime === 'r12x36' ? 'CLT_12x36' : 'CLT_PADRAO', resultado, valores,
      };
    });
  }
  private hhmm(min: number): string {
    const a = Math.abs(min);
    return `${min < 0 ? '-' : ''}${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}`;
  }

  /** Gera o relatório de Apuração CLT em PDF (para download/impressão). */
  async gerarApuracaoPdf(
    tenantId: string, empregadoId: string, inicioStr: string, fimStr: string, feriados: string[] = [],
  ): Promise<{ buffer: Buffer; nomeArquivo: string }> {
    const ap = await this.apurarPeriodoCLT(tenantId, empregadoId, inicioStr, fimStr, feriados);
    const r = ap.resultado;

    const rep = (await comTenant(this.db, tenantId, (tx) =>
      tx.select().from(pontoRep).where(eq(pontoRep.tenantId, tenantId)).limit(1)))[0];
    const emp = (await comoMaster(this.db, (tx) =>
      tx.select().from(tenant).where(eq(tenant.id, tenantId)).limit(1)))[0];

    const dias: DiaRelatorio[] = r.dias.map((d) => {
      const sinais = [
        d.atrasoMin > 0 ? `atraso ${this.hhmm(d.atrasoMin)}` : '',
        d.paresIncompletos ? 'ímpar' : '',
        d.penalidadeIntervaloMin > 0 ? 'interv.' : '',
        d.violacaoInterjornada ? '11h' : '',
      ].filter(Boolean).join(' ');
      return {
        data: d.data,
        trabalhadoMin: d.minutosTrabalhados,
        contratadoMin: d.minutosContratados,
        extra: d.extras.map((e) => `${this.hhmm(e.min)}@${e.adicionalPct}%`).join(' '),
        noturnoMin: d.minutosNoturnosLegais,
        faltaMin: d.faltaMin,
        sinais,
      };
    });

    const buffer = await gerarRelatorioApuracaoPdf({
      valores: ap.valores ?? undefined,
      empregador: rep?.razaoSocial ?? '',
      localPrestacao: emp?.localPrestacao ?? '',
      numeroInpi: rep?.numeroInpi ?? '',
      nome: ap.nome, matricula: ap.matricula, inicio: inicioStr, fim: fimStr, regras: ap.regras,
      totais: {
        trabalhadoMin: r.totalTrabalhadoMin, contratadoMin: r.totalContratadoMin, extrasMin: r.totalExtrasMin,
        extra50Min: r.extrasPorAdicional['50'] ?? 0, extra100Min: r.extrasPorAdicional['100'] ?? 0,
        noturnoLegalMin: r.totalNoturnoLegalMin, faltaMin: r.totalFaltaMin, atrasoMin: r.totalAtrasoMin, saldoMin: r.saldoPeriodoMin,
        bancoMin: r.bancoDeHorasMin, reflexoDsrMin: r.reflexoDsrMin, dsrPerdidoSemanas: r.dsrPerdidoSemanas,
      },
      dias,
    });

    const ref = (ap.matricula ?? empregadoId).replace(/[^\w-]/g, '');
    return { buffer, nomeArquivo: `apuracao_${ref}_${inicioStr}_a_${fimStr}.pdf` };
  }

  /** Relatório consolidado em PDF (paisagem). */
  async gerarRelatorioCompetenciaPdf(tenantId: string, inicioStr: string, fimStr: string): Promise<{ buffer: Buffer; nomeArquivo: string }> {
    const rel = await this.relatorioCompetencia(tenantId, inicioStr, fimStr);
    const rep = (await comTenant(this.db, tenantId, (tx) =>
      tx.select().from(pontoRep).where(eq(pontoRep.tenantId, tenantId)).limit(1)))[0];
    const buffer = await montarPdfCompetencia({
      empregador: rep?.razaoSocial ?? '', numeroInpi: rep?.numeroInpi ?? '',
      inicio: inicioStr, fim: fimStr,
      linhas: rel.linhas.map((l) => ({
        nome: l.nome, matricula: l.matricula, temSalario: l.temSalario,
        trabalhadoMin: l.trabalhadoMin, extrasMin: l.extrasMin, noturnoMin: l.noturnoMin,
        faltaMin: l.faltaMin, atrasoMin: l.atrasoMin,
        extrasCentavos: l.extrasCentavos, liquidoProventosCentavos: l.liquidoProventosCentavos,
      })),
      totais: {
        trabalhadoMin: rel.totais.trabalhadoMin, extrasMin: rel.totais.extrasMin, noturnoMin: rel.totais.noturnoMin,
        faltaMin: rel.totais.faltaMin, atrasoMin: rel.totais.atrasoMin,
        extrasCentavos: rel.totais.extrasCentavos, liquidoProventosCentavos: rel.totais.liquidoProventosCentavos,
      },
    });
    return { buffer, nomeArquivo: `relatorio_${inicioStr}_a_${fimStr}.pdf` };
  }

  /** Relatório consolidado em Excel (.xlsx). */
  async gerarRelatorioCompetenciaXlsx(tenantId: string, inicioStr: string, fimStr: string): Promise<{ buffer: Buffer; nomeArquivo: string }> {
    const rel = await this.relatorioCompetencia(tenantId, inicioStr, fimStr);
    const h = (min: number) => Number((min / 60).toFixed(2));

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Competência');
    ws.columns = [
      { header: 'Funcionário', key: 'nome', width: 32 },
      { header: 'Matrícula', key: 'matricula', width: 12 },
      { header: 'Trabalhado (h)', key: 'trab', width: 14 },
      { header: 'Extras (h)', key: 'extra', width: 12 },
      { header: 'Noturno (h)', key: 'not', width: 12 },
      { header: 'Faltas (h)', key: 'falta', width: 12 },
      { header: 'Atrasos (h)', key: 'atraso', width: 12 },
      { header: 'Extras R$', key: 'extraRs', width: 14 },
      { header: 'Parcial R$', key: 'parcial', width: 14 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10403F' } }; c.font = { bold: true, color: { argb: 'FFFFF8EE' } }; });

    for (const l of rel.linhas) {
      ws.addRow({
        nome: l.nome, matricula: l.matricula ?? '',
        trab: h(l.trabalhadoMin), extra: h(l.extrasMin), not: h(l.noturnoMin), falta: h(l.faltaMin), atraso: h(l.atrasoMin),
        extraRs: l.temSalario ? l.extrasCentavos / 100 : null, parcial: l.temSalario ? l.liquidoProventosCentavos / 100 : null,
      });
    }
    const total = ws.addRow({
      nome: 'TOTAL',
      trab: h(rel.totais.trabalhadoMin), extra: h(rel.totais.extrasMin), not: h(rel.totais.noturnoMin),
      falta: h(rel.totais.faltaMin), atraso: h(rel.totais.atrasoMin),
      extraRs: rel.totais.extrasCentavos / 100, parcial: rel.totais.liquidoProventosCentavos / 100,
    });
    total.font = { bold: true };
    ws.getColumn('extraRs').numFmt = 'R$ #,##0.00';
    ws.getColumn('parcial').numFmt = 'R$ #,##0.00';

    const buf = await wb.xlsx.writeBuffer();
    return { buffer: Buffer.from(buf as ArrayBuffer), nomeArquivo: `relatorio_${inicioStr}_a_${fimStr}.xlsx` };
  }

  // ---- Painel / BI ----
  /** Visão do dia: quem bateu ponto, ausentes e últimas marcações. */
  async painel(tenantId: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const emps = await tx.select().from(empregado)
        .where(and(eq(empregado.tenantId, tenantId), eq(empregado.ativo, true)));
      const hojeISO = this.diaLocalISO(new Date());
      const inicio = new Date(`${hojeISO}T00:00:00-0300`);
      const fim = new Date(`${hojeISO}T23:59:59-0300`);

      const marcsHoje = await tx.select({ cpf: pontoMarcacao.cpf, dt: pontoMarcacao.dtMarcacao, coletor: pontoMarcacao.coletor })
        .from(pontoMarcacao).where(and(
          eq(pontoMarcacao.tenantId, tenantId), gte(pontoMarcacao.dtMarcacao, inicio), lte(pontoMarcacao.dtMarcacao, fim)))
        .orderBy(desc(pontoMarcacao.dtMarcacao));

      const nomePorCpf = new Map(emps.map((e) => [e.cpf, e]));
      const presentes = new Set(marcsHoje.map((m) => m.cpf));
      const ausentes = emps.filter((e) => !presentes.has(e.cpf)).map((e) => ({ nome: e.nome, matricula: e.matricula }));
      const ultimas = marcsHoje.slice(0, 8).map((m) => ({
        nome: nomePorCpf.get(m.cpf)?.nome ?? m.cpf, dt: m.dt, coletor: m.coletor,
      }));

      return {
        data: hojeISO,
        ativos: emps.length,
        presentes: presentes.size,
        ausentes: ausentes.length,
        listaAusentes: ausentes,
        marcacoesHoje: marcsHoje.length,
        ultimas,
      };
    });
  }

  /** Relatório consolidado da competência: uma linha por funcionário + totais. */
  async relatorioCompetencia(tenantId: string, inicioStr: string, fimStr: string) {
    const emps = await comTenant(this.db, tenantId, (tx) =>
      tx.select().from(empregado)
        .where(and(eq(empregado.tenantId, tenantId), eq(empregado.ativo, true)))
        .orderBy(asc(empregado.nome)));

    const linhas = [];
    for (const e of emps) {
      const ap = await this.apurarPeriodoCLT(tenantId, e.id, inicioStr, fimStr);
      const r = ap.resultado;
      const v = ap.valores;
      linhas.push({
        empregadoId: e.id, nome: e.nome, matricula: e.matricula, temSalario: !!v,
        trabalhadoMin: r.totalTrabalhadoMin, extrasMin: r.totalExtrasMin, faltaMin: r.totalFaltaMin,
        atrasoMin: r.totalAtrasoMin, noturnoMin: r.totalNoturnoLegalMin, dsrPerdidoSemanas: r.dsrPerdidoSemanas,
        extrasCentavos: v?.extrasCentavos ?? 0, adicionalNoturnoCentavos: v?.adicionalNoturnoCentavos ?? 0,
        liquidoProventosCentavos: v?.liquidoProventosCentavos ?? 0,
      });
    }

    const totais = linhas.reduce((a, l) => ({
      trabalhadoMin: a.trabalhadoMin + l.trabalhadoMin, extrasMin: a.extrasMin + l.extrasMin,
      faltaMin: a.faltaMin + l.faltaMin, atrasoMin: a.atrasoMin + l.atrasoMin, noturnoMin: a.noturnoMin + l.noturnoMin,
      extrasCentavos: a.extrasCentavos + l.extrasCentavos,
      adicionalNoturnoCentavos: a.adicionalNoturnoCentavos + l.adicionalNoturnoCentavos,
      liquidoProventosCentavos: a.liquidoProventosCentavos + l.liquidoProventosCentavos,
    }), { trabalhadoMin: 0, extrasMin: 0, faltaMin: 0, atrasoMin: 0, noturnoMin: 0, extrasCentavos: 0, adicionalNoturnoCentavos: 0, liquidoProventosCentavos: 0 });

    return { inicio: inicioStr, fim: fimStr, linhas, totais };
  }
}
