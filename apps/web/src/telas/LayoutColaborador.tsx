import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { Flash } from '../components/Flash';
import css from './LayoutColaborador.module.css';

/** Casca das telas do funcionário: marca, navegação e a saída. */
export function LayoutColaborador() {
  const { sair } = useAuth();
  const navegar = useNavigate();
  const { pathname } = useLocation();
  const [menu, setMenu] = useState(false);
  const [temBanco, setTemBanco] = useState(false);

  // A aba de banco de horas só existe pra quem tem acordo. Mostrar uma aba
  // vazia seria pior do que não ter aba nenhuma.
  useEffect(() => {
    (async () => {
      try {
        const b = await api.get<{ ativo: boolean }>('/marcacao/meu-banco');
        setTemBanco(b.ativo);
      } catch { setTemBanco(false); }
    })();
  }, []);

  return (
    <div className={css.casca}>
      <header className={css.topo}>
        <button className={css.logo} onClick={() => navegar('/')} aria-label="Início">
          <Flash tamanho={20} cor="var(--coral)" />
          Ponto<b>Snap</b>
        </button>

        <div className={css.menuZona}>
          <button
            className={css.avatar} onClick={() => setMenu((v) => !v)}
            aria-haspopup="menu" aria-expanded={menu} aria-label="Minha conta"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="8" r="3.6" stroke="currentColor" strokeWidth="1.9" />
              <path d="M4.5 20a7.5 7.5 0 0115 0" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
            </svg>
          </button>

          {menu && (
            <>
              <div className={css.fundo} onClick={() => setMenu(false)} />
              <div className={css.menu} role="menu">
                <div className={css.menuNome}>Minha conta</div>
                <button role="menuitem" onClick={() => { setMenu(false); navegar('/'); }}>Bater ponto</button>
                <button role="menuitem" onClick={() => { setMenu(false); navegar('/espelho'); }}>Meu espelho</button>
                <button role="menuitem" onClick={() => { setMenu(false); navegar('/escala'); }}>Minha escala</button>
                <button role="menuitem" onClick={() => { setMenu(false); navegar('/atestados'); }}>Atestados</button>
                {temBanco && (
                  <button role="menuitem" onClick={() => { setMenu(false); navegar('/banco'); }}>Banco de horas</button>
                )}
                <button role="menuitem" onClick={() => { setMenu(false); navegar('/trocar-senha'); }}>Trocar minha senha</button>
                <button role="menuitem" className={css.sair} onClick={() => { sair(); navegar('/login', { replace: true }); }}>
                  Sair
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <main className={css.conteudo}>
        <Outlet />
      </main>

      <nav className={css.abas}>
        <button className={pathname === '/' ? css.on : ''} onClick={() => navegar('/')}>
          Bater ponto
        </button>
        <button className={pathname.startsWith('/espelho') ? css.on : ''} onClick={() => navegar('/espelho')}>
          Meu espelho
        </button>
        <button className={pathname === '/escala' ? css.on : ''} onClick={() => navegar('/escala')}>
          Escala
        </button>
        {temBanco && (
          <button className={pathname === '/banco' ? css.on : ''} onClick={() => navegar('/banco')}>
            Banco
          </button>
        )}
      </nav>
    </div>
  );
}
