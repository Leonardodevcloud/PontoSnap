import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { App } from './App';
import './styles/global.css';

// ── Registrar SW com auto-reload ao detectar atualização ──
if ('serviceWorker' in navigator) {
  // Registrar o SW de push separado (o workbox SW é registrado pelo vite-plugin-pwa)
  navigator.serviceWorker.register('/sw-push.js').catch(() => {});

  navigator.serviceWorker.ready.then((reg) => {
    setInterval(() => reg.update(), 60_000);
  });
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
