import { Inject, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte, isNull } from 'drizzle-orm';
import {
  pontoHorarioContratual, pontoTratamento, pontoAusencia, pontoMarcacao, pontoRep, empregado, pontoFeriado, pontoEscala, pontoDocumento, pontoAfastamento, pontoAjuste, tenant, empregadoEscalaVigencia,
  comTenant, comoMaster, type Db,
} from '@ponto/db';
import { foraDoRaio } from '@ponto/shared';
import { DB } from '../database/database.module';
import { apurarJornada } from './apuracao';
import { apurarPeriodo, valorizarPeriodo, diaSemana, type EntradaDia, type ResultadoValores } from '@ponto/apuracao-clt';
import { gerarRelatorioApuracaoPdf, gerarRelatorioCompetenciaPdf as montarPdfCompetencia, gerarEspelhoPontoPdf, inicioDoDia, fimDoDia, dataLocalDe, offsetMin, diaDaSemanaLocal, type DiaRelatorio, type LinhaEspelho } from '@ponto/rep-core';
import { montarRegrasApuracao } from './montar-regras';
import { resolverItens } from './resolver-itens';
import { ajustesAprovados, aplicarAjustes } from './ajustes';
import { resumirDestinacao } from './destinacao';
import ExcelJS from 'exceljs';

interface Par { entrada: string; saida: string; }

/** Transação Drizzle (o tx que comTenant entrega ao callback). */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

@Injectable()
export class TratamentoService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Fuso vigente do tenant (offset "-0300"). Rege limites de dia e apuração. */
  private async carregarFuso(tx: Tx, tenantId: string): Promise<string> {
    const t = (await tx.select({ fuso: tenant.fuso }).from(tenant).where(eq(tenant.id, tenantId)).limit(1))[0];
    return t?.fuso ?? '-0300';
  }

  // ---- Horário contratual ----
  criarHorario(tenantId: string, dto: { codigo: string; durJornadaMin: number; pares: Par[]; diasSemana?: number[]; regime?: string; jornadaPorDia?: Record<string, number> | null }) {
    return comTenant(this.db, tenantId, async (tx) =>
      (await tx.insert(pontoHorarioContratual).values({
        tenantId, codigo: dto.codigo, durJornadaMin: dto.durJornadaMin, pares: dto.pares,
        diasSemana: dto.diasSemana ?? [1, 2, 3, 4, 5], regime: dto.regime ?? 'normal',
        jornadaPorDia: dto.jornadaPorDia ?? null,
      }).returning())[0]);
  }

  /**
   * Corrige o cadastro de uma escala (a jornada estava errada desde o começo).
   * Recalcula a apuração de todos que a usam — por isso é para CORREÇÃO, não
   * para mudança real de jornada (essa usa mudarEscalaComVigencia).
   */
  atualizarHorario(tenantId: string, id: string, dto: { codigo?: string; durJornadaMin?: number; pares?: Par[]; diasSemana?: number[]; regime?: string; jornadaPorDia?: Record<string, number> | null }) {
    return comTenant(this.db, tenantId, async (tx) => {
      const set: Record<string, unknown> = {};
      if (dto.codigo !== undefined) set.codigo = dto.codigo;
      if (dto.durJornadaMin !== undefined) set.durJornadaMin = dto.durJornadaMin;
      if (dto.pares !== undefined) set.pares = dto.pares;
      if (dto.diasSemana !== undefined) set.diasSemana = dto.diasSemana;
      if (dto.regime !== undefined) set.regime = dto.regime;
      if (dto.jornadaPorDia !== undefined) set.jornadaPorDia = dto.jornadaPorDia;
      const rows = await tx.update(pontoHorarioContratual).set(set)
        .where(and(eq(pontoHorarioContratual.id, id), eq(pontoHorarioContratual.tenantId, tenantId))).returning();
      if (!rows[0]) throw new NotFoundException('Escala não encontrada');
      return rows[0];
    });
  }

  /** Exclui uma escala, apenas se ninguém a estiver usando (vínculo ou vigência). */
  excluirHorario(tenantId: string, id: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const emUso = (await tx.select({ id: empregado.id }).from(empregado)
        .where(and(eq(empregado.horarioContratualId, id), eq(empregado.tenantId, tenantId))).limit(1))[0];
      const emVig = (await tx.select({ id: empregadoEscalaVigencia.id }).from(empregadoEscalaVigencia)
        .where(and(eq(empregadoEscalaVigencia.horarioContratualId, id), eq(empregadoEscalaVigencia.tenantId, tenantId))).limit(1))[0];
      if (emUso || emVig) {
        throw new ConflictException('Esta escala está em uso por funcionários. Troque a escala deles antes de excluir.');
      }
      const rows = await tx.delete(pontoHorarioContratual)
        .where(and(eq(pontoHorarioContratual.id, id), eq(pontoHorarioContratual.tenantId, tenantId))).returning();
      if (!rows[0]) throw new NotFoundException('Escala não encontrada');
      return { excluido: true };
    });
  }

  /**
   * Mudança REAL de escala a partir de uma data: encerra a vigência atual no dia
   * anterior e abre a nova a partir de dataInicio. O passado é preservado — a
   * apuração dos dias anteriores continua usando a escala antiga.
   * Também atualiza o horário "atual" do empregado (leitura rápida).
   */
  mudarEscalaComVigencia(tenantId: string, empregadoId: string, horarioContratualId: string, dataInicio: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const hor = (await tx.select().from(pontoHorarioContratual)
        .where(and(eq(pontoHorarioContratual.id, horarioContratualId), eq(pontoHorarioContratual.tenantId, tenantId))).limit(1))[0];
      if (!hor) throw new NotFoundException('Escala não encontrada');
      const emp = (await tx.select({ id: empregado.id }).from(empregado)
        .where(and(eq(empregado.id, empregadoId), eq(empregado.tenantId, tenantId))).limit(1))[0];
      if (!emp) throw new NotFoundException('Empregado não encontrado');

      // Limpar vigências corrompidas (data_fim < data_inicio) ou fechadas
      // que sobraram de chamadas anteriores duplicadas.
      const todas = await tx.select().from(empregadoEscalaVigencia)
        .where(and(eq(empregadoEscalaVigencia.empregadoId, empregadoId), eq(empregadoEscalaVigencia.tenantId, tenantId)));
      for (const v of todas) {
        if (v.dataFim != null && v.dataFim < v.dataInicio) {
          await tx.delete(empregadoEscalaVigencia).where(eq(empregadoEscalaVigencia.id, v.id));
        }
      }

      // Encerra qualquer vigência aberta no dia anterior a dataInicio.
      const diaAnterior = TratamentoService.somarDias(dataInicio, -1);
      await tx.update(empregadoEscalaVigencia)
        .set({ dataFim: diaAnterior })
        .where(and(
          eq(empregadoEscalaVigencia.empregadoId, empregadoId),
          eq(empregadoEscalaVigencia.tenantId, tenantId),
          isNull(empregadoEscalaVigencia.dataFim),
        ));

      // Abre a nova vigência.
      await tx.insert(empregadoEscalaVigencia).values({
        tenantId, empregadoId, horarioContratualId, dataInicio,
      });
      // Atualiza o "atual" do empregado.
      await tx.update(empregado).set({ horarioContratualId })
        .where(and(eq(empregado.id, empregadoId), eq(empregado.tenantId, tenantId)));
      return { ok: true, dataInicio };
    });
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

      const fuso = await this.carregarFuso(tx, tenantId);
      const inicio = inicioDoDia(dataStr, fuso);
      const fim = fimDoDia(dataStr, fuso);

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
      // Ajustes aprovados do dia. As desconsideradas continuam indo pro AEJ,
      // mas marcadas como 'D'; as incluídas entram com fonte 'I'. A sequência
      // E/S é contada só sobre as batidas que valem.
      const aj = await ajustesAprovados(tx as never, tenantId, empregadoId, dataStr, dataStr);
      const efetivas = aplicarAjustes(marcs, aj);

      for (let i = 0; i < efetivas.length; i++) {
        const e = efetivas[i]!;
        const tpMarc = i % 2 === 0 ? 'E' : 'S';
        const seq = Math.floor(i / 2) + 1;
        const inc = e.origem === 'INCLUIDA';
        await tx.insert(pontoTratamento).values({
          tenantId, empregadoId, marcacaoId: e.marcacaoId ?? null, dtMarcacao: e.dtMarcacao,
          tpMarc, seqEntSaida: seq, fonteMarc: inc ? 'I' : 'O',
          motivo: inc ? (e.motivo ?? 'Batida incluída por ajuste aprovado') : null,
          codHorContratual: tpMarc === 'E' && seq === 1 ? codHor : null,
        });
        criados++;
      }
      // As desconsideradas entram como 'D' (o AEJ registra que existiram).
      for (const m of marcs) {
        if (!aj.desconsideradas.has(m.id)) continue;
        await tx.insert(pontoTratamento).values({
          tenantId, empregadoId, marcacaoId: m.id, dtMarcacao: m.dtMarcacao,
          tpMarc: 'D', seqEntSaida: 0, fonteMarc: 'O',
          motivo: aj.desconsideradas.get(m.id) ?? 'Marcação desconsiderada por ajuste aprovado',
        });
        criados++;
      }

      const resumo = apurarJornada(efetivas.map((e) => e.dtMarcacao), durJornada);
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

      // Local do estabelecimento (p/ o RH ver de onde cada batida saiu) e fuso.
      const t = (await tx.select().from(tenant).where(eq(tenant.id, tenantId)).limit(1))[0];
      const fuso = t?.fuso ?? '-0300';

      const inicio = inicioDoDia(dataStr, fuso);
      const fim = fimDoDia(dataStr, fuso);
      const marcs = await tx.select({
        id: pontoMarcacao.id,
        nsr: pontoMarcacao.nsr, dtMarcacao: pontoMarcacao.dtMarcacao,
        dtGravacao: pontoMarcacao.dtGravacao,
        latitude: pontoMarcacao.latitude, longitude: pontoMarcacao.longitude,
        observacao: pontoMarcacao.observacao,
        onlineOffline: pontoMarcacao.onlineOffline, defasagemSeg: pontoMarcacao.defasagemSeg,
      })
        .from(pontoMarcacao)
        .where(and(eq(pontoMarcacao.repId, rep.id), eq(pontoMarcacao.cpf, emp.cpf),
          gte(pontoMarcacao.dtMarcacao, inicio), lte(pontoMarcacao.dtMarcacao, fim)))
        .orderBy(asc(pontoMarcacao.dtMarcacao));

      // Ajustes aprovados do dia: marcam o que foi desconsiderado e trazem as
      // batidas incluídas (que não existem em ponto_marcacao).
      const aj = await ajustesAprovados(tx as never, tenantId, empregadoId, dataStr, dataStr);
      const efetivas = aplicarAjustes(marcs, aj);

      const hor = emp.horarioContratualId
        ? (await tx.select().from(pontoHorarioContratual)
            .where(eq(pontoHorarioContratual.id, emp.horarioContratualId)).limit(1))[0]
        : undefined;
      const dur = hor?.durJornadaMin ?? 0;
      // CLT Art. 71: jornada ≤ 6h não tem intervalo obrigatório.
      // Resolve quantos pares o dia realmente tem baseado na jornada efetiva.
      const dowEsp = new Date(`${dataStr}T12:00:00${fuso.slice(0, 3)}:${fuso.slice(3)}`).getDay();
      const jornadaDiaEsp = hor?.jornadaPorDia?.[String(dowEsp)] ?? dur;
      const paresEfetivos = jornadaDiaEsp > 0 && jornadaDiaEsp <= 360 && (hor?.pares?.length ?? 0) > 1
        ? 1 : (hor?.pares?.length ?? 0);
      const esperadas = paresEfetivos * 2;

      const local = t?.latitude && t?.longitude
        ? { latitude: Number(t.latitude), longitude: Number(t.longitude), raioMetros: t.raioMetros }
        : null;

      return {
        nome: emp.nome, matricula: emp.matricula, esperadas,
        marcacoes: marcs.map((m) => {
          const pos = m.latitude != null && m.longitude != null
            ? { latitude: Number(m.latitude), longitude: Number(m.longitude) } : null;
          const { fora, distancia } = foraDoRaio(local, pos);
          return {
            nsr: Number(m.nsr), dtMarcacao: m.dtMarcacao,
            latitude: pos?.latitude ?? null, longitude: pos?.longitude ?? null,
            observacao: m.observacao, fora, distancia,
            // Offline com defasagem relevante: o RH precisa saber que a hora
            // veio do relógio do aparelho, não do servidor.
            offline: m.onlineOffline === 1,
            defasagemSeg: m.defasagemSeg ?? null,
            marcacaoId: m.id,
            // Desconsiderada por ajuste aprovado: continua no AFD, mas não conta.
            desconsiderada: aj.desconsideradas.has(m.id),
            motivoAjuste: aj.desconsideradas.get(m.id) ?? null,
          };
        }),
        // Batidas incluídas por ajuste aprovado (não existem no AFD original).
        incluidas: aj.inclusoes.map((i) => ({ dtMarcacao: i.dtMarcacao, tpMarc: i.tpMarc, motivo: i.motivo })),
        resumo: apurarJornada(efetivas.map((m) => m.dtMarcacao), dur),
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
      const fuso = await this.carregarFuso(tx, tenantId);
      const inicio = new Date(`${inicioStr}T12:00:00${fuso}`);
      const fim = new Date(`${fimStr}T12:00:00${fuso}`);
      const base = new Date(`${dataInicioStr}T12:00:00${fuso}`);
      const dias: string[] = [];
      // ciclo de 48h: trabalha um dia, folga o seguinte
      for (const cur = new Date(base); cur.getTime() <= fim.getTime(); cur.setUTCDate(cur.getUTCDate() + 2)) {
        if (cur.getTime() >= inicio.getTime()) dias.push(this.diaLocalISO(cur, fuso));
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

  /** Data no calendário local (fuso do tenant) a partir de um instante UTC. */
  private diaLocalISO(d: Date, fuso: string): string {
    return dataLocalDe(d, fuso);
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

      const fuso = await this.carregarFuso(tx, tenantId);
      const inicio = inicioDoDia(inicioStr, fuso);
      const fim = fimDoDia(fimStr, fuso);

      const marcs = await tx.select({ id: pontoMarcacao.id, dtMarcacao: pontoMarcacao.dtMarcacao }).from(pontoMarcacao)
        .where(and(eq(pontoMarcacao.repId, rep.id), eq(pontoMarcacao.cpf, emp.cpf),
          gte(pontoMarcacao.dtMarcacao, inicio), lte(pontoMarcacao.dtMarcacao, fim)))
        .orderBy(asc(pontoMarcacao.dtMarcacao));

      // Ajustes aprovados: tira as batidas desconsideradas, soma as incluídas.
      // O AFD segue intocado — isto vale só pro cálculo e pro espelho.
      const aj = await ajustesAprovados(tx as never, tenantId, empregadoId, inicioStr, fimStr);
      const efetivas = aplicarAjustes(marcs, aj);

      const horario = emp.horarioContratualId
        ? (await tx.select().from(pontoHorarioContratual)
            .where(eq(pontoHorarioContratual.id, emp.horarioContratualId)).limit(1))[0]
        : undefined;
      const durJornada = horario?.durJornadaMin ?? 0;
      const diasUteis = horario?.diasSemana ?? [1, 2, 3, 4, 5]; // seg–sex por padrão

      // Vigências de escala do funcionário: qual escala valia em cada período.
      // Para cada dia, escalaDoDia() devolve o horário vigente naquele dia —
      // é isso que preserva o passado quando a escala muda no meio do vínculo.
      const vigencias = await tx.select().from(empregadoEscalaVigencia)
        .where(and(eq(empregadoEscalaVigencia.empregadoId, empregadoId), eq(empregadoEscalaVigencia.tenantId, tenantId)))
        .orderBy(asc(empregadoEscalaVigencia.dataInicio));
      const horariosVig = new Map<string, typeof horario>();
      for (const v of vigencias) {
        if (!horariosVig.has(v.horarioContratualId)) {
          horariosVig.set(v.horarioContratualId,
            (await tx.select().from(pontoHorarioContratual).where(eq(pontoHorarioContratual.id, v.horarioContratualId)).limit(1))[0]);
        }
      }
      // Resolve a escala vigente numa data (YYYY-MM-DD). Se não houver vigência
      // cobrindo o dia, cai no horário atual do funcionário (compatibilidade).
      const escalaDoDia = (data: string): typeof horario => {
        for (const v of vigencias) {
          if (data >= v.dataInicio && (v.dataFim == null || data <= v.dataFim)) {
            return horariosVig.get(v.horarioContratualId) ?? horario;
          }
        }
        return horario;
      };

      // Regras por item: escolha do funcionário → padrão do tipo → CLT.
      const itens = await resolverItens(tx as never, tenantId, emp.perfilRegraId);
      const regras = montarRegrasApuracao(itens);
      const bancoAtivo = itens.banco?.bancoModo === 'ATIVO' ? true
        : itens.banco?.bancoModo === 'INATIVO' ? false
        : ((await tx.select({ tipo: tenant.bancoTipoAcordo }).from(tenant).where(eq(tenant.id, tenantId)).limit(1))[0]?.tipo ?? 'NENHUM') !== 'NENHUM';

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
      // Férias, INSS e licenças: o dia não é esperado, então não pode virar falta.
      // Entra pelo mesmo cano do atestado (abono de dia inteiro), que já é testado.
      const afast = await tx.select().from(pontoAfastamento).where(and(
        eq(pontoAfastamento.tenantId, tenantId), eq(pontoAfastamento.empregadoId, empregadoId),
        lte(pontoAfastamento.dataInicio, fimStr), gte(pontoAfastamento.dataFim, inicioStr)));

      const abonoPorData = new Map<string, number>();
      const abonoDiaInteiro = new Set<string>();
      for (const a of afast) {
        for (let dt = a.dataInicio; dt <= a.dataFim; dt = TratamentoService.somarDias(dt, 1)) {
          if (dt >= inicioStr && dt <= fimStr) abonoDiaInteiro.add(dt);
        }
      }
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

      // agrupa as batidas EFETIVAS (com ajustes aprovados) por dia local
      const porDia = new Map<string, Date[]>();
      for (const m of efetivas) {
        const dataLocal = this.diaLocalISO(m.dtMarcacao, fuso);
        const arr = porDia.get(dataLocal) ?? [];
        arr.push(m.dtMarcacao);
        porDia.set(dataLocal, arr);
      }

      const regime = (horario?.regime === 'r12x36' ? 'r12x36' : 'normal') as 'normal' | 'r12x36';
      const dias: EntradaDia[] = [];

      // Data de início de uso do ponto: dias anteriores são ignorados por
      // completo (migração de sistema ou admissão no meio do período).
      const dataInicioPonto = emp.dataInicioPonto ?? null;
      const antesDoInicio = (data: string) => dataInicioPonto != null && data < dataInicioPonto;

      // Dias que ainda não aconteceram não viram falta: o funcionário ainda vai
      // bater ponto neles. O dia de hoje entra na apuração (pode ter batidas
      // parciais e o funcionário precisa ver/solicitar ajuste), mas não gera
      // falta de dia inteiro — só dias estritamente passados geram falta.
      const hojeISO = this.diaLocalISO(new Date(), fuso);
      const naoChegou = (data: string) => data > hojeISO;
      const foraDoPeriodoReal = (data: string) => antesDoInicio(data) || naoChegou(data);

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
          if (foraDoPeriodoReal(data)) continue; // antes do início de uso do ponto
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
        const cursor = new Date(`${inicioStr}T12:00:00${fuso}`);
        const ultimo = new Date(`${fimStr}T12:00:00${fuso}`);
        while (cursor.getTime() <= ultimo.getTime()) {
          const data = this.diaLocalISO(cursor, fuso);
          // Antes do início de uso do ponto: dia não existe para a apuração.
          if (foraDoPeriodoReal(data)) { cursor.setUTCDate(cursor.getUTCDate() + 1); continue; }
          const dow = diaSemana(data);
          const escDia = escalaDoDia(data);
          // Jornada do dia: se a escala tem jornada_por_dia com valor para este
          // dia da semana, usa ele; senão cai na jornada única (dur_jornada_min).
          const porDiaMap = escDia?.jornadaPorDia as Record<string, number> | null | undefined;
          const durDia = (porDiaMap && porDiaMap[String(dow)] != null)
            ? porDiaMap[String(dow)]!
            : (escDia?.durJornadaMin ?? 0);
          const uteisDia = escDia?.diasSemana ?? [1, 2, 3, 4, 5];
          const ehFeriado = feriadoSet.has(data);
          const ehDomingo = dow === 0;
          const ehUtil = uteisDia.includes(dow) && !ehFeriado && !descansoPorAusencia.has(data);
          const ehDescanso = descansoPorAusencia.has(data)
            || (!ehDomingo && !ehFeriado && !uteisDia.includes(dow)); // ex.: sábado de folga
          const jornada = ehUtil ? durDia : 0;
          // Se o dia usa jornada-por-dia diferente da base, a janela fixa (pares)
          // não corresponde a este dia — usá-la geraria "saída antecipada" falsa.
          // Nesse caso avalia só pela duração do dia (a janela fica de fora).
          const jornadaCustomizada = porDiaMap != null && porDiaMap[String(dow)] != null
            && porDiaMap[String(dow)] !== escDia?.durJornadaMin;
          dias.push({
            data,
            marcacoes: porDia.get(data) ?? [],
            jornadaContratadaMin: jornada,
            ehDomingo, ehFeriado, ehDescanso,
            regime: 'normal',
            janelaPrevista: (ehUtil && !jornadaCustomizada) ? escDia?.pares : undefined,
            ausenciaAbonadaMin: abonoDiaInteiro.has(data) ? jornada : abonoPorData.get(data),
          });
          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
      }

      const resultado = apurarPeriodo(dias, regras);

      // O motor é puro e não conhece "férias". O motivo vem junto do resultado
      // para a tela poder escrever Férias em vez de deixar o dia em branco.
      const afastamentos = afast.map((a) => ({
        tipo: a.tipo, dataInicio: a.dataInicio, dataFim: a.dataFim, observacao: a.observacao,
      }));

      let valores: ResultadoValores | null = null;
      if (emp.salarioMensal != null) {
        const salarioMensalCentavos = Math.round(Number(emp.salarioMensal) * 100);
        valores = valorizarPeriodo(resultado, { salarioMensalCentavos, horasMensaisFolha: 220 }, regras);
      }

      const destinacao = resumirDestinacao(resultado, {
        destinacaoFaltas: itens.destinacao?.destinacaoFaltas ?? 'DESCONTA',
        destinacaoAtrasos: itens.destinacao?.destinacaoAtrasos ?? 'BANCO',
        bancoAtivo,
      });

      // Batidas de cada dia com a origem: o RH precisa ver o dia inteiro,
      // inclusive a que foi desconsiderada (que continua no AFD) e a que
      // entrou por ajuste aprovado.
      const batidas: Record<string, { dtMarcacao: Date; origem: 'ORIGINAL' | 'INCLUIDA' | 'DESCONSIDERADA'; motivo: string | null }[]> = {};
      const põe = (d: string, item: { dtMarcacao: Date; origem: 'ORIGINAL' | 'INCLUIDA' | 'DESCONSIDERADA'; motivo: string | null }) => {
        (batidas[d] ??= []).push(item);
      };
      for (const m of marcs) {
        const desconsiderada = aj.desconsideradas.has(m.id);
        põe(this.diaLocalISO(m.dtMarcacao, fuso), {
          dtMarcacao: m.dtMarcacao,
          origem: desconsiderada ? 'DESCONSIDERADA' : 'ORIGINAL',
          motivo: desconsiderada ? (aj.desconsideradas.get(m.id) ?? null) : null,
        });
      }
      for (const i of aj.inclusoes) {
        põe(this.diaLocalISO(i.dtMarcacao, fuso), { dtMarcacao: i.dtMarcacao, origem: 'INCLUIDA', motivo: i.motivo });
      }
      for (const d of Object.keys(batidas)) {
        batidas[d]!.sort((a, b) => a.dtMarcacao.getTime() - b.dtMarcacao.getTime());
      }

      return {
        nome: emp.nome, matricula: emp.matricula, inicio: inicioStr, fim: fimStr,
        regras: regime === 'r12x36' ? 'CLT_12x36' : 'CLT_PADRAO', resultado, valores,
        afastamentos, destinacao, batidas,
        /** Batidas previstas pelo horário contratual (2 por par). */
        esperadas: (horario?.pares?.length ?? 0) * 2,
        horarioPares: horario?.pares ?? [],
        horarioDurMin: horario?.durJornadaMin ?? 0,
        jornadaPorDia: horario?.jornadaPorDia ?? null,
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

  /**
   * Demonstrativo de Espelho de Ponto — o documento que o funcionário confere e
   * assina. Puxa a apuração real, mostra as marcações originais e a jornada
   * tratada (respeitando ajustes aprovados) e os eventos do dia.
   */
  /**
   * Conteúdo estruturado do espelho (cabeçalho + linhas + totais), sem gerar
   * PDF. Base tanto do PDF quanto do hash de assinatura — o hash é deste
   * conteúdo, então não muda pela data de geração impressa no rodapé.
   */
  async conteudoEspelho(tenantId: string, empregadoId: string, inicioStr: string, fimStr: string) {
    const ap = await this.apurarPeriodoCLT(tenantId, empregadoId, inicioStr, fimStr);
    const r = ap.resultado;

    const [rep, emp, t] = await Promise.all([
      comTenant(this.db, tenantId, (tx) => tx.select().from(pontoRep).where(eq(pontoRep.tenantId, tenantId)).limit(1)),
      comTenant(this.db, tenantId, (tx) => tx.select().from(empregado).where(and(eq(empregado.id, empregadoId), eq(empregado.tenantId, tenantId))).limit(1)),
      comoMaster(this.db, (tx) => tx.select().from(tenant).where(eq(tenant.id, tenantId)).limit(1)),
    ]);
    const rep0 = rep[0]; const emp0 = emp[0]; const t0 = t[0];
    if (!emp0) throw new NotFoundException('Empregado não encontrado');
    const fuso = t0?.fuso ?? '-0300';

    const hhmm = (min: number) => this.hhmm(min);
    const hora = (d: Date) => {
      const iso = new Date(d.getTime() + offsetMin(fuso) * 60000).toISOString();
      return iso.slice(11, 16);
    };
    const paresEsperados = (ap.horarioPares ?? []).map((p) => `${p.entrada}-${p.saida}`).join(' ');

    const afastPorDia = new Map<string, string>();
    for (const a of ap.afastamentos ?? []) {
      for (let dt = a.dataInicio; dt <= a.dataFim; dt = TratamentoService.somarDias(dt, 1)) afastPorDia.set(dt, a.tipo);
    }

    const linhas = r.dias.map((d) => {
      const orig = (ap.batidas?.[d.data] ?? []);
      const originais = orig.filter((b) => b.origem !== 'INCLUIDA').map((b) => hora(b.dtMarcacao)).join(' ');
      const realizada = d.marcacoes.length ? this.paresDe(d.marcacoes.map((m) => hora(m))) : '';

      const eventos: string[] = [];
      if (d.ehDescansoDia && d.minutosTrabalhados > 0) eventos.push('Trabalho em descanso');
      const afast = afastPorDia.get(d.data);
      if (afast) eventos.push(afast === 'FERIAS' ? 'Férias' : afast === 'ATESTADO' ? 'Atestado' : afast);
      if (orig.some((b) => b.origem === 'INCLUIDA')) eventos.push('Batida incluída (ajuste)');
      if (orig.some((b) => b.origem === 'DESCONSIDERADA')) eventos.push('Batida desconsiderada (ajuste)');
      for (const o of d.observacoes ?? []) if (!eventos.includes(o)) eventos.push(o);

      const tipoDia: LinhaEspelho['tipoDia'] =
        afast === 'FERIAS' ? 'FOLGA'
        : afast === 'ATESTADO' ? 'ATESTADO'
        : d.faltaInjustificada ? 'FALTA'
        : eventos.some((e) => /feriado/i.test(e)) ? 'FERIADO'
        : d.ehDescansoDia && d.minutosTrabalhados === 0 ? 'FOLGA'
        : 'TRAB';

      return {
        data: d.data, tipoDia,
        jornadaEsperada: tipoDia === 'TRAB' ? paresEsperados : '—',
        marcacoesOriginais: originais || '—',
        jornadaRealizada: realizada || '—',
        horasRealizadas: d.minutosTrabalhados > 0 ? hhmm(d.minutosTrabalhados) : '',
        horasPositivas: d.extrasTotalMin > 0 ? hhmm(d.extrasTotalMin) : '',
        atrasosFaltas: d.faltaMin > 0 ? hhmm(d.faltaMin) : d.atrasoMin > 0 ? hhmm(d.atrasoMin) : '',
        horaNoturna: d.minutosNoturnosLegais > 0 ? hhmm(d.minutosNoturnosLegais) : '',
        compensadasDebito: '',
        compensadasCredito: r.bancoDeHorasMin > 0 && d.saldoMin > 0 ? hhmm(d.saldoMin) : '',
        eventos: eventos.join(' · '),
      } satisfies LinhaEspelho;
    });

    return {
      empresa: rep0?.razaoSocial ?? t0?.razaoSocial ?? '',
      cnpj: t0?.cnpj ?? '',
      endereco: t0?.localPrestacao ?? undefined,
      nome: emp0.nome, matricula: emp0.matricula, cpf: emp0.cpf,
      competenciaInicio: inicioStr, competenciaFim: fimStr, fuso,
      linhas,
      totais: {
        trabalhado: hhmm(r.totalTrabalhadoMin),
        horasNormaisEsperadas: hhmm(r.totalContratadoMin),
        saldoBanco: r.bancoDeHorasMin > 0 ? hhmm(r.bancoDeHorasMin) : undefined,
      },
    };
  }

  async gerarEspelhoPdf(
    tenantId: string, empregadoId: string, inicioStr: string, fimStr: string,
    assinatura?: { nome: string; cpf: string; em: string; via: string; hashDocumento?: string; referencia?: string } | null,
  ): Promise<{ buffer: Buffer; nomeArquivo: string }> {
    const c = await this.conteudoEspelho(tenantId, empregadoId, inicioStr, fimStr);
    const emp0 = { nome: c.nome, matricula: c.matricula };

    const buffer = await gerarEspelhoPontoPdf({
      empresa: c.empresa, cnpj: c.cnpj, endereco: c.endereco,
      nome: c.nome, matricula: c.matricula, cpf: c.cpf,
      competenciaInicio: inicioStr, competenciaFim: fimStr, fuso: c.fuso,
      linhas: c.linhas,
      totais: c.totais,
      assinaturaEletronica: assinatura ?? null,
    });

    const ref = (emp0.matricula ?? empregadoId).replace(/[^\w-]/g, '');
    return { buffer, nomeArquivo: `espelho_${ref}_${inicioStr}_a_${fimStr}.pdf` };
  }

  /**
   * Gera, em lote, apuração e/ou espelho de vários funcionários e devolve um
   * único ZIP. Cada arquivo é nomeado com o nome do funcionário e o período,
   * para o RH conseguir identificar sem abrir. Se um funcionário falhar (ex.:
   * sem escala), registra num arquivo ERROS.txt e segue com os demais.
   */
  async gerarLoteZip(
    tenantId: string, empregadoIds: string[], inicioStr: string, fimStr: string,
    docs: { apuracao: boolean; espelho: boolean }, feriados: string[] = [],
  ): Promise<{ buffer: Buffer; nomeArquivo: string }> {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const erros: string[] = [];
    // Nome legível do funcionário para o arquivo (sem acentos/espaços problemáticos).
    const nomes = await comTenant(this.db, tenantId, async (tx) =>
      tx.select({ id: empregado.id, nome: empregado.nome, matricula: empregado.matricula })
        .from(empregado).where(and(eq(empregado.tenantId, tenantId), inArray(empregado.id, empregadoIds))));
    const nomePorId = new Map(nomes.map((n) => [n.id, n]));
    const slug = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

    for (const id of empregadoIds) {
      const info = nomePorId.get(id);
      const base = info ? `${slug(info.nome)}${info.matricula ? `_mat${info.matricula}` : ''}` : id;
      try {
        if (docs.apuracao) {
          const r = await this.gerarApuracaoPdf(tenantId, id, inicioStr, fimStr, feriados);
          zip.file(`${base}/apuracao_${inicioStr}_a_${fimStr}.pdf`, r.buffer);
        }
        if (docs.espelho) {
          const r = await this.gerarEspelhoPdf(tenantId, id, inicioStr, fimStr);
          zip.file(`${base}/espelho_${inicioStr}_a_${fimStr}.pdf`, r.buffer);
        }
      } catch (e) {
        erros.push(`${info?.nome ?? id}: ${(e as Error).message}`);
      }
    }
    if (erros.length > 0) {
      zip.file('ERROS.txt', `Não foi possível gerar para:\n\n${erros.join('\n')}\n`);
    }
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    return { buffer, nomeArquivo: `apuracoes_${inicioStr}_a_${fimStr}.zip` };
  }

  /** Junta horários em pares "entrada-saída" para o espelho. */
  private paresDe(horas: string[]): string {
    const out: string[] = [];
    for (let i = 0; i < horas.length; i += 2) {
      out.push(horas[i + 1] ? `${horas[i]}-${horas[i + 1]}` : `${horas[i]}`);
    }
    return out.join(' ');
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
      const fuso = await this.carregarFuso(tx, tenantId);
      const hojeISO = this.diaLocalISO(new Date(), fuso);
      const inicio = inicioDoDia(hojeISO, fuso);
      const fim = fimDoDia(hojeISO, fuso);

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

      // Pendências que pedem ação do RH.
      // 1) Atestados enviados e ainda não decididos.
      const pendDocs = await tx.select({ id: pontoDocumento.id }).from(pontoDocumento).where(and(
        eq(pontoDocumento.tenantId, tenantId), eq(pontoDocumento.status, 'EM_ANALISE')));

      // 2) Dias (passados, deste mês) com número ímpar de batidas: alguém esqueceu
      //    de bater a entrada ou a saída. O dia de hoje fica de fora (ainda em curso).
      const inicioMesTs = inicioDoDia(`${hojeISO.slice(0, 7)}-01`, fuso);
      const marcsMes = await tx.select({ cpf: pontoMarcacao.cpf, dt: pontoMarcacao.dtMarcacao }).from(pontoMarcacao)
        .where(and(eq(pontoMarcacao.tenantId, tenantId), gte(pontoMarcacao.dtMarcacao, inicioMesTs), lte(pontoMarcacao.dtMarcacao, fim)));
      const porDia = new Map<string, number>();
      for (const m of marcsMes) {
        const k = `${m.cpf}|${this.diaLocalISO(m.dt, fuso)}`;
        porDia.set(k, (porDia.get(k) ?? 0) + 1);
      }
      // Data de início do ponto por CPF: dias anteriores não entram em "revisar".
      const inicioPorCpf = new Map(emps.filter((e) => e.dataInicioPonto).map((e) => [e.cpf, e.dataInicioPonto!]));
      const revisar = [...porDia.entries()]
        .filter(([k, n]) => {
          const [cpf, data] = k.split('|') as [string, string];
          if (n % 2 !== 1 || data >= hojeISO) return false;
          const ini = inicioPorCpf.get(cpf);
          if (ini && data < ini) return false; // antes de entrar no ponto
          return true;
        })
        .map(([k]) => { const [cpf, data] = k.split('|') as [string, string]; return { nome: nomePorCpf.get(cpf)?.nome ?? cpf, data }; })
        .sort((a, b) => (a.data < b.data ? 1 : -1));

      // 3) Quem já devia ter batido hoje e não bateu. Cruza com o horário: só
      //    cobra em dia de trabalho, depois da entrada (+30min de tolerância), e
      //    nunca de quem está de folga (ausência 1/4) ou afastado hoje.
      const dowHoje = diaDaSemanaLocal(hojeISO, fuso);
      const agoraLocal = new Date(Date.now() + offsetMin(fuso) * 60_000);
      const minsAgora = agoraLocal.getUTCHours() * 60 + agoraLocal.getUTCMinutes();
      const GRACA_MIN = 30;

      const horIds = [...new Set(emps.map((e) => e.horarioContratualId).filter((x): x is string => !!x))];
      const horarios = horIds.length
        ? await tx.select().from(pontoHorarioContratual).where(inArray(pontoHorarioContratual.id, horIds))
        : [];
      const horPorId = new Map(horarios.map((h) => [h.id, h]));

      const folgasHoje = await tx.select({ e: pontoAusencia.empregadoId }).from(pontoAusencia).where(and(
        eq(pontoAusencia.tenantId, tenantId), eq(pontoAusencia.data, hojeISO), inArray(pontoAusencia.tipo, [1, 4])));
      const afastHoje = await tx.select({ e: pontoAfastamento.empregadoId }).from(pontoAfastamento).where(and(
        eq(pontoAfastamento.tenantId, tenantId), lte(pontoAfastamento.dataInicio, hojeISO), gte(pontoAfastamento.dataFim, hojeISO)));
      const dispensados = new Set<string>([...folgasHoje.map((f) => f.e), ...afastHoje.map((a) => a.e)]);

      // Pedidos de ajuste de ponto aguardando decisão do RH.

      const ajustesPend = await tx.select({ id: pontoAjuste.id }).from(pontoAjuste).where(and(

        eq(pontoAjuste.tenantId, tenantId), eq(pontoAjuste.status, 'EM_ANALISE')));


      const naoBateram = emps
        .filter((e) => {
          if (presentes.has(e.cpf)) return false;         // já bateu
          if (dispensados.has(e.id)) return false;         // folga/afastamento hoje
          if (e.dataInicioPonto && hojeISO < e.dataInicioPonto) return false; // ainda não entrou no ponto
          const h = e.horarioContratualId ? horPorId.get(e.horarioContratualId) : undefined;
          if (!h || h.regime === 'r12x36') return false;   // sem horário fixo → não dá pra cobrar
          if (!h.diasSemana.includes(dowHoje)) return false; // não trabalha hoje
          const ent = h.pares[0]?.entrada;
          if (!ent) return false;
          const entradaMin = Number(ent.slice(0, 2)) * 60 + Number(ent.slice(2));
          return minsAgora >= entradaMin + GRACA_MIN;
        })
        .map((e) => {
          const ent = horPorId.get(e.horarioContratualId!)!.pares[0]!.entrada;
          return { nome: e.nome, desde: `${ent.slice(0, 2)}:${ent.slice(2)}` };
        });

      // Ausentes que ainda NÃO são cobrança: explica a diferença entre "ausentes"
      // e "não bateram". Cada um cai em uma categoria clara.
      let noPrazo = 0;       // dia de trabalho, mas ainda dentro do horário/carência
      let folgaHojeN = 0;    // de folga ou afastado hoje
      let semJornadaHoje = 0; // não trabalha hoje (dia fora da escala) ou sem horário/12x36
      let aindaNaoIniciou = 0; // data de início do ponto ainda não chegou
      for (const e of emps) {
        if (presentes.has(e.cpf)) continue;
        if (e.dataInicioPonto && hojeISO < e.dataInicioPonto) { aindaNaoIniciou++; continue; }
        if (dispensados.has(e.id)) { folgaHojeN++; continue; }
        const h = e.horarioContratualId ? horPorId.get(e.horarioContratualId) : undefined;
        if (!h || h.regime === 'r12x36' || !h.diasSemana.includes(dowHoje)) { semJornadaHoje++; continue; }
        const ent = h.pares[0]?.entrada;
        if (!ent) { semJornadaHoje++; continue; }
        const entradaMin = Number(ent.slice(0, 2)) * 60 + Number(ent.slice(2));
        if (minsAgora < entradaMin + GRACA_MIN) noPrazo++; // ainda dentro do horário
      }

      // Detalhamento de marcações por tipo (quantos bateram cada ponto do dia)
      const trabalhando = emps.filter((e) => {
        if (!e.horarioContratualId) return false;
        const h = horPorId.get(e.horarioContratualId);
        if (!h || !h.diasSemana.includes(dowHoje)) return false;
        if (dispensados.has(e.id)) return false;
        if (e.dataInicioPonto && hojeISO < e.dataInicioPonto) return false;
        return true;
      });
      const totalTrabalhando = trabalhando.length;

      // Contar marcações por funcionário hoje
      const marcsPorCpf = new Map<string, number>();
      for (const m of marcsHoje) {
        marcsPorCpf.set(m.cpf, (marcsPorCpf.get(m.cpf) ?? 0) + 1);
      }

      // Quantos têm ≥1 marcação (entrada), ≥2 (saída almoço), ≥3 (retorno), ≥4 (saída)
      let entradas = 0, saidasAlmoco = 0, retornos = 0, saidas = 0;
      for (const e of trabalhando) {
        const n = marcsPorCpf.get(e.cpf) ?? 0;
        const h = horPorId.get(e.horarioContratualId!);
        const jornadaDia = h?.jornadaPorDia?.[String(dowHoje)] ?? h?.durJornadaMin ?? 0;
        const nPares = jornadaDia > 0 && jornadaDia <= 360 && (h?.pares?.length ?? 0) > 1 ? 1 : (h?.pares?.length ?? 0);

        if (n >= 1) entradas++;
        if (nPares > 1) {
          // Jornada com almoço (4 batidas)
          if (n >= 2) saidasAlmoco++;
          if (n >= 3) retornos++;
          if (n >= 4) saidas++;
        } else {
          // Jornada sem almoço (2 batidas)
          if (n >= 2) saidas++;
        }
      }

      return {
        data: hojeISO,
        ativos: emps.length,
        presentes: presentes.size,
        ausentes: ausentes.length,
        listaAusentes: ausentes,
        marcacoesHoje: marcsHoje.length,
        ultimas,
        /** Detalhamento de marcações por tipo do dia. */
        marcacoesPorTipo: {
          total: totalTrabalhando,
          entradas,
          saidasAlmoco,
          retornos,
          saidas,
        },
        pendencias: {
          atestados: pendDocs.length,
          ajustes: ajustesPend.length,
          revisar: revisar.slice(0, 12),
          revisarTotal: revisar.length,
          naoBateram: naoBateram.slice(0, 12),
          naoBateramTotal: naoBateram.length,
          noPrazo,
          folgaHoje: folgaHojeN,
          semJornadaHoje,
          aindaNaoIniciou,
        },
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
