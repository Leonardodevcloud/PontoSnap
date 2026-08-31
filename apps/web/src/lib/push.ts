import { api } from './api';

/** Converte a chave VAPID base64url pra Uint8Array (formato que PushManager.subscribe espera). */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(base64.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/** Checa se push é suportado neste navegador. */
export function pushSuportado(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** Estado atual da permissão. */
export function estadoPermissao(): NotificationPermission {
  if (!pushSuportado()) return 'denied';
  return Notification.permission;
}

/** Já pediu e já tem subscription ativa? */
export async function temSubscriptionAtiva(): Promise<boolean> {
  if (!pushSuportado()) return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub !== null;
}

/**
 * Fluxo completo de ativação:
 * 1. Busca VAPID public key do backend
 * 2. Pede permissão ao navegador (Notification.requestPermission)
 * 3. Faz PushManager.subscribe()
 * 4. Envia a subscription pro backend
 *
 * Retorna true se tudo deu certo, false se o usuário negou ou algo falhou.
 */
export async function ativarNotificacoes(): Promise<boolean> {
  if (!pushSuportado()) return false;

  // 1. VAPID key
  const { key } = await api.get<{ key: string | null }>('/notificacao/vapid-key');
  if (!key) {
    console.warn('Push: servidor sem VAPID key');
    return false;
  }

  // 2. Permissão
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return false;

  // 3. Subscribe
  const reg = await navigator.serviceWorker.ready;
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

  return true;
}

/** Remove subscription do navegador e do backend. */
export async function desativarNotificacoes(): Promise<void> {
  if (!pushSuportado()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await api.del('/notificacao/subscription', { endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
}
