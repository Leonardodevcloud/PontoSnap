import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { BannerCobranca } from './BannerCobranca';
import { useAuth } from '../lib/auth';
import css from './LayoutRH.module.css';

const GRUPOS: { titulo: string; itens: { to: string; rotulo: string; fim?: boolean; soAdmin?: boolean }[] }[] = [
  {
    titulo: 'Operação',
    itens: [
      { to: '/rh', rotulo: 'Painel', fim: true },
      { to: '/rh/espelhos', rotulo: 'Espelhos' },
      { to: '/rh/apuracao', rotulo: 'Apuração CLT' },
      { to: '/rh/atestados', rotulo: 'Atestados' },
      { to: '/rh/banco', rotulo: 'Banco de horas' },
      { to: '/rh/afastamentos', rotulo: 'Férias e afastamentos' },
    ],
  },
  {
    titulo: 'Cadastro',
    itens: [
      { to: '/rh/funcionarios', rotulo: 'Funcionários' },
      { to: '/rh/escalas', rotulo: 'Escalas' },
      { to: '/rh/regras', rotulo: 'Regras de jornada' },
      { to: '/rh/convencoes', rotulo: 'Convenções' },
      { to: '/rh/feriados', rotulo: 'Feriados' },
      { to: '/rh/local', rotulo: 'Local' },
    ],
  },
  {
    titulo: 'Documentos',
    itens: [
      { to: '/rh/relatorios', rotulo: 'Relatórios' },
      { to: '/rh/fiscal', rotulo: 'Arquivos fiscais' },
      { to: '/rh/certificado', rotulo: 'Certificado' },
    ],
  },
  {
    titulo: 'Sistema',
    itens: [
      { to: '/rh/auditoria', rotulo: 'Auditoria' },
      { to: '/rh/dispositivos', rotulo: 'Quiosques' },
      { to: '/rh/assinatura', rotulo: 'Assinatura', soAdmin: true },
    ],
  },
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
          {GRUPOS.map((g) => {
            const itens = g.itens.filter((i) => !i.soAdmin || sessao?.perfil === 'ADMIN_CLIENTE');
            if (itens.length === 0) return null;
            return (
              <div key={g.titulo} className={css.grupo}>
                <div className={css.grupoTit}>{g.titulo}</div>
                {itens.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.fim}
                    className={({ isActive }) => `${css.link} ${isActive ? css.on : ''}`}>
                    <span className={css.ic} />{i.rotulo}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className={css.foot}>
          <div className={css.who}>{NOME_PERFIL[sessao?.perfil ?? ''] ?? 'Usuário'}</div>
          <button className={css.sair} onClick={() => { sair(); navegar('/login', { replace: true }); }}>sair →</button>
        </div>
      </aside>
      <main className={css.content}>
        {sessao?.perfil === 'ADMIN_CLIENTE' && <BannerCobranca />}
        <Outlet />
      </main>
    </div>
  );
}
