// sw-push.js — handler de push notifications (registrado separadamente do workbox SW)
// Este arquivo é servido estático pelo Vercel e registrado manualmente no main.tsx.

self.addEventListener('push', function(event) {
  if (!event.data) return;
  try {
    var dados = event.data.json();
    event.waitUntil(
      self.registration.showNotification(dados.title || 'PontoSnap', {
        body: dados.body || '',
        icon: dados.icon || '/icon-192.png',
        badge: dados.badge || '/icon-192.png',
        tag: dados.tag || undefined,
        data: { url: dados.url || '/' },
      })
    );
  } catch(e) {
    event.waitUntil(
      self.registration.showNotification('PontoSnap', { body: event.data.text() })
    );
  }
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientes) {
      for (var i = 0; i < clientes.length; i++) {
        if (new URL(clientes[i].url).origin === self.location.origin) {
          clientes[i].navigate(url);
          return clientes[i].focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
