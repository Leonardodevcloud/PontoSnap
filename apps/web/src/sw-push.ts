/// <reference lib="webworker" />
// @ts-expect-error — workbox-precaching é injetado pelo vite-plugin-pwa em build time
import { precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

// Workbox precache (gerado pelo vite-plugin-pwa)
precacheAndRoute(self.__WB_MANIFEST);

// ── Push: receber e mostrar notificação ──
self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const dados = event.data.json() as {
      title: string; body: string; url?: string; tag?: string;
      icon?: string; badge?: string;
    };
    event.waitUntil(
      self.registration.showNotification(dados.title, {
        body: dados.body,
        icon: dados.icon ?? '/icon-192.png',
        badge: dados.badge ?? '/icon-192.png',
        tag: dados.tag,
        data: { url: dados.url ?? '/' },
      }),
    );
  } catch {
    event.waitUntil(
      self.registration.showNotification('PontoSnap', { body: event.data!.text() }),
    );
  }
});

// ── Clique na notificação: abrir o app na URL certa ──
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data?.url as string) ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientes) => {
      for (const c of clientes) {
        if (new URL(c.url).origin === self.location.origin) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
