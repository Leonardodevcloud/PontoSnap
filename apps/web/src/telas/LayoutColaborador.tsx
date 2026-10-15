import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { Flash } from '../components/Flash';
import { BotaoTema } from '../components/BotaoTema';
import { PromptInstalar } from '../components/PromptInstalar';
import { NotificacaoPrompt } from './NotificacaoPrompt';
import { AtualizacaoCadastral, type MeuCadastro } from './AtualizacaoCadastral';
import css from './LayoutColaborador.module.css';
import cssAv from './Avisos.module.css';

interface ResumoAvisos { naoLidos: number; pendentesCiencia: number; primeiroPendente: { id: string; titulo: string } | null }

/** Casca das telas do funcionário: marca, navegação e a saída. */
export function LayoutColaborador() {
  const { sair } = useAuth();
  const navegar = useNavigate();
  const { pathname } = useLocation();
  const [menu, setMenu] = useState(false);
  const [temBanco, setTemBanco] = useState(false);
  // Atualização cadastral: sem foto válida, o app não libera o ponto.
  const [meu, setMeu] = useState<MeuCadastro | null | 'erro'>(null);
  const [trocarFoto, setTrocarFoto] = useState(false);
  useEffect(() => {
    api.get<MeuCadastro>('/cadastro/meu').then(setMeu).catch(() => setMeu('erro'));
  }, []);

  // Avisos do RH: bolinha na aba e faixa na tela de bater ponto (não bloqueia a batida).
  const [avisos, setAvisos] = useState<ResumoAvisos | null>(null);
  useEffect(() => {
    const buscar = () => { api.get<ResumoAvisos>('/comunicacao/meus/resumo').then(setAvisos).catch(() => {}); };
    buscar();
    window.addEventListener('pontosnap:avisos', buscar);
    const vis = () => { if (document.visibilityState === 'visible') buscar(); };
    document.addEventListener('visibilitychange', vis);
    return () => { window.removeEventListener('pontosnap:avisos', buscar); document.removeEventListener('visibilitychange', vis); };
  }, [pathname]);

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

  if (meu === null) return <div className={css.casca} aria-busy="true" />;
  if (meu !== 'erro' && (meu.precisaAtualizar || trocarFoto)) {
    return <AtualizacaoCadastral meu={meu} modo={meu.precisaAtualizar ? 'obrigatorio' : 'trocar'}
      onConcluir={(m) => { setMeu(m); setTrocarFoto(false); }} onCancelar={() => setTrocarFoto(false)} />;
  }
  const foto = meu !== 'erro' ? meu.foto?.miniatura : undefined;

  return (
    <div className={css.casca}>
      <header className={css.topo}>
        <button className={css.logo} onClick={() => navegar('/')} aria-label="Início">
          <Flash tamanho={20} cor="var(--coral)" />
          <span>Ponto<b>Snap</b></span>
        </button>

        <div className={css.menuZona}>
          <button
            className={css.avatar} onClick={() => setMenu((v) => !v)}
            aria-haspopup="menu" aria-expanded={menu} aria-label="Minha conta"
          >
            {foto ? <img src={foto} alt="" className={css.avatarFoto} /> : (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="8" r="3.6" stroke="currentColor" strokeWidth="1.9" />
                <path d="M4.5 20a7.5 7.5 0 0115 0" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
              </svg>
            )}
          </button>

          {menu && (
            <>
              <div className={css.fundo} onClick={() => setMenu(false)} />
              <div className={css.menu} role="menu">
                <div className={css.menuNome}>{meu !== 'erro' ? meu.nome : 'Minha conta'}</div>
                <button role="menuitem" onClick={() => { setMenu(false); navegar('/'); }}>Bater ponto</button>
                <button role="menuitem" onClick={() => { setMenu(false); navegar('/espelho'); }}>Meu espelho</button>
                <button role="menuitem" onClick={() => { setMenu(false); navegar('/escala'); }}>Minha escala</button>
                <button role="menuitem" onClick={() => { setMenu(false); navegar('/atestados'); }}>Atestados</button>
                <button role="menuitem" onClick={() => { setMenu(false); navegar('/avisos'); }}>Avisos do RH{avisos?.naoLidos ? ` (${avisos.naoLidos})` : ''}</button>
                {temBanco && (
                  <button role="menuitem" onClick={() => { setMenu(false); navegar('/banco'); }}>Banco de horas</button>
                )}
                {meu !== 'erro' && <button role="menuitem" onClick={() => { setMenu(false); setTrocarFoto(true); }}>Minha foto e dados</button>}
                <button role="menuitem" onClick={() => { setMenu(false); navegar('/trocar-senha'); }}>Trocar minha senha</button>
                <button role="menuitem" onClick={() => { setMenu(false); navegar('/notificacoes'); }}>Notificações</button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px' }}>
                  <BotaoTema /> <span style={{ fontSize: 13, color: 'var(--ash)' }}>Tema</span>
                </div>
                <button role="menuitem" className={css.sair} onClick={() => { sair(); navegar('/login', { replace: true }); }}>
                  Sair
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <div className={css.instalarZona}>
        <PromptInstalar />
        <NotificacaoPrompt />
      </div>

      <main className={css.conteudo}>
        {pathname === '/' && avisos?.primeiroPendente && (
          <div className={css.faixaZona}>
            <button type="button" className={cssAv.faixa} onClick={() => navegar(`/avisos/${avisos.primeiroPendente!.id}`)}>
              <span aria-hidden="true">📢</span>
              <span><b>{avisos.pendentesCiencia === 1 ? 'Um aviso do RH pede sua ciência' : `${avisos.pendentesCiencia} avisos do RH pedem sua ciência`}</b><small>{avisos.primeiroPendente.titulo}</small></span>
              <span className={cssAv.go}>Ver</span>
            </button>
          </div>
        )}
        <Outlet />
      </main>

      <nav className={css.abas}>
        <button className={pathname === '/' ? css.on : ''} onClick={() => navegar('/')}>
          Bater
        </button>
        <button className={pathname.startsWith('/espelho') ? css.on : ''} onClick={() => navegar('/espelho')}>
          Espelho
        </button>
        <button className={pathname === '/escala' ? css.on : ''} onClick={() => navegar('/escala')}>
          Escala
        </button>
        <button className={pathname === '/atestados' ? css.on : ''} onClick={() => navegar('/atestados')}>
          Atestados
        </button>
        <button className={`${pathname.startsWith('/avisos') ? css.on : ''} ${css.comBolinha}`} onClick={() => navegar('/avisos')}
          aria-label={avisos?.naoLidos ? `Avisos, ${avisos.naoLidos} não ${avisos.naoLidos === 1 ? 'lido' : 'lidos'}` : 'Avisos'}>
          Avisos{avisos && avisos.naoLidos > 0 && <span className={css.bolinha} aria-hidden="true">{avisos.naoLidos > 9 ? '9+' : avisos.naoLidos}</span>}
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
