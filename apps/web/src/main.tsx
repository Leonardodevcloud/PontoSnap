import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { App } from './App';
import './styles/global.css';

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
