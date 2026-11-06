import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { salvarBlob } from '../lib/download';
import { Explica } from '../components/Explica';
import { GrupoEmpresa } from '../components/GrupoEmpresa';
import { paramVinculo, useVinculos, type Vinculo } from '../lib/vinculos';
import css from './MeusDocumentos.module.css';

type Status = 'ENVIADO' | 'VISUALIZADO' | 'ASSINADO' | 'RECUSADO';
interface MeuDoc {
  id: string; tipo: 'ESPELHO' | 'CONTRACHEQUE'; status: Status; competencia: string; rotulo: string; arquivoNome: string;
  enviadoEm: string | null; assinadoEm: string | null; recusadoEm: string | null; motivoRecusa: string | null; prazo: string | null; canal: string | null;
  /** Empresa que mandou (o funcionário pode ter passado por mais de uma do grupo). */
  tenantId?: string; empresa?: string; atual?: boolean;
}
interface Resp { documentos: MeuDoc[]; pendentes: number }

const NOME = { ESPELHO: 'Espelho de ponto', CONTRACHEQUE: 'Contracheque' };
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mesCurto = (c: string) => MESES[Number(c.slice(5, 7)) - 1] ?? c;
const dia = (iso: string | null) => iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Bahia' }) : '';
const pendente = (d: MeuDoc) => d.status === 'ENVIADO' || d.status === 'VISUALIZADO';
const avisarLayout = () => window.dispatchEvent(new Event('pontosnap:documentos'));
/** `?vinculo=` quando o documento é de uma empresa anterior do grupo. */
const pv = (d: MeuDoc) => paramVinculo(d.tenantId ? { tenantId: d.tenantId, atual: d.atual !== false } : null);

/**
 * Documentos do funcionário: espelho de ponto e contracheque que o RH mandou
 * para assinar (pela Autentique). Pendentes no topo; assinados por mês.
 */
export function MeusDocumentos() {
  const { id } = useParams();
  const navegar = useNavigate();
  const [r, setR] = useState<Resp | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const assinando = useRef<Map<string, MeuDoc>>(new Map());
  const vinculos = useVinculos();

  const carregar = useCallback(async () => {
    try { setR(await api.get<Resp>('/assinaturas/meus')); setErro(null); }
    catch (e) { setErro((e as Error).message); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  // Voltou da Autentique: confere na hora o que foi aberto para assinar.
  useEffect(() => {
    const vis = async () => {
      if (document.visibilityState !== 'visible' || !assinando.current.size) return;
      const abertos = [...assinando.current.values()]; assinando.current.clear();
      await Promise.all(abertos.map((d) => api.post(`/assinaturas/meus/${d.id}/conferir${pv(d)}`).catch(() => null)));
      await carregar(); avisarLayout();
    };
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, [carregar]);

  async function assinar(d: MeuDoc) {
    setAbrindo(d.id); setErro(null);
    const w = window.open('', '_blank');
    try {
      const { link } = await api.post<{ link: string }>(`/assinaturas/meus/${d.id}/link${pv(d)}`);
      assinando.current.set(d.id, d);
      if (w) w.location.href = link; else window.location.href = link;
    } catch (e) { w?.close(); setErro((e as Error).message); }
    finally { setAbrindo(null); }
  }
  async function baixar(d: MeuDoc) {
    setAbrindo(`b${d.id}`); setErro(null);
    try {
      const blob = await api.baixar(`/assinaturas/meus/${d.id}/arquivo${pv(d)}`);
      salvarBlob(blob, `${NOME[d.tipo].toLowerCase().replace(/ /g, '_')}_${d.competencia}${d.status === 'ASSINADO' ? '_assinado' : ''}.pdf`);
    } catch (e) { setErro((e as Error).message); }
    finally { setAbrindo(null); }
  }

  const docs = r?.documentos ?? [];
  const atual = id ? docs.find((d) => d.id === id) : null;

  if (id) {
    if (!r) return <div className={`appshell ${css.pagina}`} aria-busy="true" />;
    if (!atual) return (
      <div className={`appshell ${css.pagina}`}>
        <button type="button" className={css.voltar} onClick={() => navegar('/documentos')}>‹ Documentos</button>
        <p className={css.vazio}>Este documento não está mais disponível.</p>
      </div>
    );
    return (
      <div className={`appshell ${css.pagina}`}>
        <button type="button" className={css.voltar} onClick={() => navegar('/documentos')}>‹ Documentos</button>
        <h1 className={css.h}>{NOME[atual.tipo]} · {atual.rotulo.split('/')[0]!.toLowerCase()}</h1>
        <p className={css.s}>{atual.atual === false && atual.empresa ? `${atual.empresa} · ` : ''}Enviado pelo RH em {dia(atual.enviadoEm)}{atual.prazo && pendente(atual) ? ` · prazo ${dia(atual.prazo)}` : ''}</p>
        <Selo d={atual} />
        {erro && <p className={css.erro} role="alert">{erro}</p>}
        {pendente(atual) && (
          <>
            <p className={css.infoLinha}>
              Assinatura pela Autentique
              <Explica>A assinatura é feita pela Autentique, com validade jurídica.{atual.canal === 'EMAIL' ? ' Você também recebeu o link no seu e-mail.' : atual.canal === 'WHATSAPP' ? ' Você também recebeu o link no WhatsApp.' : ''} Se algo estiver errado, dá para recusar lá e dizer o motivo.</Explica>
            </p>
            <button type="button" className={css.btn1} onClick={() => assinar(atual)} disabled={abrindo === atual.id}>{abrindo === atual.id ? 'Abrindo…' : 'Assinar documento'}</button>
          </>
        )}
        {atual.status === 'RECUSADO' && <p className={css.info}>Você recusou{atual.motivoRecusa ? `: "${atual.motivoRecusa}"` : ''}. O RH vai corrigir e mandar de novo.</p>}
        <button type="button" className={pendente(atual) ? css.btn2 : css.btn1} onClick={() => baixar(atual)} disabled={abrindo === `b${atual.id}`}>
          {abrindo === `b${atual.id}` ? 'Baixando…' : atual.status === 'ASSINADO' ? 'Baixar PDF assinado' : 'Baixar PDF'}
        </button>
      </div>
    );
  }

  const grupos = vinculos && vinculos.length > 1 ? vinculos.map((v) => ({ v, itens: docs.filter((d) => (d.tenantId ?? vinculos[0]!.tenantId) === v.tenantId) })) : null;
  const pend = docs.filter(pendente);
  const resto = docs.filter((d) => !pendente(d));
  const porMes = [...new Set(resto.map((d) => d.competencia))].map((c) => ({ c, rotulo: resto.find((d) => d.competencia === c)!.rotulo, itens: resto.filter((d) => d.competencia === c) }));

  return (
    <div className={`appshell ${css.pagina}`}>
      <h1 className={css.h}>Documentos <Explica lado="dir">Espelho de ponto e contracheque de cada mês que o RH mandou para você assinar. Toque num documento para ver os detalhes.</Explica></h1>
      {erro && <p className={css.erro} role="alert">{erro}</p>}
      {!r && !erro && <div className={css.sk} aria-busy="true"><i /><i /><i /></div>}
      {r && grupos && <PorEmpresa grupos={grupos} abrindo={abrindo} onAbrir={(d) => navegar(`/documentos/${d.id}`)} onAssinar={assinar} onBaixar={baixar} />}

      {r && !grupos && docs.length === 0 && <p className={css.vazio}>Nenhum documento ainda. Quando o RH mandar seu espelho de ponto ou contracheque, eles aparecem aqui.</p>}

      {!grupos && pend.length > 0 && (
        <>
          <h2 className={css.mesT}>Para assinar</h2>
          {pend.map((d) => (
            <div key={d.id} className={`${css.dcard} ${css.pend}`}>
              <button type="button" className={css.dcorpo} onClick={() => navegar(`/documentos/${d.id}`)}>
                <span className={css.ic} aria-hidden="true">PDF</span>
                <span><b>{NOME[d.tipo]} · {mesCurto(d.competencia)}</b><small>enviado {dia(d.enviadoEm)}{d.prazo ? ` · prazo ${dia(d.prazo)}` : ''}</small></span>
              </button>
              <button type="button" className={css.assinar} onClick={() => assinar(d)} disabled={abrindo === d.id}>{abrindo === d.id ? '…' : 'Assinar'}</button>
            </div>
          ))}
        </>
      )}

      {!grupos && porMes.map((m) => (
        <section key={m.c}>
          <h2 className={css.mesT}>{m.rotulo}</h2>
          {m.itens.map((d) => (
            <div key={d.id} className={css.dcard}>
              <button type="button" className={css.dcorpo} onClick={() => navegar(`/documentos/${d.id}`)}>
                <span className={`${css.ic} ${d.status === 'ASSINADO' ? '' : css.icEr}`} aria-hidden="true">{d.status === 'ASSINADO' ? 'PDF' : '!'}</span>
                <span><b>{NOME[d.tipo]} · {mesCurto(d.competencia)}</b><small>{d.status === 'ASSINADO' ? `assinado ${dia(d.assinadoEm)}` : `recusado ${dia(d.recusadoEm)}`}</small></span>
              </button>
              <button type="button" className={css.lk} onClick={() => baixar(d)} disabled={abrindo === `b${d.id}`}>{abrindo === `b${d.id}` ? '…' : 'Baixar'}</button>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

/**
 * Transferido entre empresas do grupo: um bloco por empresa (a atual primeiro).
 * O que a empresa anterior ainda pede para assinar continua aqui.
 */
function PorEmpresa({ grupos, abrindo, onAbrir, onAssinar, onBaixar }: {
  grupos: { v: Vinculo; itens: MeuDoc[] }[]; abrindo: string | null;
  onAbrir: (d: MeuDoc) => void; onAssinar: (d: MeuDoc) => void; onBaixar: (d: MeuDoc) => void;
}) {
  return (
    <>
      {grupos.map(({ v, itens }) => {
        const ord = [...itens.filter(pendente), ...itens.filter((d) => !pendente(d))];
        return (
          <section key={v.tenantId}>
            <GrupoEmpresa v={v} />
            {ord.length === 0 && <p className={css.vazioGrupo}>{v.atual ? 'Nada para assinar nesta empresa.' : 'Nenhum documento nesta empresa.'}</p>}
            {ord.map((d) => {
              const p = pendente(d);
              return (
                <div key={d.id} className={`${css.dcard} ${p ? css.pend : ''}`}>
                  <button type="button" className={css.dcorpo} onClick={() => onAbrir(d)}>
                    <span className={`${css.ic} ${p || d.status === 'ASSINADO' ? '' : css.icEr}`} aria-hidden="true">{p || d.status === 'ASSINADO' ? 'PDF' : '!'}</span>
                    <span>
                      <b>{NOME[d.tipo]} · {mesCurto(d.competencia)}</b>
                      <small>
                        <span className={`${css.situacao} ${p ? css.situacaoPend : d.status === 'ASSINADO' ? css.situacaoOk : css.situacaoEr}`}>{p ? 'para assinar' : d.status === 'ASSINADO' ? 'assinado' : 'recusado'}</span>
                        {p ? `enviado em ${dia(d.enviadoEm)}` : d.status === 'ASSINADO' ? `em ${dia(d.assinadoEm)}` : `em ${dia(d.recusadoEm)}`}
                      </small>
                    </span>
                  </button>
                  {p
                    ? <button type="button" className={css.assinar} onClick={() => onAssinar(d)} disabled={abrindo === d.id}>{abrindo === d.id ? '…' : 'Assinar'}</button>
                    : <button type="button" className={css.lk} onClick={() => onBaixar(d)} disabled={abrindo === `b${d.id}`}>{abrindo === `b${d.id}` ? '…' : 'Baixar'}</button>}
                </div>
              );
            })}
          </section>
        );
      })}
      <p className={css.nota}>O que a empresa anterior ainda pede para assinar continua aparecendo aqui, até você assinar.</p>
    </>
  );
}

function Selo({ d }: { d: MeuDoc }) {
  if (d.status === 'ASSINADO') return <p className={`${css.selo} ${css.seloOk}`}>✓ Assinado em {dia(d.assinadoEm)}</p>;
  if (d.status === 'RECUSADO') return <p className={`${css.selo} ${css.seloEr}`}>Recusado em {dia(d.recusadoEm)}</p>;
  return <p className={`${css.selo} ${css.seloPend}`}>{d.status === 'VISUALIZADO' ? 'Você já abriu · falta assinar' : 'Esperando sua assinatura'}</p>;
}
