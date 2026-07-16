import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import css from './LayoutRH.module.css';

const ITENS = [
  { to: '/rh', rotulo: 'Painel', fim: true },
  { to: '/rh/funcionarios', rotulo: 'Funcionários' },
  { to: '/rh/escalas', rotulo: 'Escalas' },
  { to: '/rh/espelhos', rotulo: 'Espelhos' },
  { to: '/rh/apuracao', rotulo: 'Apuração CLT' },
  { to: '/rh/relatorios', rotulo: 'Relatórios' },
  { to: '/rh/feriados', rotulo: 'Feriados' },
  { to: '/rh/fiscal', rotulo: 'Arquivos fiscais' },
  { to: '/rh/local', rotulo: 'Local' },
  { to: '/rh/certificado', rotulo: 'Certificado' },
  { to: '/rh/dispositivos', rotulo: 'Quiosques' },
];

const NOME_PERFIL: Record<string, string> = {
  RH: 'RH', ADMIN_CLIENTE: 'Administrador', MASTER: 'Master',
};

export function LayoutRH() {
  const { sessao, sair } = useAuth();
  const navegar = useNavigate();

  return (
    <div className={css.app}>
      <aside className={css.side}>
        <div className={css.wm}>Ponto<span className={css.snap}>Snap</span></div>
        <nav className={css.nav}>
          {ITENS.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.fim}
              className={({ isActive }) => `${css.link} ${isActive ? css.on : ''}`}>
              <span className={css.ic} />{i.rotulo}
            </NavLink>
          ))}
        </nav>
        <div className={css.foot}>
          <div className={css.who}>{NOME_PERFIL[sessao?.perfil ?? ''] ?? 'Usuário'}</div>
          <button className={css.sair} onClick={() => { sair(); navegar('/login', { replace: true }); }}>sair →</button>
        </div>
      </aside>
      <main className={css.content}>
        <Outlet />
      </main>
    </div>
  );
}
