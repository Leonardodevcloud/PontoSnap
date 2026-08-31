import { api } from './api';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(base64.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function pushSuportado(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function estadoPermissao(): NotificationPermission {
  if (!pushSuportado()) return 'denied';
  return Notification.permission;
}

export async function temSubscriptionAtiva(): Promise<boolean> {
  if (!pushSuportado()) return false;
  try {
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
    ]);
    const sub = await reg.pushManager.getSubscription();
    return sub !== null;
  } catch { return false; }
}

/**
 * Fluxo de ativação com timeout e tratamento de erro em cada etapa.
 * Retorna { ok, erro } pra que o componente mostre o motivo se falhar.
 */
export async function ativarNotificacoes(): Promise<{ ok: boolean; erro?: string }> {
  if (!pushSuportado()) return { ok: false, erro: 'Este navegador não suporta notificações.' };

  try {
    // 1. VAPID key
    const { key } = await api.get<{ key: string | null }>('/notificacao/vapid-key');
    if (!key) return { ok: false, erro: 'Servidor sem chave de push configurada.' };

    // 2. Permissão do navegador
    const perm = await Notification.requestPermission();
    if (perm === 'denied') return { ok: false, erro: 'Notificações bloqueadas no navegador. Ative nas configurações do site.' };
    if (perm !== 'granted') return { ok: false, erro: 'Permissão não concedida.' };

    // 3. Registrar no push manager (com timeout)
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
    ]);

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      });
    }

    // 4. Enviar pro backend
    const raw = sub.toJSON();
    await api.post('/notificacao/subscription', {
      endpoint: sub.endpoint,
      p256dh: raw.keys?.p256dh ?? '',
      auth: raw.keys?.auth ?? '',
      dispositivo: navigator.userAgent.slice(0, 200),
    });

    return { ok: true };
  } catch (e) {
    console.error('Push: erro na ativação', e);
    return { ok: false, erro: (e as Error).message || 'Erro ao ativar notificações.' };
  }
}

export async function desativarNotificacoes(): Promise<void> {
  if (!pushSuportado()) return;
  try {
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
    ]);
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      try { await api.del('/notificacao/subscription', { endpoint: sub.endpoint }); } catch { /* ok */ }
      await sub.unsubscribe();
    }
  } catch { /* ok */ }
}
