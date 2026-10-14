import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { quando, type Bloco, type Publico, type StatusComunicado } from '../lib/comunicacao';
import { Avatar } from '../components/Avatar';
import { ComunicadoView } from '../components/comunicado/ComunicadoView';
import { PainelLateral } from '../components/PainelLateral';
import css from './Comunicacao.module.css';

interface Destinatario {
  empregadoId: string; nome: string; cliente: string | null; temPush: boolean;
  abertoEm: string | null; midiaEm: string | null; cienteEm: string | null; reacao: string | null;
}
interface Detalhe {
  id: string; titulo: string; blocos: Bloco[]; publico: Publico; status: StatusComunicado;
  pedirCiencia: boolean; fixado: boolean; notificar: boolean; lembrar: boolean; reacoes: boolean;
  publicadoEm: string | null; lembreteEm: string | null; notificados: number; autorNome: string | null;
  destinatarios: Destinatario[]; porCliente: { nome: string; total: number; ok: number }[]; contagemReacoes: Record<string, number>;
}
type Filtro = 'TODOS' | 'NAO_ABRIU' | 'SEM_CIENCIA' | 'OK';
const caminhoRH = (id: string, mini?: boolean) => `/comunicacao/midia/${id}${mini ? '?mini=1' : ''}`;
const PUBLICO: Record<string, string> = { TODOS: 'Todos', CLIENTE: 'Por cliente', ESCALA: 'Por escala', PESSOAS: 'Pessoas escolhidas' };

function Anel({ ok, meio, total }: { ok: number; meio: number; total: number }) {
  const p = (n: number) => (total ? (n / total) * 100 : 0);
  return (
    <svg width="92" height="92" viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--cream)" strokeWidth="4" />
      <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--ok-text)" strokeWidth="4" strokeDasharray={`${p(ok)} 100`} transform="rotate(-90 18 18)" />
      {meio > 0 && <circle cx="18" cy="18" r="15.9" fill="none" stroke="#E2A33A" strokeWidth="4" strokeDasharray={`${p(meio)} 100`} strokeDashoffset={-p(ok)} transform="rotate(-90 18 18)" />}
    </svg>
  );
}

/** Quem abriu, assistiu/ouviu e deu ciência, com lembrete e comprovante em PDF. */
export function ComunicadoDetalhe() {
  const { id } = useParams();
  const navegar = useNavigate();
  const loc = useLocation() as { state?: { publicado?: number } };
  const [d, setD] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(loc.state?.publicado != null ? `Publicado para ${loc.state.publicado} ${loc.state.publicado === 1 ? 'pessoa' : 'pessoas'}. As notificações estão saindo agora.` : null);
  const [filtro, setFiltro] = useState<Filtro>('TODOS');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [lembrados, setLembrados] = useState<Record<string, string>>({});
  const [conteudo, setConteudo] = useState(false);

  const carregar = useCallback(async () => {
    try { setD(await api.get<Detalhe>(`/comunicacao/${id}`)); } catch (e) { setErro((e as Error).message); }
  }, [id]);
  useEffect(() => { void carregar(); }, [carregar]);
  // Logo depois de publicar, as notificações ainda estão saindo: atualiza uma vez.
  useEffect(() => { if (loc.state?.publicado == null) return; const t = setTimeout(() => void carregar(), 4000); return () => clearTimeout(t); }, [loc.state, carregar]);

  const ds = d?.destinatarios ?? [];
  const cont = useMemo(() => ({
    TODOS: ds.length,
    NAO_ABRIU: ds.filter((x) => !x.abertoEm).length,
    SEM_CIENCIA: ds.filter((x) => x.abertoEm && !x.cienteEm).length,
    OK: ds.filter((x) => (d?.pedirCiencia ? x.cienteEm : x.abertoEm)).length,
  }), [ds, d?.pedirCiencia]);
  const pendentes = d ? ds.filter((x) => (d.pedirCiencia ? !x.cienteEm : !x.abertoEm)) : [];

  if (d && (d.status === 'RASCUNHO' || d.status === 'AGENDADO')) return <Navigate to={`/rh/comunicacao/${d.id}/editar`} replace />;

  const lista = ds.filter((x) => (filtro === 'TODOS' ? true : filtro === 'NAO_ABRIU' ? !x.abertoEm : filtro === 'SEM_CIENCIA' ? x.abertoEm && !x.cienteEm : d?.pedirCiencia ? x.cienteEm : x.abertoEm));
  const temMidia = d?.blocos.some((b) => b.tipo === 'VIDEO' || b.tipo === 'AUDIO');
  const nVideo = d?.blocos.some((b) => b.tipo === 'VIDEO');

  async function lembrar(ids?: string[]) {
    setOcupado(ids ? ids[0]! : 'todos'); setErro(null);
    try {
      const r = await api.post<{ pessoas: number; receberam: number; semChaves: boolean }>(`/comunicacao/${id}/lembrar`, ids ? { empregadoIds: ids } : {});
      const txt = r.semChaves ? 'O servidor está sem as chaves de notificação.' : r.receberam === r.pessoas ? 'Lembrete enviado' : r.receberam === 0 ? 'Não chegou: sem notificação ativa' : `Chegou para ${r.receberam} de ${r.pessoas}`;
      if (ids) setLembrados((l) => ({ ...l, [ids[0]!]: txt }));
      else setMsg(r.semChaves ? txt : `Lembrete enviado: chegou no celular de ${r.receberam} de ${r.pessoas} ${r.pessoas === 1 ? 'pessoa' : 'pessoas'}. Quem não tem notificação ativa vê quando abrir o app.`);
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(null); }
  }
  async function acao(caminho: string, corpo: unknown, ok: string) {
    setOcupado(caminho); setErro(null);
    try { await api.post(`/comunicacao/${id}/${caminho}`, corpo); setMsg(ok); await carregar(); } catch (e) { setErro((e as Error).message); } finally { setOcupado(null); }
  }
  async function baixarPdf() {
    setOcupado('pdf');
    try {
      const b = await api.baixar(`/comunicacao/${id}/ciencia.pdf`);
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `ciencia_${(d?.titulo ?? 'comunicado').slice(0, 30)}.pdf`; a.click();
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(null); }
  }

  if (!d) return <div className={css.pagina}>{erro ? <p className={css.erro}>{erro}</p> : <p className={css.ajuda} aria-busy="true">Carregando…</p>}</div>;
  const ok = cont.OK;
  const meio = d.pedirCiencia ? cont.SEM_CIENCIA : 0;
  const arquivado = d.status === 'ARQUIVADO';
  const reacoes = Object.entries(d.contagemReacoes).sort((a, b) => b[1] - a[1]);
  const statusDe = (x: Destinatario) => {
    if (d.pedirCiencia && x.cienteEm) return { t: `ciente ${quando(x.cienteEm)}`, c: css.stOk };
    if (!d.pedirCiencia && x.abertoEm) return { t: `leu ${quando(x.abertoEm)}`, c: css.stOk };
    if (x.abertoEm) return { t: `abriu ${quando(x.abertoEm)}`, c: css.stMeio };
    return { t: 'não abriu', c: css.stPend };
  };

  return (
    <div className={css.pagina}>
      <div className={css.cab}>
        <div style={{ minWidth: 0 }}>
          <button type="button" className={css.voltar} onClick={() => navegar('/rh/comunicacao')}>‹ Comunicação interna</button>
          <h2>{d.titulo}</h2>
          <p>Publicado {quando(d.publicadoEm)}{d.autorNome ? ` por ${d.autorNome}` : ''} · {PUBLICO[d.publico.tipo]} ({ds.length}){d.pedirCiencia ? ' · ciência obrigatória' : ''}{arquivado ? ' · arquivado' : ''}</p>
        </div>
        <div className={css.acoes}>
          <button type="button" className={css.btnSec} onClick={() => setConteudo(true)}>Ver conteúdo</button>
          {!arquivado && <button type="button" className={css.btnSec} onClick={() => navegar(`/rh/comunicacao/${d.id}/editar`)}>Editar</button>}
          {!arquivado && <button type="button" className={css.btnSec} disabled={!!ocupado} onClick={() => acao('fixar', { fixado: !d.fixado }, d.fixado ? 'Desafixado.' : 'Fixado no topo do app.')}>{d.fixado ? 'Desafixar' : 'Fixar no topo'}</button>}
          <button type="button" className={css.btnSec} disabled={!!ocupado} onClick={() => acao('arquivar', { arquivar: !arquivado }, arquivado ? 'Voltou para o app.' : 'Arquivado: saiu do app dos funcionários. O comprovante continua aqui.')}>{arquivado ? 'Desarquivar' : 'Arquivar'}</button>
          {!arquivado && pendentes.length > 0 && <button type="button" className={css.btnPri} disabled={!!ocupado} onClick={() => lembrar()}>🔔 Lembrar {pendentes.length === 1 ? 'o pendente' : `os ${pendentes.length} pendentes`}</button>}
        </div>
      </div>
      {erro && <p className={css.erro} role="alert">{erro}</p>}
      {msg && <p className={css.okMsg} role="status">{msg}</p>}

      <div className={css.det}>
        <div className={css.caixa}>
          <div className={css.resumo}>
            <Anel ok={ok} meio={meio} total={ds.length} />
            <div>
              <b>{ok} {d.pedirCiencia ? (ok === 1 ? 'deu ciência' : 'deram ciência') : ok === 1 ? 'leu' : 'leram'}</b>
              <small>{[d.pedirCiencia && cont.SEM_CIENCIA > 0 && `${cont.SEM_CIENCIA} ${cont.SEM_CIENCIA === 1 ? 'abriu' : 'abriram'} mas não confirmou`, cont.NAO_ABRIU > 0 && `${cont.NAO_ABRIU} ainda não ${cont.NAO_ABRIU === 1 ? 'abriu' : 'abriram'}`].filter(Boolean).join(' · ') || 'Todo mundo em dia.'}</small>
              {(temMidia || reacoes.length > 0) && (
                <div className={css.stats}>
                  {temMidia && <span>{nVideo ? '▶' : '🎙'} {ds.filter((x) => x.midiaEm).length} {nVideo ? 'deram play no vídeo/áudio' : 'ouviram o áudio'}</span>}
                  {reacoes.map(([r, n]) => <span key={r}>{r} {n}</span>)}
                </div>
              )}
            </div>
          </div>

          <div className={css.filtros} style={{ marginTop: 16 }} role="group" aria-label="Filtrar pessoas">
            {(d.pedirCiencia
              ? [['TODOS', 'Todos'], ['NAO_ABRIU', 'Não abriram'], ['SEM_CIENCIA', 'Abriram sem confirmar'], ['OK', 'Deram ciência']] as const
              : [['TODOS', 'Todos'], ['NAO_ABRIU', 'Não abriram'], ['OK', 'Leram']] as const).map(([k, rot]) => (
              <button key={k} className={`${css.fl} ${filtro === k ? css.flOn : ''}`} aria-pressed={filtro === k} onClick={() => setFiltro(k)}>{rot}<span>{cont[k]}</span></button>
            ))}
          </div>
          <ul className={css.pess}>
            {lista.length === 0 && <li><span className={css.nm}><small>Ninguém neste filtro.</small></span></li>}
            {lista.map((x) => {
              const s = statusDe(x);
              const pend = d.pedirCiencia ? !x.cienteEm : !x.abertoEm;
              return (
                <li key={x.empregadoId}>
                  <Avatar id={x.empregadoId} nome={x.nome} tamanho={34} />
                  <span className={css.nm}><b>{x.nome}</b><small>{[x.cliente, !x.temPush && pend && 'sem notificação ativa', x.midiaEm && (nVideo ? 'deu play' : 'ouviu'), x.reacao].filter(Boolean).join(' · ') || ' '}</small></span>
                  <span className={`${css.st} ${s.c}`}>{s.t}{lembrados[x.empregadoId] && <><br /><small style={{ fontWeight: 400 }}>{lembrados[x.empregadoId]}</small></>}</span>
                  {pend && !arquivado && <button type="button" className={`${css.btnSec} ${css.pequeno}`} disabled={!!ocupado} onClick={() => lembrar([x.empregadoId])}>Lembrar</button>}
                </li>
              );
            })}
          </ul>
        </div>

        <div className={css.lado}>
          {d.porCliente.length > 1 && (
            <div className={css.caixa}>
              <h4>Por cliente</h4>
              <div className={css.grupo}>
                {d.porCliente.map((g) => {
                  const pct = g.total ? Math.round((g.ok / g.total) * 100) : 0;
                  return (
                    <div key={g.nome}>
                      <div><b>{g.nome}</b><span>{g.ok}/{g.total}</span></div>
                      <div className={css.barra}><i className={pct < 90 ? css.meio : ''} style={{ width: `${pct}%` }} /></div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className={css.caixa}>
            <h4>Envio</h4>
            <ul className={css.hist}>
              <li><b>{quando(d.publicadoEm)}</b> · publicado{d.notificar ? `, notificação chegou para ${d.notificados} ${d.notificados === 1 ? 'pessoa' : 'pessoas'}` : ' sem notificação'}</li>
              {d.lembrar && <li><b>{d.lembreteEm ? quando(d.lembreteEm) : quando(new Date(Date.parse(d.publicadoEm!) + 86_400_000).toISOString())}</b> · {d.lembreteEm ? 'lembrete automático enviado' : 'lembrete automático para quem não leu'}</li>}
            </ul>
          </div>
          <div className={css.caixa}>
            <h4>Comprovante</h4>
            <p className={css.ajuda} style={{ margin: '0 0 10px' }}>Lista com nome, CPF, data e hora {d.pedirCiencia ? 'da ciência' : 'da leitura'} de cada pessoa. Serve de prova de que o funcionário foi comunicado.</p>
            <button type="button" className={css.btnSec} onClick={baixarPdf} disabled={ocupado === 'pdf'}>{ocupado === 'pdf' ? 'Gerando…' : `Baixar PDF de ${d.pedirCiencia ? 'ciência' : 'leitura'}`}</button>
          </div>
        </div>
      </div>

      <PainelLateral titulo={d.titulo} subtitulo={`${d.autorNome ?? 'RH'} · como aparece no app`} aberto={conteudo} onFechar={() => setConteudo(false)} largura={440}>
        <div className={css.previa}><ComunicadoView blocos={d.blocos} caminho={caminhoRH} /></div>
      </PainelLateral>
    </div>
  );
}
