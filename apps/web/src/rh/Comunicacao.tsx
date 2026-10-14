import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { miniaturaVideo, quando, useMidia, type Publico, type StatusComunicado } from '../lib/comunicacao';
import css from './Comunicacao.module.css';

interface Item {
  id: string; titulo: string; status: StatusComunicado; fixado: boolean; pedirCiencia: boolean;
  publicadoEm: string | null; agendadoPara: string | null; atualizadoEm: string; autorNome: string | null; publico: Publico;
  tipos: string[]; midias: string;
  capa: { tipo: 'FOTO'; midiaId: string } | { tipo: 'VIDEO'; provedor: string; videoId: string } | null; destinatarios: number; abertos: number; cientes: number; pendentesCiencia: number; votos: number | null;
}
interface Resp {
  itens: Item[];
  resumo: {
    enviadosMes: number; comCienciaMes: number; leituraMedia: number | null; leitura24h: number | null;
    pessoasPendentes: number; comunicadosPendentes: number; agendados: number; proximoAgendado: string | null;
  };
}
type Filtro = 'TODOS' | 'PENDENCIA' | 'AGENDADOS' | 'RASCUNHOS' | 'ARQUIVADOS';

const PUBLICO: Record<string, string> = { TODOS: 'Todos', CLIENTE: 'Por cliente', ESCALA: 'Por escala', PESSOAS: 'Pessoas escolhidas' };

/** Capa do card: a foto publicada (miniatura) ou a capa do vídeo; sem isso, o ícone do tipo. */
function Miniatura({ i }: { i: Item }) {
  const foto = useMidia(i.capa?.tipo === 'FOTO' ? `/comunicacao/midia/${i.capa.midiaId}?mini=1` : null);
  const [semCapa, setSemCapa] = useState(false);
  const capaVideo = i.capa?.tipo === 'VIDEO' && !semCapa ? miniaturaVideo(i.capa) : null;
  if (foto.url) return <span className={css.thumb} aria-hidden="true"><img src={foto.url} alt="" /></span>;
  if (capaVideo) return <span className={`${css.thumb} ${css.tVideo} ${css.thumbVideo}`} aria-hidden="true"><img src={capaVideo} alt="" onError={() => setSemCapa(true)} /><i>▶</i></span>;
  if (i.tipos.includes('VIDEO')) return <span className={`${css.thumb} ${css.tVideo}`} aria-hidden="true">▶</span>;
  if (i.tipos.includes('FOTOS')) return <span className={`${css.thumb} ${css.tFoto}`} aria-hidden="true">🖼</span>;
  if (i.tipos.includes('ENQUETE')) return <span className={`${css.thumb} ${css.tAudio}`} aria-hidden="true">📊</span>;
  if (i.tipos.includes('AUDIO')) return <span className={`${css.thumb} ${css.tAudio}`} aria-hidden="true">🎙</span>;
  return <span className={`${css.thumb} ${css.tTexto}`} aria-hidden="true">Aa</span>;
}

/** Lista de comunicados internos, com leitura e ciência. */
export function Comunicacao() {
  const navegar = useNavigate();
  const [d, setD] = useState<Resp | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('TODOS');

  useEffect(() => { api.get<Resp>('/comunicacao').then(setD).catch((e) => setErro((e as Error).message)); }, []);

  const contagem = useMemo(() => {
    const it = d?.itens ?? [];
    return {
      TODOS: it.filter((i) => i.status !== 'ARQUIVADO').length,
      PENDENCIA: it.filter((i) => i.status === 'PUBLICADO' && i.pendentesCiencia > 0).length,
      AGENDADOS: it.filter((i) => i.status === 'AGENDADO').length,
      RASCUNHOS: it.filter((i) => i.status === 'RASCUNHO').length,
      ARQUIVADOS: it.filter((i) => i.status === 'ARQUIVADO').length,
    };
  }, [d]);
  const lista = (d?.itens ?? []).filter((i) => (
    filtro === 'TODOS' ? i.status !== 'ARQUIVADO'
      : filtro === 'PENDENCIA' ? i.status === 'PUBLICADO' && i.pendentesCiencia > 0
        : filtro === 'AGENDADOS' ? i.status === 'AGENDADO'
          : filtro === 'RASCUNHOS' ? i.status === 'RASCUNHO' : i.status === 'ARQUIVADO'));

  const abrir = (i: Item) => navegar(i.status === 'RASCUNHO' || i.status === 'AGENDADO' ? `/rh/comunicacao/${i.id}/editar` : `/rh/comunicacao/${i.id}`);
  const r = d?.resumo;

  return (
    <div className={css.pagina}>
      <div className={css.cab}>
        <div>
          <h2>Comunicação interna</h2>
          <p>Avisos com texto, áudio, fotos e vídeo que chegam no app de todo mundo.</p>
        </div>
        <button className={css.btnPri} onClick={() => navegar('/rh/comunicacao/novo')}>＋ Novo comunicado</button>
      </div>
      {erro && <p className={css.erro}>{erro}</p>}

      {r && d!.itens.length > 0 && (
        <div className={css.kpis}>
          <div className={css.kpi}><small>Enviados no mês</small><b>{r.enviadosMes}</b><span>{r.comCienciaMes ? `${r.comCienciaMes} com ciência obrigatória` : 'nenhum pediu ciência'}</span></div>
          <div className={css.kpi}><small>Leitura média</small><b>{r.leituraMedia != null ? `${r.leituraMedia}%` : '—'}</b><span>{r.leitura24h != null ? `em até 24h: ${r.leitura24h}%` : 'ainda sem publicações'}</span></div>
          <div className={css.kpi}><small>Ciência pendente</small><b>{r.pessoasPendentes} {r.pessoasPendentes === 1 ? 'pessoa' : 'pessoas'}</b><span>{r.comunicadosPendentes ? `em ${r.comunicadosPendentes} ${r.comunicadosPendentes === 1 ? 'comunicado' : 'comunicados'}` : 'tudo em dia'}</span></div>
          <div className={css.kpi}><small>Agendados</small><b>{r.agendados}</b><span>{r.proximoAgendado ? `próximo: ${quando(r.proximoAgendado)}` : 'nenhum na fila'}</span></div>
        </div>
      )}

      {d && d.itens.length > 0 && (
        <div className={css.filtros} role="group" aria-label="Filtrar comunicados">
          {([['TODOS', 'Todos'], ['PENDENCIA', 'Com pendência'], ['AGENDADOS', 'Agendados'], ['RASCUNHOS', 'Rascunhos'], ['ARQUIVADOS', 'Arquivados']] as const).map(([k, rot]) => (
            <button key={k} className={`${css.fl} ${filtro === k ? css.flOn : ''}`} aria-pressed={filtro === k} onClick={() => setFiltro(k)}>{rot}<span>{contagem[k]}</span></button>
          ))}
        </div>
      )}

      {d && d.itens.length === 0 && (
        <div className={css.vazio}>
          <b>Nenhum comunicado ainda</b>
          <p>Mande um aviso com texto, um áudio gravado aqui mesmo, fotos ou um vídeo do YouTube. Chega no celular de todo mundo e você vê quem leu.</p>
          <button className={css.btnPri} onClick={() => navegar('/rh/comunicacao/novo')}>Criar o primeiro comunicado</button>
        </div>
      )}
      {d && d.itens.length > 0 && lista.length === 0 && <p className={css.vazio}>Nada neste filtro.</p>}

      <div className={css.lista}>
        {lista.map((i) => {
          const porVoto = i.votos != null && !i.pedirCiencia;
          const base = i.pedirCiencia ? i.cientes : porVoto ? i.votos! : i.abertos;
          const pct = i.destinatarios ? Math.round((base / i.destinatarios) * 100) : 0;
          return (
            <button key={i.id} className={css.card} onClick={() => abrir(i)}>
              <Miniatura i={i} />
              <div style={{ minWidth: 0 }}>
                <h3>
                  {i.titulo}
                  {i.fixado && <span className={`${css.tag} ${css.tagFix}`}>fixado</span>}
                  {i.pedirCiencia && i.status !== 'RASCUNHO' && <span className={`${css.tag} ${css.tagObr}`}>ciência obrigatória</span>}
                  {i.status === 'AGENDADO' && <span className={`${css.tag} ${css.tagAg}`}>agendado · {quando(i.agendadoPara)}</span>}
                  {i.status === 'RASCUNHO' && <span className={`${css.tag} ${css.tagRasc}`}>rascunho</span>}
                  {i.status === 'ARQUIVADO' && <span className={`${css.tag} ${css.tagRasc}`}>arquivado</span>}
                </h3>
                <div className={css.meta}>
                  <span>{i.midias ? i.midias.charAt(0).toUpperCase() + i.midias.slice(1) : 'Texto'}</span><span aria-hidden="true">·</span>
                  <span>{PUBLICO[i.publico.tipo]}{i.destinatarios ? ` (${i.destinatarios})` : ''}</span><span aria-hidden="true">·</span>
                  <span>{i.publicadoEm ? `${quando(i.publicadoEm)}${i.autorNome ? ` por ${i.autorNome}` : ''}` : `editado ${quando(i.atualizadoEm)}`}</span>
                </div>
              </div>
              <div className={css.leit}>
                {i.status === 'PUBLICADO' || i.status === 'ARQUIVADO' ? (<>
                  <small>{i.pedirCiencia ? 'Deram ciência' : porVoto ? 'Votaram' : 'Leram'}</small>
                  <b>{base} de {i.destinatarios}</b>
                  <div className={css.barra} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={i.pedirCiencia ? 'Ciência' : 'Leitura'}>
                    <i className={pct < 90 ? css.meio : ''} style={{ width: `${pct}%` }} />
                  </div>
                </>) : <span className={css.btnSec} aria-hidden="true">{i.status === 'RASCUNHO' ? 'Continuar' : 'Editar'}</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
