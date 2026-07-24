import { useState } from 'react';
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
      { to: '/rh/ajustes', rotulo: 'Ajustes de ponto' },
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

/**
 * Seletor de empresa. Só aparece para quem administra mais de um CNPJ —
 * quem cuida de uma empresa só não vê diferença nenhuma.
 */
function SeletorEmpresa() {
  const { sessao, empresas, trocarEmpresa } = useAuth();
  const [aberto, setAberto] = useState(false);
  const [trocando, setTrocando] = useState<string | null>(null);

  if (empresas.length < 2) return null;
  const atual = empresas.find((e) => e.tenantId === sessao?.tenantId) ?? empresas[0];

  const iniciais = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase() ?? '').join('');
  const fmtCnpj = (c: string) => c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');

  async function trocar(tenantId: string) {
    if (tenantId === sessao?.tenantId) { setAberto(false); return; }
    setTrocando(tenantId);
    try { await trocarEmpresa(tenantId); }
    catch { setTrocando(null); setAberto(false); }
  }

  return (
    <div className={css.selWrap}>
      <button className={css.selBtn} onClick={() => setAberto((a) => !a)}>
        <span className={css.selNome}>{atual?.razaoSocial ?? 'Empresa'}</span>
        <span className={css.selCnpj}>{atual ? fmtCnpj(atual.cnpj) : ''}</span>
        <span className={css.selSeta}>{aberto ? '▲' : '▼'}</span>
      </button>
      {aberto && (
        <>
          <div className={css.selFundo} onClick={() => setAberto(false)} />
          <div className={css.selDd}>
            <div className={css.selDdLb}>Trocar de empresa</div>
            {empresas.map((e) => (
              <button key={e.tenantId} className={`${css.selItem} ${e.tenantId === sessao?.tenantId ? css.selOn : ''}`}
                disabled={trocando != null} onClick={() => trocar(e.tenantId)}>
                <span className={css.selIni}>{iniciais(e.razaoSocial)}</span>
                <span className={css.selTxt}>
                  <span className={css.selItemNome}>{e.razaoSocial}</span>
                  <span className={css.selItemMeta}>{fmtCnpj(e.cnpj)} · {e.perfil === 'ADMIN_CLIENTE' ? 'Admin' : 'RH'}</span>
                </span>
                {trocando === e.tenantId ? <span className={css.selCheck}>…</span>
                  : e.tenantId === sessao?.tenantId ? <span className={css.selCheck}>✓</span> : null}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function LayoutRH() {
  const { sessao, sair } = useAuth();
  const navegar = useNavigate();

  return (
    <div className={css.app}>
      <aside className={css.side}>
        <div className={css.wm}>Ponto<span className={css.snap}>Snap</span></div>
        <SeletorEmpresa />
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
