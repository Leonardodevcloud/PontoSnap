import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import css from './LayoutMaster.module.css';

export function LayoutMaster() {
  const { sair } = useAuth();
  const navegar = useNavigate();
  return (
    <div className={css.app}>
      <aside className={css.side}>
        <div className={css.wm}>Ponto<span className={css.snap}>Snap</span></div>
        <div className={css.console}>console master</div>
        <nav className={css.nav}>
          <NavLink to="/master" end className={({ isActive }) => `${css.link} ${isActive ? css.on : ''}`}>
            <span className={css.ic} />Clientes
          </NavLink>
          <NavLink to="/master/cobranca" className={({ isActive }) => `${css.link} ${isActive ? css.on : ''}`}>
            <span className={css.ic} />Cobrança
          </NavLink>
          <NavLink to="/master/acessos" className={({ isActive }) => `${css.link} ${isActive ? css.on : ''}`}>
            <span className={css.ic} />Acessos
          </NavLink>
        </nav>
        <div className={css.foot}>
          <div className={css.who}>Master<small>plataforma</small></div>
          <button className={css.sair} onClick={() => { sair(); navegar('/login', { replace: true }); }}>sair →</button>
        </div>
      </aside>
      <main className={css.content}><Outlet /></main>
    </div>
  );
}
