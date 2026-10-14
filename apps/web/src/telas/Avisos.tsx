import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { quando, REACOES, type Bloco, type EstadoEnquete } from '../lib/comunicacao';
import { ComunicadoView, Galeria, PlayerAudio, VideoEmbed } from '../components/comunicado/ComunicadoView';
import css from './Avisos.module.css';

const caminhoApp = (id: string, mini?: boolean) => `/comunicacao/meus/midia/${id}${mini ? '?mini=1' : ''}`;

interface Cartao {
  id: string; titulo: string; autorNome: string; publicadoEm: string; fixado: boolean; pedirCiencia: boolean; reacoesAtivas: boolean;
  trecho: string | null; destaque: 'VIDEO' | 'FOTOS' | 'AUDIO' | null;
  video: { provedor: 'YOUTUBE' | 'VIMEO' | 'DRIVE'; videoId: string; titulo: string | null } | null;
  fotos: string[]; totalFotos: number; audio: { midiaId: string; duracaoSeg: number; picos: number[] } | null; outros: string[];
  abertoEm: string | null; cienteEm: string | null; midiaEm: string | null; minhaReacao: string | null; reacoes: Record<string, number>;
  enquete: EstadoEnquete | null;
}
interface Lista { itens: Cartao[]; naoLidos: number; pendentesCiencia: number; faltaVoto: number }
interface Completo {
  id: string; titulo: string; autorNome: string; publicadoEm: string; blocos: Bloco[]; pedirCiencia: boolean; reacoesAtivas: boolean;
  abertoEm: string; cienteEm: string | null; midiaEm: string | null; minhaReacao: string | null; reacoes: Record<string, number>;
  enquete: EstadoEnquete | null;
}

/** Trecho da lista sem as marcas de formatação (**negrito**, *itálico*, "- "). */
const limpar = (t: string) => t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*\s][^*]*)\*/g, '$1').replace(/^\s*[-•]\s+/gm, '• ').replace(/\n+/g, ' ');

/** Avisa a casca do app (bolinha da aba) que algo mudou. */
const avisarMudanca = () => window.dispatchEvent(new Event('pontosnap:avisos'));

function Autor({ nome, quandoIso }: { nome: string; quandoIso: string }) {
  const ini = nome.trim().split(/\s+/).filter((p) => /\p{L}/u.test(p)).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || 'RH';
  let h = 0; for (const c of nome) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const cores = ['#0F1B33', '#2457D6', '#5B4BC4', '#0E7A50', '#8C5A00', '#2D4E8A'];
  return (
    <div className={css.autor}>
      <span className={css.av} style={{ background: cores[h % cores.length] }} aria-hidden="true">{ini}</span>
      <div><b>{nome}</b><small>{quando(quandoIso)}</small></div>
    </div>
  );
}

function Reacoes({ ativas, minha, contagem, onReagir }: { ativas: boolean; minha: string | null; contagem: Record<string, number>; onReagir: (r: string | null) => void }) {
  if (!ativas) return null;
  return (
    <div className={css.reacoes} role="group" aria-label="Reagir">
      {REACOES.map((r) => {
        const n = contagem[r] ?? 0;
        return (
          <button key={r} type="button" className={minha === r ? css.reacOn : ''} aria-pressed={minha === r}
            onClick={(e) => { e.stopPropagation(); onReagir(minha === r ? null : r); }}>
            {r}{n > 0 && <span>{n}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Aba "Avisos": comunicados do RH, fixados primeiro e não lidos marcados. */
export function Avisos() {
  const navegar = useNavigate();
  const [d, setD] = useState<Lista | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(() => api.get<Lista>('/comunicacao/meus').then(setD).catch((e) => setErro((e as Error).message)), []);
  useEffect(() => { void carregar(); }, [carregar]);

  const marcarMidia = (c: Cartao) => { if (!c.midiaEm) void api.post(`/comunicacao/meus/${c.id}/midia`).then(avisarMudanca).catch(() => {}); };
  const fixados = d?.itens.filter((i) => i.fixado) ?? [];
  const recentes = d?.itens.filter((i) => !i.fixado) ?? [];
  const pend = d?.itens.find((i) => i.pedirCiencia && !i.cienteEm);
  const semVoto = d?.itens.find((i) => i.enquete && !i.enquete.encerrada && !i.enquete.meuVoto);

  const cartao = (c: Cartao) => (
    <article key={c.id} className={`${css.post} ${!c.abertoEm ? css.naoLido : ''}`}>
      <button type="button" className={css.postLink} onClick={() => navegar(`/avisos/${c.id}`)} aria-label={`Abrir: ${c.titulo}`} />
      <Autor nome={c.autorNome} quandoIso={c.publicadoEm} />
      <h3>{!c.abertoEm && <span className={css.sr}>Não lido: </span>}{c.titulo}</h3>
      {c.trecho && <p className={css.trecho}>{limpar(c.trecho)}{c.trecho.length >= 180 ? '…' : ''}</p>}
      {c.destaque === 'VIDEO' && c.video && <div className={css.midia}><VideoEmbed bloco={{ tipo: 'VIDEO', url: '', ...c.video }} compacto onPlay={() => marcarMidia(c)} /></div>}
      {c.destaque === 'FOTOS' && <div className={css.fotos}><Galeria midias={c.fotos} total={c.totalFotos} caminho={caminhoApp} max={3} estatica /></div>}
      {c.destaque === 'AUDIO' && c.audio && <div className={css.midia}><PlayerAudio caminho={caminhoApp(c.audio.midiaId)} duracaoSeg={c.audio.duracaoSeg} picos={c.audio.picos} onOuvir={() => marcarMidia(c)} /></div>}
      {c.enquete && <ResumoEnquete e={c.enquete} />}
      <div className={css.rodape}>
        {c.enquete && !c.enquete.encerrada && !c.enquete.meuVoto && <span className={css.pedeCiencia}>Falta seu voto</span>}
        {c.pedirCiencia && !c.cienteEm && <span className={css.pedeCiencia}>Pede ciência</span>}
        {c.pedirCiencia && c.cienteEm && <span className={css.lido}>✓ Ciente</span>}
        {!c.pedirCiencia && c.abertoEm && <span className={css.lido}>✓ Visto</span>}
        {c.outros.length > 0 && <span>+ {c.outros.join(', ')}</span>}
        {c.reacoesAtivas && Object.keys(c.reacoes).length > 0 && (
          <span className={css.contReac}>{Object.entries(c.reacoes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => <span key={r}>{r} {n}</span>)}</span>
        )}
      </div>
    </article>
  );

  return (
    <div className="appshell">
      <div className={css.h}>Avisos</div>
      <div className={css.s}>Recados do RH para você.</div>
      {erro && <p className={css.erro}>{erro}</p>}
      {pend && (
        <button type="button" className={css.banner} onClick={() => navegar(`/avisos/${pend.id}`)}>
          <span><b>{d!.pendentesCiencia === 1 ? '1 comunicado pede sua ciência' : `${d!.pendentesCiencia} comunicados pedem sua ciência`}</b><small>{pend.titulo}</small></span>
          <span className={css.go}>Ver agora</span>
        </button>
      )}
      {!pend && semVoto && (
        <button type="button" className={css.banner} onClick={() => navegar(`/avisos/${semVoto.id}`)}>
          <span><b>{d!.faltaVoto === 1 ? 'Tem uma enquete esperando seu voto' : `${d!.faltaVoto} enquetes esperando seu voto`}</b><small>📊 {semVoto.enquete!.pergunta}</small></span>
          <span className={css.go}>Votar</span>
        </button>
      )}
      {d && d.itens.length === 0 && (
        <div className={css.vazio}><b>Nenhum aviso por enquanto</b><p>Quando o RH mandar um recado, ele aparece aqui e no seu celular.</p></div>
      )}
      {fixados.length > 0 && <><div className={css.secao}>📌 Fixado</div>{fixados.map(cartao)}</>}
      {recentes.length > 0 && <>{fixados.length > 0 && <div className={css.secao}>Recentes</div>}{recentes.map(cartao)}</>}
      {!d && !erro && <div className={css.esqueleto} aria-busy="true" aria-label="Carregando" />}
    </div>
  );
}

/** Enquete no card da lista: a pergunta e o que falta (o voto acontece dentro do comunicado). */
function ResumoEnquete({ e }: { e: EstadoEnquete }) {
  const meu = e.meuVoto ? e.opcoes.filter((o) => e.meuVoto!.includes(o.id)).map((o) => o.texto).join(', ') : null;
  const lider = e.verResultado && e.total ? [...e.opcoes].sort((a, b) => (b.votos ?? 0) - (a.votos ?? 0)).slice(0, 2) : [];
  return (
    <div className={`${css.enqCard} ${meu || e.encerrada ? css.enqFeito : ''}`}>
      <b>📊 {lider.length ? lider.map((o) => `${o.texto} ${Math.round(((o.votos ?? 0) / e.total) * 100)}%`).join(' · ') : e.pergunta}</b>
      <span>{meu ? `Seu voto: ${meu}` : `${e.opcoes.length} opções`}{e.encerrada ? ' · votação encerrada' : e.total ? ` · ${e.total} já ${e.total === 1 ? 'votou' : 'votaram'}` : ''}</span>
      {!meu && !e.encerrada && <span className={css.enqGo} aria-hidden="true">Votar</span>}
    </div>
  );
}

/** Um comunicado aberto: tudo numa tela, com a ciência fixa embaixo. */
export function Aviso() {
  const { id } = useParams();
  const navegar = useNavigate();
  const [c, setC] = useState<Completo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const marcou = useRef(false);

  useEffect(() => {
    api.get<Completo>(`/comunicacao/meus/${id}`).then((x) => { setC(x); avisarMudanca(); }).catch((e) => setErro((e as Error).message));
  }, [id]);

  const midia = () => {
    if (!c || c.midiaEm || marcou.current) return;
    marcou.current = true;
    void api.post(`/comunicacao/meus/${c.id}/midia`).catch(() => { marcou.current = false; });
  };
  async function ciente() {
    if (!c) return;
    setEnviando(true);
    try {
      const r = await api.post<{ cienteEm: string }>(`/comunicacao/meus/${c.id}/ciente`);
      setC({ ...c, cienteEm: r.cienteEm });
      avisarMudanca();
    } catch (e) { setErro((e as Error).message); } finally { setEnviando(false); }
  }
  async function votar(opcoes: string[]) {
    const r = await api.post<EstadoEnquete>(`/comunicacao/meus/${id}/voto`, { opcoes });
    setC((x) => (x ? { ...x, enquete: r } : x));
    avisarMudanca();
    return r;
  }
  async function reagir(r: string | null) {
    if (!c) return;
    const antes = c;
    const cont = { ...c.reacoes };
    if (c.minhaReacao) cont[c.minhaReacao] = Math.max(0, (cont[c.minhaReacao] ?? 1) - 1);
    if (r) cont[r] = (cont[r] ?? 0) + 1;
    setC({ ...c, minhaReacao: r, reacoes: cont });
    try { await api.post(`/comunicacao/meus/${c.id}/reacao`, { reacao: r }); } catch { setC(antes); }
  }

  if (erro && !c) return <div className="appshell"><button type="button" className={css.voltar} onClick={() => navegar('/avisos')}>‹ Avisos</button><p className={css.erro}>{erro}</p></div>;
  if (!c) return <div className="appshell"><div className={css.esqueleto} aria-busy="true" aria-label="Carregando" /></div>;

  // O vídeo, se for o primeiro bloco, vai para o topo como na leitura de uma notícia.
  const [primeiro, ...resto] = c.blocos;
  const videoNoTopo = primeiro?.tipo === 'VIDEO';
  return (
    <div className="appshell">
      <button type="button" className={css.voltar} onClick={() => navegar('/avisos')}>‹ Avisos</button>
      <article className={css.leitura}>
        {videoNoTopo && <div className={css.topoVideo}><ComunicadoView blocos={[primeiro!]} caminho={caminhoApp} onMidia={midia} /></div>}
        <Autor nome={c.autorNome} quandoIso={c.publicadoEm} />
        <h1 className={css.titulo}>{c.titulo}</h1>
        <ComunicadoView blocos={videoNoTopo ? resto : c.blocos} caminho={caminhoApp} onMidia={midia} enquete={c.enquete} onVotar={votar} />
        <Reacoes ativas={c.reacoesAtivas} minha={c.minhaReacao} contagem={c.reacoes} onReagir={reagir} />
      </article>
      {erro && <p className={css.erro}>{erro}</p>}
      {c.pedirCiencia && (
        <div className={css.cienteBox}>
          {c.cienteEm
            ? <p className={css.cienteOk}>✓ Ciência registrada {quando(c.cienteEm)}</p>
            : <>
              <button type="button" className={css.btnCiente} onClick={ciente} disabled={enviando}>{enviando ? 'Registrando…' : 'Li e estou ciente'}</button>
              <small>Fica registrado com data e hora para o RH.</small>
            </>}
        </div>
      )}
    </div>
  );
}
