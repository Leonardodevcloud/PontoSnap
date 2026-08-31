import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import webpush from 'web-push';
import { pushSubscription, notificacaoPreferencia, comTenant, type Db } from '@ponto/db';
import { DB } from '../database/database.module';

export interface Notificacao {
  titulo: string;
  corpo: string;
  /** URL pra onde o clique na notificação leva (relativo ao app, ex.: /espelho). */
  url?: string;
  /** Identificador único pra coalescer (ex.: 'esqueceu-entrada-2026-08-31'). */
  tag?: string;
}

/**
 * Tipo de preferência. Usado pra checar se o empregado quer receber antes de disparar.
 * 'sempre' = ignora preferências (ex.: comunicação crítica do sistema).
 */
export type TipoNotificacao =
  | 'lembreteAntes' | 'esqueceuEntrada' | 'esqueceuAlmoco' | 'esqueceuSaida'
  | 'ajusteRespondido' | 'atestadoAnalisado' | 'espelhoDisponivel'
  | 'resumoSemanal' | 'bancoVencendo' | 'sempre';

@Injectable()
export class PushService {
  private readonly log = new Logger(PushService.name);
  private configurado = false;

  constructor(@Inject(DB) private readonly db: Db) {
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    if (pub && priv) {
      webpush.setVapidDetails('mailto:contato@pontosnap.app.br', pub, priv);
      this.configurado = true;
      this.log.log('Web Push configurado (VAPID ok)');
    } else {
      this.log.warn('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY não definidas — push desativado');
    }
  }

  /** Chave pública VAPID que o frontend precisa pra fazer PushManager.subscribe(). */
  get vapidPublicKey(): string | null {
    return process.env.VAPID_PUBLIC_KEY ?? null;
  }

  /**
   * Envia uma notificação pra um empregado (todos os dispositivos dele),
   * respeitando a preferência se o `tipo` não for 'sempre'.
   */
  async enviarParaEmpregado(
    tenantId: string,
    empregadoId: string,
    usuarioId: string,
    tipo: TipoNotificacao,
    notif: Notificacao,
  ): Promise<number> {
    if (!this.configurado) return 0;

    // Checar preferência (se não for 'sempre')
    if (tipo !== 'sempre') {
      const ok = await this.empregadoQuer(tenantId, empregadoId, tipo);
      if (!ok) return 0;
    }

    return this.enviarParaUsuario(tenantId, usuarioId, notif);
  }

  /** Envia direto pra um usuário (todos os dispositivos), sem checar preferência. */
  async enviarParaUsuario(tenantId: string, usuarioId: string, notif: Notificacao): Promise<number> {
    if (!this.configurado) return 0;

    const subs = await comTenant(this.db, tenantId, (tx) =>
      tx.select().from(pushSubscription)
        .where(and(eq(pushSubscription.tenantId, tenantId), eq(pushSubscription.usuarioId, usuarioId))),
    );

    let enviados = 0;
    const payload = JSON.stringify({
      title: notif.titulo,
      body: notif.corpo,
      url: notif.url ?? '/',
      tag: notif.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    });

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 3600 },
        );
        enviados++;
      } catch (err: any) {
        // 404/410 = subscription expirou ou foi revogada pelo navegador
        if (err.statusCode === 404 || err.statusCode === 410) {
          this.log.debug(`Subscription expirada (${err.statusCode}), removendo: ${sub.id}`);
          await this.db.delete(pushSubscription).where(eq(pushSubscription.id, sub.id));
        } else {
          this.log.error(`Erro ao enviar push ${sub.id}: ${err.message}`);
        }
      }
    }
    return enviados;
  }

  /** Verifica se o empregado quer receber determinado tipo de notificação. */
  private async empregadoQuer(tenantId: string, empregadoId: string, tipo: TipoNotificacao): Promise<boolean> {
    const pref = await comTenant(this.db, tenantId, (tx) =>
      tx.select().from(notificacaoPreferencia)
        .where(eq(notificacaoPreferencia.empregadoId, empregadoId)).limit(1),
    );
    if (pref.length === 0) return true; // sem preferência salva → usa defaults (tudo ativo)
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
