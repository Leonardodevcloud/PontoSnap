import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { App } from './App';
import './styles/global.css';

// ── Tema: aplicar ANTES do render pra evitar flash ──
const temaInicial = localStorage.getItem('pontosnap.tema') === 'dark' ? 'dark' : 'light';
document.documentElement.setAttribute('data-theme', temaInicial);

// ── Service worker: auto-update check ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready.then((reg) => {
    setInterval(() => reg.update(), 60_000);
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
