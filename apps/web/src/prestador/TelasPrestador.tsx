import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { pushSuportado, temSubscriptionAtiva, ativarNotificacoes, desativarNotificacoes } from '../lib/push';
import { brl, fmtCnpj, fmtTel, notaEmDestaque, statusParaPrestador, type Eu, type Nota } from '../lib/prestador';
import { Caricatura, hash } from '../components/Avatar';
import { BotaoTema } from '../components/BotaoTema';
import { PainelNota } from './PainelNota';
import { usePrestador } from './LayoutPrestador';
import css from './Prestador.module.css';

const primeiroNome = (n: string) => n.trim().split(/\s+/)[0] ?? n;
const tipoRotulo = (eu: Eu) => `${eu.prestador.tipo === 'MEI' ? 'MEI' : 'Motorista · semanal'}${eu.prestador.empresa ? ` · ${eu.prestador.empresa}` : ''}`;

/** Marca a nota como vista pelo prestador (o RH vê "viu há 2 dias"). */
function useVisto(n: Nota | null) {
  useEffect(() => { if (n && !n.vistoEm) void api.post(`/portal/eu/notas/${n.id}/visto`).catch(() => {}); }, [n?.id, n?.vistoEm]);
}

function Item({ n, onClick }: { n: Nota; onClick: () => void }) {
  const st = statusParaPrestador(n);
  return (
    <button type="button" className={css.item} onClick={onClick}>
      <span>
        <b>{n.periodo === 'MES' ? n.rotulo : n.rotulo.replace('Semana ', '')}</b>
        <small>{n.nf.numero ? `NF ${n.nf.numero}` : 'sem nota'}{n.periodo !== 'MES' ? ` · ${n.detalhe[0]?.rotulo.split(' ×')[0] ?? ''}` : ''}</small>
      </span>
      <span className={css.itemDir}>
        <b>{brl(n.valorCent)}</b>
        <span className={`${css.tag} ${css[`t-${st.tom}`]}`}>{st.texto}</span>
      </span>
    </button>
  );
}

/** Início: o valor em destaque e o que fazer agora. */
export function InicioPrestador() {
  const { eu, erro, recarregar } = usePrestador();
  const navegar = useNavigate();
  const nota = eu ? notaEmDestaque(eu.notas) : null;
  useVisto(nota);
  if (erro && !eu) return <div className={css.tela}><p className={css.erro}>{erro}</p></div>;
  if (!eu) return <div className={css.tela}><div className={css.esqueleto} aria-busy="true" /></div>;
  const outras = eu.notas.filter((n) => n.id !== nota?.id && !(n.status === 'APROVADA' && n.pago)).slice(0, 6);
  return (
    <div className={css.tela}>
      <h1 className={css.oi}>Oi, {primeiroNome(eu.prestador.nome)}</h1>
      <div className={css.tipo}>{tipoRotulo(eu)}</div>
      {nota ? <PainelNota eu={eu} nota={nota} onMudou={recarregar} /> : (
        <div className={css.vazio}>
          <b>Nada para emitir ainda</b>
          <p>{eu.prestador.tipo === 'MEI'
            ? 'Quando o RH fechar o mês, o valor da sua nota aparece aqui e você recebe um aviso no celular.'
            : 'Quando o RH fechar a semana, o valor aparece aqui e você recebe um aviso no celular.'}</p>
        </div>
      )}
      {outras.length > 0 && (
        <>
          <div className={css.secao}>{eu.prestador.tipo === 'MEI' ? 'Outros meses em aberto' : 'Outras semanas em aberto'}</div>
          {outras.map((n) => <Item key={n.id} n={n} onClick={() => navegar(`/notas/${n.id}`)} />)}
        </>
      )}
    </div>
  );
}

/** Notas: histórico por mês (motorista: por semana), com a situação de cada uma. */
export function NotasPrestador() {
  const { eu, erro } = usePrestador();
  const navegar = useNavigate();
  if (erro && !eu) return <div className={css.tela}><p className={css.erro}>{erro}</p></div>;
  if (!eu) return <div className={css.tela}><div className={css.esqueleto} aria-busy="true" /></div>;
  const grupos = new Map<string, Nota[]>();
  for (const n of eu.notas) {
    const g = n.periodo === 'MES' ? n.competencia.slice(0, 4) : n.competencia;
    grupos.set(g, [...(grupos.get(g) ?? []), n]);
  }
  const nomeGrupo = (g: string) => (g.length === 4 ? g : new Date(`${g}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
  return (
    <div className={css.tela}>
      <h1 className={css.h}>Minhas notas</h1>
      <p className={css.s}>Cada {eu.prestador.tipo === 'MEI' ? 'mês' : 'semana'} com o valor, a nota e o pagamento.</p>
      {eu.notas.length === 0 && <div className={css.vazio}><b>Nenhuma nota ainda</b><p>O histórico aparece aqui depois do primeiro fechamento.</p></div>}
      {[...grupos.entries()].map(([g, ns]) => (
        <section key={g} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className={css.secao}>{nomeGrupo(g)}</div>
          {ns.map((n) => <Item key={n.id} n={n} onClick={() => navegar(`/notas/${n.id}`)} />)}
        </section>
      ))}
    </div>
  );
}

/** Uma nota do histórico (mesmo painel do início). */
export function NotaPrestador() {
  const { id } = useParams();
  const { eu, erro, recarregar } = usePrestador();
  const navegar = useNavigate();
  const nota = eu?.notas.find((n) => n.id === id) ?? null;
  useVisto(nota);
  if (erro && !eu) return <div className={css.tela}><p className={css.erro}>{erro}</p></div>;
  if (!eu) return <div className={css.tela}><div className={css.esqueleto} aria-busy="true" /></div>;
  return (
    <div className={css.tela}>
      <button type="button" className={css.voltar} onClick={() => navegar('/notas')}>‹ Notas</button>
      {nota ? <PainelNota eu={eu} nota={nota} onMudou={recarregar} /> : <p className={css.erro}>Nota não encontrada.</p>}
    </div>
  );
}

/** Menu: dados, notificações, senha, tema e sair. */
export function MenuPrestador() {
  const { eu } = usePrestador();
  const { sair } = useAuth();
  const navegar = useNavigate();
  const [push, setPush] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (pushSuportado()) void temSubscriptionAtiva().then(setPush); }, []);
  async function alternarPush() {
    setMsg(null);
    if (push) { await desativarNotificacoes(); setPush(false); setMsg('Notificações desligadas neste aparelho.'); return; }
    const r = await ativarNotificacoes();
    if (r.ok) { setPush(true); setMsg('Pronto! Você vai receber os avisos neste aparelho.'); } else setMsg(r.erro ?? 'Não consegui ativar.');
  }
  const p = eu?.prestador;
  return (
    <div className={css.tela}>
      {p && (
        <div className={css.perfil}>
          <span><Caricatura semente={p.avatarSemente ?? hash(p.id)} /></span>
          <div><b>{p.nome}</b><small>{p.tipo === 'MEI' ? 'MEI' : 'Motorista'}{p.empresa ? ` · ${p.empresa}` : ''}</small></div>
        </div>
      )}
      <section className={css.card}>
        <h3>Meus dados</h3>
        {p?.documento && <div className={css.lin}><span>{p.documento.length === 14 ? 'CNPJ' : 'CPF'}</span><span className={css.mono}>{fmtCnpj(p.documento)}</span></div>}
        {p?.email && <div className={css.lin}><span>E-mail (login)</span><span className={css.mono}>{p.email}</span></div>}
        <div className={css.lin}><span>Chave Pix</span><span className={css.mono}>{p?.chavePix ?? '—'}</span></div>
        <div className={css.lin}><span>Celular</span><span className={css.mono}>{p?.telefone ? fmtTel(p.telefone) : '—'}</span></div>
        <p className={css.s} style={{ margin: '8px 0 0' }}>Algo errado? Fale com o RH da {eu?.empresa ?? 'empresa'}.</p>
      </section>
      <section className={css.card}>
        {pushSuportado() && (
          <button type="button" className={css.menuItem} onClick={alternarPush}>
            <span>Notificações no celular</span><small>{push === null ? '…' : push ? 'ligadas · desligar' : 'desligadas · ligar'}</small>
          </button>
        )}
        <button type="button" className={css.menuItem} onClick={() => navegar('/trocar-senha')}><span>Trocar minha senha</span><small>›</small></button>
        <div className={css.menuItem} style={{ cursor: 'default' }}><span>Tema</span><BotaoTema /></div>
        <button type="button" className={`${css.menuItem} ${css.sair}`} onClick={() => { sair(); navegar('/login', { replace: true }); }}>Sair</button>
      </section>
      {msg && <div className={css.ok} role="status">{msg}</div>}
    </div>
  );
}
