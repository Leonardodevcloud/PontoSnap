import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import webpush from 'web-push';
import { pushSubscription, notificacaoPreferencia, notificacaoEnvio, comTenant, type Db } from '@ponto/db';
import { DB } from '../database/database.module';

export interface Notificacao {
  titulo: string;
  corpo: string;
  /** URL pra onde o clique na notificação leva (relativo ao app, ex.: /espelho). */
  url?: string;
  /**
   * Identificador único da notificação (ex.: 'esqueceu-entrada-2026-08-31').
   * Também é a chave de deduplicação: a mesma tag não sai duas vezes para o
   * mesmo usuário (o cron roda a cada 2 min e pode ter mais de uma instância).
   */
  tag?: string;
}

/**
 * Tipo de preferência. Usado pra checar se o empregado quer receber antes de disparar.
 * 'sempre' = ignora preferências (ex.: comunicação crítica do sistema).
 */
export type TipoNotificacao =
  | 'lembreteAntes' | 'esqueceuEntrada' | 'esqueceuAlmoco' | 'esqueceuSaida'
  | 'ajusteRespondido' | 'atestadoAnalisado' | 'espelhoDisponivel'
  | 'resumoSemanal' | 'bancoVencendo' | 'sempre' | 'teste' | 'comunicado';

export interface ResultadoEnvio { dispositivos: number; entregues: number; duplicada: boolean }

@Injectable()
export class PushService {
  private readonly log = new Logger(PushService.name);
  private configurado = false;

  constructor(@Inject(DB) private readonly db: Db) {
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    if (pub && priv) {
      try {
        webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'mailto:contato@pontosnap.app.br', pub, priv);
        this.configurado = true;
        this.log.log('Web Push configurado (VAPID ok)');
      } catch (e) {
        this.log.error(`Chaves VAPID inválidas — push desativado: ${(e as Error).message}`);
      }
    } else {
      this.log.warn('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY não definidas — push desativado');
    }
  }

  /** O servidor consegue mandar push (chaves VAPID válidas)? */
  get ativo(): boolean { return this.configurado; }

  /** Chave pública VAPID que o frontend precisa pra fazer PushManager.subscribe(). */
  get vapidPublicKey(): string | null {
    return this.configurado ? process.env.VAPID_PUBLIC_KEY ?? null : null;
  }

  /**
   * Envia uma notificação pra um empregado (todos os dispositivos dele),
   * respeitando a preferência se o `tipo` não for 'sempre'. Retorna quantos
   * aparelhos aceitaram.
   */
  async enviarParaEmpregado(
    tenantId: string, empregadoId: string, usuarioId: string, tipo: TipoNotificacao, notif: Notificacao,
  ): Promise<number> {
    if (!this.configurado) return 0;
    if (tipo !== 'sempre' && tipo !== 'teste' && tipo !== 'comunicado') {
      const ok = await this.empregadoQuer(tenantId, empregadoId, tipo);
      if (!ok) return 0;
    }
    return (await this.enviar(tenantId, usuarioId, empregadoId, tipo, notif)).entregues;
  }

  /** Envia direto pra um usuário (todos os dispositivos), sem checar preferência. */
  async enviarParaUsuario(tenantId: string, usuarioId: string, notif: Notificacao): Promise<number> {
    if (!this.configurado) return 0;
    return (await this.enviar(tenantId, usuarioId, null, 'sempre', notif)).entregues;
  }

  /**
   * Envio com registro: reserva a chave (tag) antes de mandar. Se a chave já
   * existe para o usuário, não manda de novo. Guarda quantos aparelhos
   * aceitaram e o erro, para o painel do RH.
   */
  async enviar(tenantId: string, usuarioId: string, empregadoId: string | null, tipo: TipoNotificacao, notif: Notificacao): Promise<ResultadoEnvio> {
    if (!this.configurado) return { dispositivos: 0, entregues: 0, duplicada: false };
    const chave = (notif.tag ?? `${tipo}-${Date.now()}`).slice(0, 160);

    const { reservaId, subs } = await comTenant(this.db, tenantId, async (tx) => {
      const r = await tx.insert(notificacaoEnvio).values({
        tenantId, usuarioId, empregadoId, tipo, chave, titulo: notif.titulo.slice(0, 160),
      }).onConflictDoNothing().returning({ id: notificacaoEnvio.id });
      if (r.length === 0) return { reservaId: null, subs: [] };
      const subs = await tx.select().from(pushSubscription)
        .where(and(eq(pushSubscription.tenantId, tenantId), eq(pushSubscription.usuarioId, usuarioId)));
      return { reservaId: r[0]!.id, subs };
    });
    if (!reservaId) return { dispositivos: 0, entregues: 0, duplicada: true };

    const payload = JSON.stringify({
      title: notif.titulo, body: notif.corpo, url: notif.url ?? '/', tag: notif.tag,
      icon: '/icon-192.png', badge: '/icon-192.png',
    });

    let entregues = 0;
    let ultimoErro: string | null = subs.length === 0 ? 'nenhum aparelho com notificação ativa' : null;
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload, { TTL: 3600, urgency: 'high' },
        );
        entregues++;
        await comTenant(this.db, tenantId, (tx) => tx.update(pushSubscription)
          .set({ ultimoSucessoEm: new Date(), ultimoErro: null, ultimoErroEm: null }).where(eq(pushSubscription.id, sub.id)));
      } catch (err) {
        const e = err as { statusCode?: number; message?: string };
        if (e.statusCode === 404 || e.statusCode === 410) {
          // O navegador revogou a inscrição (app desinstalado, permissão tirada, dados limpos).
          ultimoErro = 'aparelho desinscrito (o navegador cancelou a permissão)';
          await comTenant(this.db, tenantId, (tx) => tx.delete(pushSubscription).where(eq(pushSubscription.id, sub.id)));
        } else {
          ultimoErro = `${e.statusCode ?? 'falha'}: ${(e.message ?? '').slice(0, 150)}`;
          this.log.error(`Erro ao enviar push ${sub.id}: ${ultimoErro}`);
          await comTenant(this.db, tenantId, (tx) => tx.update(pushSubscription)
            .set({ ultimoErro, ultimoErroEm: new Date() }).where(eq(pushSubscription.id, sub.id)));
        }
      }
    }
    await comTenant(this.db, tenantId, (tx) => tx.update(notificacaoEnvio)
      .set({ dispositivos: subs.length, entregues, erro: entregues > 0 ? null : ultimoErro })
      .where(eq(notificacaoEnvio.id, reservaId)));
    return { dispositivos: subs.length, entregues, duplicada: false };
  }

  /** Verifica se o empregado quer receber determinado tipo de notificação. */
  private async empregadoQuer(tenantId: string, empregadoId: string, tipo: TipoNotificacao): Promise<boolean> {
    const pref = await comTenant(this.db, tenantId, (tx) =>
      tx.select().from(notificacaoPreferencia)
        .where(eq(notificacaoPreferencia.empregadoId, empregadoId)).limit(1),
    );
    if (pref.length === 0) return tipo !== 'resumoSemanal'; // sem preferência salva → padrões (resumo semanal vem desligado)
    const p = pref[0]!;
    const mapa: Record<string, boolean> = {
      lembreteAntes: p.lembreteAntes,
      esqueceuEntrada: p.esqueceuEntrada,
      esqueceuAlmoco: p.esqueceuAlmoco,
      esqueceuSaida: p.esqueceuSaida,
      ajusteRespondido: p.ajusteRespondido,
      atestadoAnalisado: p.atestadoAnalisado,
      espelhoDisponivel: p.espelhoDisponivel,
      resumoSemanal: p.resumoSemanal,
      bancoVencendo: p.bancoVencendo,
    };
    return mapa[tipo] ?? true;
  }
}
