import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, eq, gte, lt } from 'drizzle-orm';
import {
  empregado, usuario, pontoHorarioContratual, pontoMarcacao, notificacaoPreferencia,
  tenant, comoMaster, type Db,
} from '@ponto/db';
import { DB } from '../database/database.module';
import { PushService, type TipoNotificacao } from './push.service';

/** Horário no fuso, HH:MM → minutos desde meia-noite. */
function hmParaMin(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
function agoraMin(fuso: string): number {
  const off = Number(fuso) / 100; // "-0300" → -3
  const agora = new Date(Date.now() + off * 3600_000);
  return agora.getUTCHours() * 60 + agora.getUTCMinutes();
}
function hojeISO(fuso: string): string {
  const off = Number(fuso) / 100;
  return new Date(Date.now() + off * 3600_000).toISOString().slice(0, 10);
}
function diaSemana(fuso: string): number {
  const off = Number(fuso) / 100;
  return new Date(Date.now() + off * 3600_000).getUTCDay();
}

interface EmpComHorario {
  empId: string;
  usuarioId: string;
  tenantId: string;
  fuso: string;
  nome: string;
  pares: Array<{ entrada: string; saida: string }>;
  diasSemana: number[];
}

@Injectable()
export class NotificacaoCronService implements OnModuleInit {
  private readonly log = new Logger(NotificacaoCronService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly push: PushService,
  ) {}

  onModuleInit() {
    if (process.env.NOTIF_CRON === 'off') return;
    // Checa a cada 2 minutos
    setInterval(() => void this.tick().catch((e) => this.log.error(e.message)), 120_000);
    // Checa 10s depois do boot
    setTimeout(() => void this.tick().catch((e) => this.log.error(e.message)), 10_000);
    this.log.log('Cron de notificações ativo (intervalo: 2 min)');
  }

  private async tick() {
    const tenants = await comoMaster(this.db, (tx) =>
      tx.select({ id: tenant.id, fuso: tenant.fuso }).from(tenant),
    );
    for (const t of tenants) {
      const fuso = t.fuso ?? '-0300';
      const agora = agoraMin(fuso);
      const hoje = hojeISO(fuso);
      const dow = diaSemana(fuso);

      const emps = await this.listarEmpregadosComHorario(t.id, dow);

      for (const e of emps) {
        await this.checarLembretes(e, agora, fuso);
        await this.checarEsquecimentos(e, agora, hoje, fuso);
      }

      // Resumo semanal: sexta entre 17:58-18:02
      if (dow === 5 && agora >= 1078 && agora <= 1082) {
        await this.enviarResumoSemanal(t.id, fuso);
      }
    }
  }

  /** Lista empregados ativos com horário contratual, filtrando pelo dia da semana. */
  private async listarEmpregadosComHorario(tenantId: string, dow: number): Promise<EmpComHorario[]> {
    return comoMaster(this.db, async (tx) => {
      const rows = await tx.select({
        empId: empregado.id,
        nome: empregado.nome,
        tenantId: empregado.tenantId,
        horarioContratualId: empregado.horarioContratualId,
      }).from(empregado)
        .where(and(eq(empregado.tenantId, tenantId), eq(empregado.ativo, true)));

      const resultado: EmpComHorario[] = [];
      for (const r of rows) {
        if (!r.horarioContratualId) continue;

        const hc = (await tx.select().from(pontoHorarioContratual)
          .where(eq(pontoHorarioContratual.id, r.horarioContratualId)).limit(1))[0];
        if (!hc) continue;
        if (!hc.diasSemana.includes(dow)) continue;

        // Buscar usuarioId vinculado a este empregado
        const u = (await tx.select({ id: usuario.id }).from(usuario)
          .where(and(eq(usuario.empregadoId, r.empId), eq(usuario.tenantId, tenantId))).limit(1))[0];
        if (!u) continue;

        resultado.push({
          empId: r.empId,
          usuarioId: u.id,
          tenantId,
          fuso: '-0300',
          nome: r.nome,
          pares: hc.pares,
          diasSemana: hc.diasSemana,
        });
      }
      return resultado;
    });
  }

  // ── LEMBRETES (X min antes de cada marcação prevista) ──

  private async checarLembretes(e: EmpComHorario, agora: number, fuso: string) {
    // Buscar preferência de minutos
    const pref = await this.buscarPref(e.tenantId, e.empId);
    if (!pref.lembreteAntes) return;
    const antesMin = pref.lembreteMinutos;

    const etiquetas: Array<{ horario: string; tipo: string }> = [];
    for (let i = 0; i < e.pares.length; i++) {
      const p = e.pares[i]!;
      etiquetas.push({ horario: p.entrada, tipo: i === 0 ? 'entrada' : 'volta do almoço' });
      etiquetas.push({ horario: p.saida, tipo: i === 0 ? 'saída pro almoço' : 'saída' });
    }

    for (const et of etiquetas) {
      const alvo = hmParaMin(et.horario);
      const diff = alvo - agora;
      // Janela: entre [antesMin-1, antesMin+1] pra compensar o intervalo do cron
      if (diff >= antesMin - 1 && diff <= antesMin + 1) {
        const textos = this.textoLembrete(et.tipo, et.horario);
        await this.push.enviarParaEmpregado(e.tenantId, e.empId, e.usuarioId, 'lembreteAntes', {
          titulo: textos.titulo,
          corpo: textos.corpo,
          url: '/',
          tag: `lembrete-${et.tipo}-${hojeISO(fuso)}`,
        });
      }
    }
  }

  private textoLembrete(tipo: string, horario: string): { titulo: string; corpo: string } {
    switch (tipo) {
      case 'entrada':
        return { titulo: 'Hora de bater o ponto', corpo: `Sua entrada é às ${horario}. Toque pra abrir o app.` };
      case 'volta do almoço':
        return { titulo: 'Almoço terminando', corpo: `Sua volta é às ${horario}. Não esquece de bater.` };
      case 'saída':
        return { titulo: 'Quase na hora de sair', corpo: `Sua saída é às ${horario}. Bata o ponto antes de ir.` };
      default:
        return { titulo: 'Lembrete de ponto', corpo: `Marcação prevista às ${horario}.` };
    }
  }

  // ── ESQUECIMENTOS (detecta batida faltante) ──

  private async checarEsquecimentos(e: EmpComHorario, agora: number, hoje: string, fuso: string) {
    if (e.pares.length === 0) return;

    // Buscar marcações de hoje
    const marcacoes = await this.marcacoesHoje(e.tenantId, e.empId, hoje, fuso);
    const totalEsperado = e.pares.length * 2; // cada par tem entrada + saída

    // Montar lista de horários esperados em ordem
    const esperados: Array<{ min: number; tipo: TipoNotificacao; nome: string }> = [];
    for (let i = 0; i < e.pares.length; i++) {
      const p = e.pares[i]!;
      esperados.push({
        min: hmParaMin(p.entrada),
        tipo: i === 0 ? 'esqueceuEntrada' : 'esqueceuAlmoco',
        nome: i === 0 ? 'entrada' : 'volta do almoço',
      });
      esperados.push({
        min: hmParaMin(p.saida),
        tipo: i === e.pares.length - 1 ? 'esqueceuSaida' : 'esqueceuAlmoco',
        nome: i === e.pares.length - 1 ? 'saída' : 'saída pro almoço',
      });
    }

    // Pra cada marcação esperada que já deveria ter acontecido (15 min de tolerância),
    // verificar se existe a marcação correspondente
    for (let idx = 0; idx < esperados.length; idx++) {
      const esp = esperados[idx]!;
      const atraso = agora - esp.min;
      // Janela: entre 14 e 20 min depois (notifica uma vez nessa janela)
      if (atraso < 14 || atraso > 20) continue;
      // Se tem marcações suficientes pra essa posição, ok
      if (marcacoes >= idx + 1) continue;

      const textos = this.textoEsquecimento(esp.nome, esp.min);
      await this.push.enviarParaEmpregado(e.tenantId, e.empId, e.usuarioId, esp.tipo, {
        titulo: textos.titulo,
        corpo: textos.corpo,
        url: '/',
        tag: `esqueceu-${esp.nome}-${hoje}`,
      });
    }
  }

  private textoEsquecimento(tipo: string, minutosEsperado: number): { titulo: string; corpo: string } {
    const h = String(Math.floor(minutosEsperado / 60)).padStart(2, '0');
    const m = String(minutosEsperado % 60).padStart(2, '0');
    const horario = `${h}:${m}`;
    switch (tipo) {
      case 'entrada':
        return { titulo: 'Sua jornada começou', corpo: `Faz um tempo que o expediente iniciou e ainda não tem marcação. Esqueceu?` };
      case 'volta do almoço':
        return { titulo: 'Voltou do almoço?', corpo: `Sua volta era às ${horario} e a marcação ainda não apareceu.` };
      case 'saída':
        return { titulo: 'Esqueceu a saída?', corpo: `Seu expediente encerrou às ${horario} e falta a marcação de saída.` };
      default:
        return { titulo: 'Marcação pendente', corpo: `A marcação das ${horario} ainda não apareceu.` };
    }
  }

  /** Conta marcações de hoje pra um empregado (via CPF + timestamp do dia). */
  private async marcacoesHoje(tenantId: string, empregadoId: string, hoje: string, fuso: string): Promise<number> {
    return comoMaster(this.db, async (tx) => {
      // Buscar CPF do empregado
      const emp = (await tx.select({ cpf: empregado.cpf }).from(empregado)
        .where(eq(empregado.id, empregadoId)).limit(1))[0];
      if (!emp) return 0;

      // Calcular início e fim do dia no fuso
      const offH = Number(fuso) / 100; // "-0300" → -3
      const inicioUtc = new Date(`${hoje}T00:00:00Z`);
      inicioUtc.setUTCHours(inicioUtc.getUTCHours() - offH);
      const fimUtc = new Date(inicioUtc.getTime() + 86_400_000);

      const rows = await tx.select({ id: pontoMarcacao.id }).from(pontoMarcacao)
        .where(and(
          eq(pontoMarcacao.tenantId, tenantId),
          eq(pontoMarcacao.cpf, emp.cpf),
          gte(pontoMarcacao.dtMarcacao, inicioUtc),
          lt(pontoMarcacao.dtMarcacao, fimUtc),
        ));
      return rows.length;
    });
  }

  // ── RESUMO SEMANAL (toda sexta 18h) ──

  private async enviarResumoSemanal(tenantId: string, _fuso: string) {
    // Simplificado: envia mensagem genérica. O saldo real requer apuração completa
    // que é pesada — em versão futura, pré-calcular no job de apuração noturna.
    const emps = await comoMaster(this.db, async (tx) => {
      const rows = await tx.select({
        empId: empregado.id,
        nome: empregado.nome,
      }).from(empregado)
        .where(and(eq(empregado.tenantId, tenantId), eq(empregado.ativo, true)));

      const result: Array<{ empId: string; usuarioId: string }> = [];
      for (const r of rows) {
        const u = (await tx.select({ id: usuario.id }).from(usuario)
          .where(and(eq(usuario.empregadoId, r.empId), eq(usuario.tenantId, tenantId))).limit(1))[0];
        if (u) result.push({ empId: r.empId, usuarioId: u.id });
      }
      return result;
    });

    for (const e of emps) {
      await this.push.enviarParaEmpregado(tenantId, e.empId, e.usuarioId, 'resumoSemanal', {
        titulo: 'Sua semana em números',
        corpo: 'Confira seu espelho pra ver as horas trabalhadas e o saldo da semana. Bom fim de semana!',
        url: '/espelho',
        tag: `resumo-semanal-${hojeISO('-0300')}`,
      });
    }
  }

  // ── HELPER: buscar preferências ──

  private async buscarPref(tenantId: string, empregadoId: string) {
    const rows = await comoMaster(this.db, (tx) =>
      tx.select().from(notificacaoPreferencia)
        .where(eq(notificacaoPreferencia.empregadoId, empregadoId)).limit(1),
    );
    if (rows.length === 0) {
      return {
        lembreteAntes: true, lembreteMinutos: 10,
        esqueceuEntrada: true, esqueceuAlmoco: true, esqueceuSaida: true,
        resumoSemanal: false,
      };
    }
    const p = rows[0]!;
    return {
      lembreteAntes: p.lembreteAntes,
      lembreteMinutos: p.lembreteMinutos,
      esqueceuEntrada: p.esqueceuEntrada,
      esqueceuAlmoco: p.esqueceuAlmoco,
      esqueceuSaida: p.esqueceuSaida,
      resumoSemanal: p.resumoSemanal,
    };
  }
}
