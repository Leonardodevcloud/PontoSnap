import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { App } from './App';
import './styles/global.css';

// ── Registrar SW com auto-reload ao detectar atualização ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready.then((reg) => {
    // Checa por atualização a cada 60s (o browser checa a cada 24h por padrão)
    setInterval(() => reg.update(), 60_000);
  });
  // Se o SW novo assumiu o controle (skipWaiting + clientsClaim), recarrega a página
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
