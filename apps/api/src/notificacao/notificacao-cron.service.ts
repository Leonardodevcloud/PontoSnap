import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, eq, gte, inArray, lt, lte } from 'drizzle-orm';
import {
  empregado, usuario, pontoHorarioContratual, pontoMarcacao, notificacaoPreferencia, pushSubscription,
  pontoFeriado, pontoAfastamento, pontoAusencia, pontoEscala, tenant, comoMaster, type Db,
} from '@ponto/db';
import { feriadoValePara, localEfetivo } from '@ponto/shared';
import { DB } from '../database/database.module';
import { PushService } from './push.service';
import { agendaDoMomento } from './agenda';

/** Hora local do cliente a partir do fuso "-0300". */
function agoraLocal(fuso: string) {
  const sinal = fuso.startsWith('-') ? -1 : 1;
  const offMin = sinal * (Number(fuso.slice(1, 3)) * 60 + Number(fuso.slice(3, 5) || 0));
  const d = new Date(Date.now() + offMin * 60_000);
  return { min: d.getUTCHours() * 60 + d.getUTCMinutes(), hoje: d.toISOString().slice(0, 10), dow: d.getUTCDay(), offMin };
}

/**
 * Lembretes e "esqueceu de bater?" automáticos.
 *
 * Roda a cada 2 minutos. Só olha quem tem notificação ativa em algum aparelho.
 * Não manda nada em feriado, folga/ausência, férias/afastamento, dia fora da
 * escala, antes da data de início do ponto, nem para contrato de horas (sem
 * horário fixo). A deduplicação fica no PushService (chave por usuário e dia).
 */
@Injectable()
export class NotificacaoCronService implements OnModuleInit {
  private readonly log = new Logger(NotificacaoCronService.name);
  private rodando = false;

  constructor(@Inject(DB) private readonly db: Db, private readonly push: PushService) {}

  onModuleInit() {
    if (process.env.NOTIF_CRON === 'off') return;
    if (!this.push.ativo) { this.log.warn('Cron de notificações parado: push sem chaves VAPID.'); return; }
    setInterval(() => void this.tick(), 120_000);
    setTimeout(() => void this.tick(), 10_000);
    this.log.log('Cron de notificações ativo (intervalo: 2 min)');
  }

  async tick() {
    if (this.rodando) return; // tick anterior ainda rodando
    this.rodando = true;
    try {
      const tenants = await comoMaster(this.db, (tx) => tx.select({ id: tenant.id, fuso: tenant.fuso }).from(tenant));
      for (const t of tenants) {
        try { await this.tickTenant(t.id, t.fuso ?? '-0300'); }
        catch (e) { this.log.error(`Notificações do cliente ${t.id}: ${(e as Error).message}`); }
      }
    } finally { this.rodando = false; }
  }

  async tickTenant(tenantId: string, fuso: string, agoraFixo?: { min: number; hoje: string; dow: number; offMin: number }) {
    const { min: agora, hoje, dow, offMin } = agoraFixo ?? agoraLocal(fuso);

    const dados = await comoMaster(this.db, async (tx) => {
      // Só quem tem aparelho com notificação ativa.
      const comPush = await tx.selectDistinct({ usuarioId: pushSubscription.usuarioId }).from(pushSubscription).where(eq(pushSubscription.tenantId, tenantId));
      if (comPush.length === 0) return null;
      // Feriados de hoje (com região): cada pessoa só folga no da cidade dela.
      const feriadosHoje = await tx.select({ tipo: pontoFeriado.tipo, uf: pontoFeriado.uf, municipio: pontoFeriado.municipio }).from(pontoFeriado)
        .where(and(eq(pontoFeriado.tenantId, tenantId), eq(pontoFeriado.data, hoje)));
      const locEmp = (await tx.select({ uf: tenant.trabalhoUf, m: tenant.trabalhoMunicipio }).from(tenant).where(eq(tenant.id, tenantId)).limit(1))[0];
      const us = await tx.select({ id: usuario.id, empregadoId: usuario.empregadoId }).from(usuario)
        .where(and(eq(usuario.tenantId, tenantId), eq(usuario.ativo, true), inArray(usuario.id, comPush.map((c) => c.usuarioId))));
      const empIds = us.map((u) => u.empregadoId).filter((x): x is string => !!x);
      if (empIds.length === 0) return null;
      const emps = await tx.select({
        id: empregado.id, cpf: empregado.cpf, horarioId: empregado.horarioContratualId, inicio: empregado.dataInicioPonto,
        uf: empregado.trabalhoUf, municipio: empregado.trabalhoMunicipio,
      }).from(empregado).where(and(eq(empregado.tenantId, tenantId), eq(empregado.ativo, true), inArray(empregado.id, empIds)));
      const horIds = [...new Set(emps.map((e) => e.horarioId).filter((x): x is string => !!x))];
      const hors = horIds.length ? await tx.select().from(pontoHorarioContratual).where(inArray(pontoHorarioContratual.id, horIds)) : [];
      const afast = await tx.select({ e: pontoAfastamento.empregadoId }).from(pontoAfastamento)
        .where(and(eq(pontoAfastamento.tenantId, tenantId), lte(pontoAfastamento.dataInicio, hoje), gte(pontoAfastamento.dataFim, hoje)));
      const aus = await tx.select({ e: pontoAusencia.empregadoId }).from(pontoAusencia)
        .where(and(eq(pontoAusencia.tenantId, tenantId), eq(pontoAusencia.data, hoje)));
      const escala = await tx.select({ e: pontoEscala.empregadoId }).from(pontoEscala)
        .where(and(eq(pontoEscala.tenantId, tenantId), eq(pontoEscala.data, hoje)));
      const prefs = await tx.select().from(notificacaoPreferencia).where(eq(notificacaoPreferencia.tenantId, tenantId));
      // Batidas de hoje (dia local).
      const ini = new Date(Date.parse(`${hoje}T00:00:00Z`) - offMin * 60_000);
      const fim = new Date(ini.getTime() + 86_400_000);
      const marcs = await tx.select({ cpf: pontoMarcacao.cpf }).from(pontoMarcacao)
        .where(and(eq(pontoMarcacao.tenantId, tenantId), gte(pontoMarcacao.dtMarcacao, ini), lt(pontoMarcacao.dtMarcacao, fim)));
      return { feriadosHoje, locEmp, us, emps, hors, afast, aus, escala, prefs, marcs };
    });
    if (!dados) return { enviados: 0 };
    const localEmpresa = dados.locEmp?.m ? { uf: dados.locEmp.uf, municipioIbge: dados.locEmp.m } : null;
    const folgaFeriado = (e: { uf: string | null; municipio: number | null }) => {
      const local = localEfetivo(e.municipio ? { uf: e.uf, municipioIbge: e.municipio } : null, localEmpresa);
      return dados.feriadosHoje.some((f) => feriadoValePara({ tipo: f.tipo, uf: f.uf, municipioIbge: f.municipio }, local));
    };

    const horPorId = new Map(dados.hors.map((h) => [h.id, h]));
    const usuarioDe = new Map(dados.us.filter((u) => u.empregadoId).map((u) => [u.empregadoId!, u.id]));
    const fora = new Set([...dados.afast.map((a) => a.e), ...dados.aus.map((a) => a.e)]);
    const temEscalaHoje = new Set(dados.escala.map((x) => x.e));
    const prefPor = new Map(dados.prefs.map((p) => [p.empregadoId, p]));
    const batidas = new Map<string, number>();
    for (const m of dados.marcs) batidas.set(m.cpf, (batidas.get(m.cpf) ?? 0) + 1);

    let enviados = 0;
    for (const e of dados.emps) {
      if (fora.has(e.id) || (e.inicio && e.inicio > hoje) || !e.horarioId || folgaFeriado(e)) continue;
      const h = horPorId.get(e.horarioId);
      if (!h) continue;
      const trabalhaHoje = h.regime === 'r12x36' ? temEscalaHoje.has(e.id) : h.diasSemana.includes(dow);
      if (!trabalhaHoje) continue;
      const p = prefPor.get(e.id);
      const envios = agendaDoMomento({
        pares: h.pares, flexivel: h.flexivel, marcacoes: batidas.get(e.cpf) ?? 0,
        jornadaDiaMin: (h.jornadaPorDia as Record<string, number> | null)?.[String(dow)] ?? null,
        lembreteAntes: p?.lembreteAntes ?? true, lembreteMinutos: p?.lembreteMinutos ?? 10,
      }, agora, hoje);
      const usuarioId = usuarioDe.get(e.id)!;
      for (const v of envios) {
        enviados += await this.push.enviarParaEmpregado(tenantId, e.id, usuarioId, v.tipo, { titulo: v.titulo, corpo: v.corpo, url: v.url, tag: v.chave });
      }
    }

    // Resumo semanal: sexta a partir das 18h (a chave do dia impede repetir).
    if (dow === 5 && agora >= 18 * 60 && agora <= 20 * 60) {
      for (const [empId, usuarioId] of usuarioDe) {
        enviados += await this.push.enviarParaEmpregado(tenantId, empId, usuarioId, 'resumoSemanal', {
          titulo: 'Sua semana em números',
          corpo: 'Confira seu espelho para ver as horas trabalhadas e o saldo da semana. Bom fim de semana!',
          url: '/espelho', tag: `resumo-semanal-${hoje}`,
        });
      }
    }
    return { enviados };
  }
}
