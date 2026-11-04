import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { pontoAusencia, pontoAfastamento, empregado, comTenant, type Db } from '@ponto/db';
import { DB } from '../database/database.module';
import { reabrirCompetencia } from '../banco/fechamento';
import { AjusteService } from './ajuste.service';

/** Folga do AEJ (registro 07, código 4): o dia é descanso, não falta. */
const TIPO_FOLGA = 4;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const competenciaDe = (data: string) => data.slice(0, 7);

/**
 * Folga CONCEDIDA pelo RH: o funcionário não trabalha naquele dia e o dia NÃO
 * vira falta, mas também NÃO sai do banco de horas.
 *
 * Caso típico: a convenção manda dar uma folga a quem trabalhou no feriado
 * (além de pagar o feriado). Diferente da folga compensatória do banco
 * (BancoService.registrarFolga), que debita a jornada do saldo.
 *
 * Na apuração entra pelo mesmo cano da folga do banco (ausência tipo 4 = dia
 * de descanso): sem jornada esperada, sem falta, sem DSR perdido, e o dia sai
 * dos dias previstos (VR/VT por dia não são devidos nele).
 */
@Injectable()
export class FolgaService {
  constructor(@Inject(DB) private readonly db: Db, private readonly ajustes: AjusteService) {}

  async criar(tenantId: string, usuarioId: string, d: { empregadoId: string; data: string; motivo?: string | null; feriadoRef?: string | null }) {
    if (!DATA.test(d.data)) throw new BadRequestException('Data inválida (use AAAA-MM-DD).');
    if (d.feriadoRef && !DATA.test(d.feriadoRef)) throw new BadRequestException('Data do feriado inválida.');
    const motivo = d.motivo?.trim() || null;
    if (!d.feriadoRef && !motivo) throw new BadRequestException('Diga o motivo da folga (ou a data do feriado trabalhado).');

    // Com batida no dia, ele trabalhou: folga ali transformaria as horas em extra de dia de descanso.
    const dia = await this.ajustes.batidasDoDia(tenantId, d.empregadoId, d.data);
    if (dia.batidas.length) {
      throw new BadRequestException(`${d.data.split('-').reverse().join('/')} tem ${dia.batidas.length} ${dia.batidas.length === 1 ? 'batida' : 'batidas'}: ele trabalhou nesse dia. Escolha o dia em que ele folgou.`);
    }

    return comTenant(this.db, tenantId, async (tx) => {
      const e = (await tx.select({ id: empregado.id }).from(empregado)
        .where(and(eq(empregado.id, d.empregadoId), eq(empregado.tenantId, tenantId))).limit(1))[0];
      if (!e) throw new NotFoundException('Funcionário não encontrado');

      const ja = (await tx.select({ origem: pontoAusencia.origem }).from(pontoAusencia).where(and(
        eq(pontoAusencia.tenantId, tenantId), eq(pontoAusencia.empregadoId, d.empregadoId),
        eq(pontoAusencia.data, d.data), eq(pontoAusencia.tipo, TIPO_FOLGA))).limit(1))[0];
      if (ja) throw new BadRequestException(ja.origem === 'CONCEDIDA' ? 'Já existe uma folga lançada nesse dia.' : 'Esse dia já é folga compensatória do banco de horas.');

      const afast = (await tx.select({ tipo: pontoAfastamento.tipo }).from(pontoAfastamento).where(and(
        eq(pontoAfastamento.tenantId, tenantId), eq(pontoAfastamento.empregadoId, d.empregadoId),
        lte(pontoAfastamento.dataInicio, d.data), gte(pontoAfastamento.dataFim, d.data))).limit(1))[0];
      if (afast) throw new BadRequestException('Nesse dia ele já está de férias/afastado: não precisa de folga.');

      const [f] = await tx.insert(pontoAusencia).values({
        tenantId, empregadoId: d.empregadoId, tipo: TIPO_FOLGA, data: d.data,
        origem: 'CONCEDIDA', motivo, feriadoRef: d.feriadoRef ?? null, criadoPor: usuarioId,
      }).returning();
      // Mês do banco já fechado: refaz, porque o dia deixou de ser falta.
      await reabrirCompetencia(tx as never, tenantId, d.empregadoId, competenciaDe(d.data));
      return f!;
    });
  }

  /** Folgas concedidas (mais recentes primeiro), por funcionário e/ou período. */
  async listar(tenantId: string, f: { empregadoId?: string; de?: string; ate?: string }) {
    return comTenant(this.db, tenantId, async (tx) => {
      const conds = [eq(pontoAusencia.tenantId, tenantId), eq(pontoAusencia.tipo, TIPO_FOLGA), eq(pontoAusencia.origem, 'CONCEDIDA')];
      if (f.empregadoId) conds.push(eq(pontoAusencia.empregadoId, f.empregadoId));
      if (f.de && DATA.test(f.de)) conds.push(gte(pontoAusencia.data, f.de));
      if (f.ate && DATA.test(f.ate)) conds.push(lte(pontoAusencia.data, f.ate));
      const rows = await tx.select({
        id: pontoAusencia.id, empregadoId: pontoAusencia.empregadoId, nome: empregado.nome, data: pontoAusencia.data,
        motivo: pontoAusencia.motivo, feriadoRef: pontoAusencia.feriadoRef, criadoEm: pontoAusencia.criadoEm,
      }).from(pontoAusencia).innerJoin(empregado, eq(empregado.id, pontoAusencia.empregadoId))
        .where(and(...conds)).orderBy(asc(pontoAusencia.data));
      return rows.reverse().map((r) => ({ ...r, criadoEm: r.criadoEm.toISOString() }));
    });
  }

  /** Lançou errado: apaga e o dia volta a ser apurado normalmente. */
  async remover(tenantId: string, id: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const [f] = await tx.delete(pontoAusencia).where(and(
        eq(pontoAusencia.id, id), eq(pontoAusencia.tenantId, tenantId), eq(pontoAusencia.origem, 'CONCEDIDA'))).returning();
      if (!f) throw new NotFoundException('Folga não encontrada');
      await reabrirCompetencia(tx as never, tenantId, f.empregadoId, competenciaDe(f.data));
      return { removido: true };
    });
  }
}
