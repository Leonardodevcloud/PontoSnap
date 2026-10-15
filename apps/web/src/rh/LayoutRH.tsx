import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BannerCobranca } from './BannerCobranca';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { BotaoTema } from '../components/BotaoTema';
import { Icone, type NomeIcone } from '../components/Icone';
import { Avatar, ProvedorAvatares } from '../components/Avatar';
import type { Empregado, RespAtencao } from '../tipos';
import css from './LayoutRH.module.css';

/**
 * Menu do RH organizado pelo momento do trabalho: dia a dia → fechamento do
 * mês → cadastro de pessoas. O que se usa pouco fica recolhido em
 * Configurações. Telas irmãs (Espelhos/Apuração, Ajustes/Atestados,
 * Relatórios/Arquivos fiscais) viram um item só, com abas no topo.
 */
interface ItemMenu {
  to: string; rotulo: string; icone: NomeIcone; fim?: boolean; soAdmin?: boolean;
  /** Outras rotas que acendem este item. */
  tambem?: string[];
  /** De onde vem o número ao lado do item. */
  badge?: 'TOTAL' | 'PEDIDOS';
}
interface GrupoMenu { titulo: string | null; itens: ItemMenu[] }

const GRUPOS: GrupoMenu[] = [
  { titulo: null, itens: [{ to: '/rh', rotulo: 'Início', icone: 'inicio', fim: true, badge: 'TOTAL' }] },
  {
    titulo: 'Dia a dia',
    itens: [
      { to: '/rh/espelhos', rotulo: 'Ponto do mês', icone: 'calendario', tambem: ['/rh/apuracao', '/rh/batidas-faltando'] },
      { to: '/rh/ajustes', rotulo: 'Pedidos', icone: 'caixa', tambem: ['/rh/atestados'], badge: 'PEDIDOS' },
      { to: '/rh/afastamentos', rotulo: 'Férias e afastamentos', icone: 'sol' },
    ],
  },
  {
    titulo: 'Fechamento do mês',
    itens: [
      { to: '/rh/banco', rotulo: 'Banco de horas', icone: 'relogio' },
      { to: '/rh/pessoal', rotulo: 'Folha e benefícios', icone: 'dinheiro' },
      { to: '/rh/prestadores', rotulo: 'Notas de prestadores', icone: 'check' },
      { to: '/rh/relatorios', rotulo: 'Relatórios e arquivos', icone: 'documento', tambem: ['/rh/fiscal'] },
    ],
  },
  {
    titulo: 'Pessoas',
    itens: [
      { to: '/rh/funcionarios', rotulo: 'Funcionários', icone: 'pessoas' },
      { to: '/rh/comunicacao', rotulo: 'Comunicação interna', icone: 'megafone' },
      { to: '/rh/escalas', rotulo: 'Escalas', icone: 'grade' },
      { to: '/rh/regras', rotulo: 'Regras de cálculo', icone: 'ajustes' },
    ],
  },
];

const CONFIG: ItemMenu[] = [
  { to: '/rh/feriados', rotulo: 'Feriados', icone: 'calendario' },
  { to: '/rh/local', rotulo: 'Local e cerca', icone: 'inicio' },
  { to: '/rh/dispositivos', rotulo: 'Quiosques', icone: 'grade' },
  { to: '/rh/notificacoes', rotulo: 'Notificações do app', icone: 'sino' },
  { to: '/rh/auditoria', rotulo: 'Auditoria', icone: 'documento' },
  { to: '/rh/assinatura', rotulo: 'Plano e cobrança', icone: 'dinheiro', soAdmin: true },
];

/** Telas que dividem um item do menu: abas no topo. */
const SECOES: { rotas: { to: string; rotulo: string }[] }[] = [
  { rotas: [{ to: '/rh/espelhos', rotulo: 'Espelhos' }, { to: '/rh/apuracao', rotulo: 'Apuração CLT' }] },
  { rotas: [{ to: '/rh/ajustes', rotulo: 'Ajustes de ponto' }, { to: '/rh/atestados', rotulo: 'Atestados' }] },
  { rotas: [{ to: '/rh/relatorios', rotulo: 'Relatórios' }, { to: '/rh/fiscal', rotulo: 'Arquivos fiscais' }] },
];

/** Nome da tela atual (vira o h1 da página para leitor de tela e aba do navegador). */
const NOMES: Record<string, string> = {
  '/rh': 'Início', '/rh/espelhos': 'Ponto do mês · Espelhos', '/rh/apuracao': 'Ponto do mês · Apuração CLT',
  '/rh/batidas-faltando': 'Batidas faltando', '/rh/ajustes': 'Pedidos · Ajustes de ponto', '/rh/atestados': 'Pedidos · Atestados',
  '/rh/afastamentos': 'Férias e afastamentos', '/rh/banco': 'Banco de horas', '/rh/pessoal': 'Folha e benefícios', '/rh/prestadores': 'Notas de prestadores', '/rh/prestadores/conferir': 'Conferir notas',
  '/rh/relatorios': 'Relatórios', '/rh/fiscal': 'Arquivos fiscais', '/rh/funcionarios': 'Funcionários', '/rh/comunicacao': 'Comunicação interna', '/rh/comunicacao/novo': 'Novo comunicado', '/rh/escalas': 'Escalas',
  '/rh/regras': 'Regras de cálculo', '/rh/feriados': 'Feriados', '/rh/local': 'Local e cerca', '/rh/dispositivos': 'Quiosques',
  '/rh/auditoria': 'Auditoria', '/rh/notificacoes': 'Notificações do app', '/rh/assinatura': 'Plano e cobrança',
};

const NOME_PERFIL: Record<string, string> = {
  RH: 'RH', ADMIN_CLIENTE: 'Administrador', MASTER: 'Master',
};

/** Contexto que o Início usa para atualizar o número do menu depois de resolver algo. */
export interface ContextoRH { atencao: RespAtencao | null; recarregarAtencao: () => Promise<void> }

const ativo = (pathname: string, i: ItemMenu) =>
  (i.fim ? pathname === i.to || pathname === `${i.to}/` : pathname === i.to || pathname.startsWith(`${i.to}/`))
  || (i.tambem ?? []).some((t) => pathname === t || pathname.startsWith(`${t}/`));

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
      <button className={css.selBtn} onClick={() => setAberto((a) => !a)} title={atual?.razaoSocial} aria-expanded={aberto}>
        <span className={css.selTexto}>
          <span className={css.selNome}>{atual?.razaoSocial ?? 'Empresa'}</span>
          <span className={css.selCnpj}>{atual ? fmtCnpj(atual.cnpj) : ''}</span>
        </span>
        <span className={css.selSeta} aria-hidden="true">{aberto ? '▲' : '▼'}</span>
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

/** Busca rápida (Ctrl K): telas do menu e funcionários. */
function Busca({ aberta, onFechar }: { aberta: boolean; onFechar: () => void }) {
  const navegar = useNavigate();
  const { sessao } = useAuth();
  const [q, setQ] = useState('');
  const [emps, setEmps] = useState<Empregado[] | null>(null);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!aberta) return;
    setQ(''); setSel(0);
    setTimeout(() => input.current?.focus(), 20);
    if (!emps) api.get<Empregado[]>('/empregados').then(setEmps).catch(() => setEmps([]));
  }, [aberta, emps]);

  const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const telas = useMemo(() => [
    ...GRUPOS.flatMap((g) => g.itens), ...CONFIG.filter((i) => !i.soAdmin || sessao?.perfil === 'ADMIN_CLIENTE'),
    ...SECOES.flatMap((s) => s.rotas.map((r) => ({ ...r, icone: 'documento' as NomeIcone }))),
  ].filter((t, i, a) => a.findIndex((x) => x.rotulo === t.rotulo) === i), [sessao?.perfil]);

  const termo = sem(q.trim());
  const resultados = [
    ...telas.filter((t) => !termo || sem(t.rotulo).includes(termo)).slice(0, termo ? 6 : 8)
      .map((t) => ({ chave: `t${t.to}${t.rotulo}`, rotulo: t.rotulo, meta: 'tela', icone: t.icone, ir: t.to, empId: undefined as string | undefined })),
    ...(termo ? (emps ?? []).filter((e) => e.ativo !== false && (sem(e.nome).includes(termo) || (e.matricula ?? '').includes(termo) || e.cpf.includes(termo.replace(/\D/g, '') || '§')))
      .slice(0, 6).map((e) => ({ chave: `e${e.id}`, rotulo: e.nome, meta: 'ponto do mês', icone: 'pessoas' as NomeIcone, ir: `/rh/espelhos?emp=${e.id}`, empId: e.id as string | undefined })) : []),
  ];

  function escolher(i: number) {
    const r = resultados[i];
    if (!r) return;
    onFechar();
    navegar(r.ir);
  }

  if (!aberta) return null;
  return (
    <>
      <div className={css.buscaVeu} onClick={onFechar} />
      <div className={css.busca} role="dialog" aria-modal="true" aria-label="Buscar pessoa ou tela">
        <div className={css.buscaCampo}>
          <Icone nome="busca" />
          <input ref={input} value={q} aria-label="Buscar pessoa ou tela" placeholder="Nome, matrícula ou tela (ex.: banco)"
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onFechar();
              else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, resultados.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); escolher(sel); }
            }} />
          <kbd>Esc</kbd>
        </div>
        <ul className={css.buscaLista} role="listbox" aria-label="Resultados">
          {resultados.length === 0 && <li className={css.buscaVazio}>Nada encontrado para “{q}”.</li>}
          {resultados.map((r, i) => (
            <li key={r.chave} role="option" aria-selected={i === sel}>
              <button className={`${css.buscaItem} ${i === sel ? css.buscaSel : ''}`} onMouseEnter={() => setSel(i)} onClick={() => escolher(i)}>
                {r.empId ? <Avatar id={r.empId} nome={r.rotulo} tamanho={26} /> : <Icone nome={r.icone} />}<span>{r.rotulo}</span><small>{r.meta}</small>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/** Telas com tabela de todos os funcionários: usam a largura inteira. */
const LARGAS = ['/rh/apuracao', '/rh/espelhos', '/rh/banco', '/rh/pessoal', '/rh/prestadores'];

export function LayoutRH() {
  const { sessao, sair, empresas } = useAuth();
  const navegar = useNavigate();
  const rota = useLocation();
  const empresaAtual = empresas.find((e) => e.tenantId === sessao?.tenantId)?.razaoSocial ?? '';
  const [atencao, setAtencao] = useState<RespAtencao | null>(null);
  const [busca, setBusca] = useState(false);
  const [mais, setMais] = useState(false);
  const noConfig = CONFIG.some((i) => ativo(rota.pathname, i));
  const [config, setConfig] = useState(noConfig);

  const recarregarAtencao = useCallback(async () => {
    try { setAtencao(await api.get<RespAtencao>('/atencao')); } catch { /* o menu funciona sem o número */ }
  }, []);
  useEffect(() => { void recarregarAtencao(); const t = setInterval(() => void recarregarAtencao(), 5 * 60_000); return () => clearInterval(t); }, [recarregarAtencao]);
  useEffect(() => { if (noConfig) setConfig(true); }, [noConfig]);
  useEffect(() => { setMais(false); }, [rota.pathname]);
  useEffect(() => {
    const nome = NOMES[rota.pathname.replace(/\/$/, '') || '/rh'];
    document.title = nome ? `${nome} · PontoSnap` : 'PontoSnap';
  }, [rota.pathname]);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setBusca((b) => !b); }
    };
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, []);

  const pedidos = (atencao?.itens ?? []).filter((i) => i.tipo === 'ATESTADO' || i.tipo === 'AJUSTE').reduce((a, i) => a + i.qtd, 0);
  const badge = (i: ItemMenu) => (i.badge === 'TOTAL' ? atencao?.totais.total ?? 0 : i.badge === 'PEDIDOS' ? pedidos : 0);
  const secao = SECOES.find((s) => s.rotas.some((r) => rota.pathname === r.to));
  const nomeTela = NOMES[rota.pathname.replace(/\/$/, '') || '/rh'] ?? 'PontoSnap';
  const perfil = sessao?.perfil;

  const link = (i: ItemMenu, compacto = false) => {
    const n = badge(i);
    const on = ativo(rota.pathname, i);
    return (
      <NavLink key={i.to} to={i.to} end={i.fim} aria-current={on ? 'page' : undefined}
        className={`${css.link} ${on ? css.on : ''} ${compacto ? css.linkSub : ''}`}>
        {!compacto && <Icone nome={i.icone} className={css.ic} />}
        <span className={css.rot}>{i.rotulo}</span>
        {n > 0 && <span className={css.bdg} aria-label={`${n} pendências`}>{n}</span>}
      </NavLink>
    );
  };

  const navegacao = (
    <nav className={css.nav} aria-label="Menu principal">
      {GRUPOS.map((g) => (
        <div key={g.titulo ?? 'topo'} className={css.grupo}>
          {g.titulo && <div className={css.grupoTit}>{g.titulo}</div>}
          {g.itens.filter((i) => !i.soAdmin || perfil === 'ADMIN_CLIENTE').map((i) => link(i))}
        </div>
      ))}
      <div className={css.grupo}>
        <button className={`${css.link} ${css.cfgBtn}`} onClick={() => setConfig((c) => !c)} aria-expanded={config} aria-controls="menu-config">
          <Icone nome="engrenagem" className={css.ic} /><span className={css.rot}>Configurações</span>
          <span className={`${css.cfgSeta} ${config ? css.cfgSetaOn : ''}`} aria-hidden="true"><Icone nome="seta" tamanho={14} /></span>
        </button>
        {config && (
          <div id="menu-config" className={css.sub}>
            {CONFIG.filter((i) => !i.soAdmin || perfil === 'ADMIN_CLIENTE').map((i) => link(i, true))}
          </div>
        )}
      </div>
    </nav>
  );

  const rodape = (
    <div className={css.foot}>
      <div className={css.av} aria-hidden="true">{(NOME_PERFIL[perfil ?? ''] ?? 'U').slice(0, 2).toUpperCase()}</div>
      <div className={css.who}>
        <strong>{NOME_PERFIL[perfil ?? ''] ?? 'Usuário'}</strong>
        {empresaAtual && <span>{empresaAtual}</span>}
      </div>
      <BotaoTema className={css.tema} />
      <button className={css.sair} onClick={() => { sair(); navegar('/login', { replace: true }); }}>
        <Icone nome="sair" tamanho={16} />Sair
      </button>
    </div>
  );

  const contexto: ContextoRH = { atencao, recarregarAtencao };

  return (
    <ProvedorAvatares>
    <div className={css.app}>
      <a href="#conteudo" className={css.pular}>Pular para o conteúdo</a>
      <aside className={css.side}>
        <div className={css.wm}>Ponto<span className={css.snap}>Snap</span></div>
        <SeletorEmpresa />
        <button className={css.buscaBtn} onClick={() => setBusca(true)}>
          <Icone nome="busca" tamanho={16} /><span>Buscar</span><kbd>Ctrl K</kbd>
        </button>
        {navegacao}
        {rodape}
      </aside>

      {/* Celular: barra de cima */}
      <header className={css.topoMob}>
        <Link to="/rh" className={css.wmMob}>Ponto<span className={css.snap}>Snap</span></Link>
        <button className={css.iconeMob} onClick={() => setBusca(true)} aria-label="Buscar pessoa ou tela"><Icone nome="busca" tamanho={20} /></button>
      </header>

      <main id="conteudo" tabIndex={-1} className={`${css.content} ${LARGAS.some((r) => rota.pathname.startsWith(r)) ? css.contentLarga : ''}`}>
        <h1 className={css.somenteLeitor}>{nomeTela}</h1>
        {perfil === 'ADMIN_CLIENTE' && <BannerCobranca />}
        {secao && (
          <div className={css.abas} role="tablist" aria-label="Seção">
            {secao.rotas.map((r) => (
              <Link key={r.to} role="tab" aria-selected={rota.pathname === r.to}
                to={{ pathname: r.to, search: r.to === '/rh/espelhos' || r.to === '/rh/apuracao' ? rota.search : '' }}
                className={`${css.aba} ${rota.pathname === r.to ? css.abaOn : ''}`}>{r.rotulo}</Link>
            ))}
          </div>
        )}
        <Outlet context={contexto} />
      </main>

      {/* Celular: barra de baixo */}
      <nav className={css.barraMob} aria-label="Atalhos">
        {[
          { to: '/rh', rotulo: 'Início', icone: 'inicio' as NomeIcone, fim: true, badge: 'TOTAL' as const },
          { to: '/rh/espelhos', rotulo: 'Ponto', icone: 'calendario' as NomeIcone, tambem: ['/rh/apuracao', '/rh/batidas-faltando'] },
          { to: '/rh/ajustes', rotulo: 'Pedidos', icone: 'caixa' as NomeIcone, tambem: ['/rh/atestados'], badge: 'PEDIDOS' as const },
          { to: '/rh/funcionarios', rotulo: 'Pessoas', icone: 'pessoas' as NomeIcone },
        ].map((i) => {
          const n = badge(i); const on = ativo(rota.pathname, i);
          return (
            <NavLink key={i.to} to={i.to} end={i.fim} className={`${css.mobItem} ${on ? css.mobOn : ''}`} aria-current={on ? 'page' : undefined}>
              <span className={css.mobIc}><Icone nome={i.icone} tamanho={22} />{n > 0 && <span className={css.mobBdg}>{n}</span>}</span>
              {i.rotulo}
            </NavLink>
          );
        })}
        <button className={`${css.mobItem} ${mais ? css.mobOn : ''}`} onClick={() => setMais(true)} aria-expanded={mais}>
          <span className={css.mobIc}><Icone nome="mais" tamanho={22} /></span>Mais
        </button>
      </nav>

      {mais && (
        <>
          <div className={css.maisVeu} onClick={() => setMais(false)} />
          <div className={css.mais} role="dialog" aria-modal="true" aria-label="Menu">
            <div className={css.maisTopo}>
              <div className={css.wm}>Ponto<span className={css.snap}>Snap</span></div>
              <button className={css.maisX} onClick={() => setMais(false)} aria-label="Fechar menu"><Icone nome="x" /></button>
            </div>
            <SeletorEmpresa />
            {navegacao}
            {rodape}
          </div>
        </>
      )}

      <Busca aberta={busca} onFechar={() => setBusca(false)} />
    </div>
    </ProvedorAvatares>
  );
}
