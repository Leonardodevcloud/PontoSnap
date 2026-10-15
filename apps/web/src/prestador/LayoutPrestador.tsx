import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { api } from '../lib/api';
import type { Eu } from '../lib/prestador';
import { Flash } from '../components/Flash';
import { Caricatura, hash } from '../components/Avatar';
import { PromptInstalar } from '../components/PromptInstalar';
import { NotificacaoPrompt } from '../telas/NotificacaoPrompt';
import { AtualizacaoCadastral, type MeuCadastro } from '../telas/AtualizacaoCadastral';
import css from '../telas/LayoutColaborador.module.css';

interface Ctx { eu: Eu | null; erro: string | null; recarregar: () => Promise<void>; foto: string | null; trocarFoto: () => void }
/** Dados do prestador para as telas filhas (carregados uma vez pelo layout). */
export const usePrestador = () => useOutletContext<Ctx>();

/**
 * Casca do app do prestador (MEI/motorista): sem bater ponto. Abas: Início
 * (valor do mês e a nota), Notas (histórico), Avisos (comunicação interna) e Menu.
 */
export function LayoutPrestador() {
  const navegar = useNavigate();
  const { pathname } = useLocation();
  const [eu, setEu] = useState<Eu | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [naoLidos, setNaoLidos] = useState(0);
  // Atualização cadastral (foto + dados) no primeiro acesso, como o CLT.
  const [meu, setMeu] = useState<MeuCadastro | null | 'erro'>(null);
  const [trocandoFoto, setTrocandoFoto] = useState(false);
  useEffect(() => { api.get<MeuCadastro>('/cadastro/meu').then(setMeu).catch(() => setMeu('erro')); }, []);

  const recarregar = useCallback(async () => {
    try { setEu(await api.get<Eu>('/portal/eu')); setErro(null); } catch (e) { setErro((e as Error).message); }
  }, []);
  useEffect(() => {
    void recarregar();
    const vis = () => { if (document.visibilityState === 'visible') void recarregar(); };
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, [recarregar]);
  useEffect(() => {
    const buscar = () => { api.get<{ naoLidos: number }>('/comunicacao/meus/resumo').then((r) => setNaoLidos(r.naoLidos)).catch(() => {}); };
    buscar();
    window.addEventListener('pontosnap:avisos', buscar);
    return () => window.removeEventListener('pontosnap:avisos', buscar);
  }, [pathname]);

  if (meu === null) return <div className={css.casca} aria-busy="true" />;
  if (meu !== 'erro' && (meu.precisaAtualizar || trocandoFoto)) {
    return <AtualizacaoCadastral meu={meu} modo={meu.precisaAtualizar ? 'obrigatorio' : 'trocar'}
      onConcluir={(m) => { setMeu(m); setTrocandoFoto(false); void recarregar(); }} onCancelar={() => setTrocandoFoto(false)} />;
  }
  const foto = meu !== 'erro' ? meu.foto?.miniatura ?? null : null;
  const p = eu?.prestador;
  const aba = (rota: string, rotulo: string, ativo: boolean, extra?: JSX.Element) => (
    <button className={`${ativo ? css.on : ''} ${extra ? css.comBolinha : ''}`} onClick={() => navegar(rota)} aria-current={ativo ? 'page' : undefined}>
      {rotulo}{extra}
    </button>
  );

  return (
    <div className={css.casca}>
      <header className={css.topo}>
        <button className={css.logo} onClick={() => navegar('/')} aria-label="Início">
          <Flash tamanho={20} cor="var(--coral)" />
          <span>Ponto<b>Snap</b></span>
        </button>
        <button className={css.avatar} onClick={() => navegar('/menu')} aria-label="Menu e minha conta" style={{ background: '#E6EDFC' }}>
          {foto ? <img src={foto} alt="" className={css.avatarFoto} /> : p ? <Caricatura semente={p.avatarSemente ?? hash(p.id)} /> : null}
        </button>
      </header>

      <div className={css.instalarZona}>
        <PromptInstalar />
        <NotificacaoPrompt titulo="Quer saber quando o valor sair?"
          descricao="A gente te avisa quando o RH fechar o mês, se precisar corrigir a nota e quando o pagamento for registrado." />
      </div>

      <main className={css.conteudo}>
        <Outlet context={{ eu, erro, recarregar, foto, trocarFoto: () => setTrocandoFoto(true) } satisfies Ctx} />
      </main>

      <nav className={css.abas} aria-label="Navegação">
        {aba('/', 'Início', pathname === '/')}
        {aba('/notas', 'Notas', pathname.startsWith('/notas'))}
        {aba('/avisos', 'Avisos', pathname.startsWith('/avisos'),
          naoLidos > 0 ? <span className={css.bolinha} aria-label={`${naoLidos} não lidos`}>{naoLidos > 9 ? '9+' : naoLidos}</span> : undefined)}
        {aba('/menu', 'Menu', pathname === '/menu' || pathname === '/trocar-senha')}
      </nav>
    </div>
  );
}
