import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { salvarBlob } from '../lib/download';
import css from './MeusDocumentos.module.css';

type Status = 'ENVIADO' | 'VISUALIZADO' | 'ASSINADO' | 'RECUSADO';
interface MeuDoc {
  id: string; tipo: 'ESPELHO' | 'CONTRACHEQUE'; status: Status; competencia: string; rotulo: string; arquivoNome: string;
  enviadoEm: string | null; assinadoEm: string | null; recusadoEm: string | null; motivoRecusa: string | null; prazo: string | null; canal: string | null;
}
interface Resp { documentos: MeuDoc[]; pendentes: number }

const NOME = { ESPELHO: 'Espelho de ponto', CONTRACHEQUE: 'Contracheque' };
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mesCurto = (c: string) => MESES[Number(c.slice(5, 7)) - 1] ?? c;
const dia = (iso: string | null) => iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Bahia' }) : '';
const pendente = (d: MeuDoc) => d.status === 'ENVIADO' || d.status === 'VISUALIZADO';
const avisarLayout = () => window.dispatchEvent(new Event('pontosnap:documentos'));

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
  const assinando = useRef<Set<string>>(new Set());

  const carregar = useCallback(async () => {
    try { setR(await api.get<Resp>('/assinaturas/meus')); setErro(null); }
    catch (e) { setErro((e as Error).message); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  // Voltou da Autentique: confere na hora o que foi aberto para assinar.
  useEffect(() => {
    const vis = async () => {
      if (document.visibilityState !== 'visible' || !assinando.current.size) return;
      const ids = [...assinando.current]; assinando.current.clear();
      await Promise.all(ids.map((x) => api.post(`/assinaturas/meus/${x}/conferir`).catch(() => null)));
      await carregar(); avisarLayout();
    };
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, [carregar]);

  async function assinar(d: MeuDoc) {
    setAbrindo(d.id); setErro(null);
    const w = window.open('', '_blank');
    try {
      const { link } = await api.post<{ link: string }>(`/assinaturas/meus/${d.id}/link`);
      assinando.current.add(d.id);
      if (w) w.location.href = link; else window.location.href = link;
    } catch (e) { w?.close(); setErro((e as Error).message); }
    finally { setAbrindo(null); }
  }
  async function baixar(d: MeuDoc) {
    setAbrindo(`b${d.id}`); setErro(null);
    try {
      const blob = await api.baixar(`/assinaturas/meus/${d.id}/arquivo`);
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
        <p className={css.s}>Enviado pelo RH em {dia(atual.enviadoEm)}{atual.prazo && pendente(atual) ? ` · prazo ${dia(atual.prazo)}` : ''}</p>
        <Selo d={atual} />
        {erro && <p className={css.erro} role="alert">{erro}</p>}
        {pendente(atual) && (
          <>
            <p className={css.info}>A assinatura é feita pela Autentique, com validade jurídica.{atual.canal === 'EMAIL' ? ' Você também recebeu o link no seu e-mail.' : atual.canal === 'WHATSAPP' ? ' Você também recebeu o link no WhatsApp.' : ''} Se algo estiver errado, dá para recusar lá e dizer o motivo.</p>
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

  const pend = docs.filter(pendente);
  const resto = docs.filter((d) => !pendente(d));
  const porMes = [...new Set(resto.map((d) => d.competencia))].map((c) => ({ c, rotulo: resto.find((d) => d.competencia === c)!.rotulo, itens: resto.filter((d) => d.competencia === c) }));

  return (
    <div className={`appshell ${css.pagina}`}>
      <h1 className={css.h}>Documentos</h1>
      <p className={css.s}>Espelho de ponto e contracheque de cada mês.</p>
      {erro && <p className={css.erro} role="alert">{erro}</p>}
      {!r && !erro && <div className={css.sk} aria-busy="true"><i /><i /><i /></div>}
      {r && docs.length === 0 && <p className={css.vazio}>Nenhum documento ainda. Quando o RH mandar seu espelho de ponto ou contracheque, eles aparecem aqui.</p>}

      {pend.length > 0 && (
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

      {porMes.map((m) => (
        <section key={m.c}>
          <h2 className={css.mesT}>{m.rotulo}</h2>
          {m.itens.map((d) => (
            <div key={d.id} className={css.dcard}>
              <button type="button" className={css.dcorpo} onClick={() => navegar(`/documentos/${d.id}`)}>
                <span className={`${css.ic} ${d.status === 'ASSINADO' ? css.icOk : css.icEr}`} aria-hidden="true">{d.status === 'ASSINADO' ? '✓' : '!'}</span>
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

function Selo({ d }: { d: MeuDoc }) {
  if (d.status === 'ASSINADO') return <p className={`${css.selo} ${css.seloOk}`}>✓ Assinado em {dia(d.assinadoEm)}</p>;
  if (d.status === 'RECUSADO') return <p className={`${css.selo} ${css.seloEr}`}>Recusado em {dia(d.recusadoEm)}</p>;
  return <p className={`${css.selo} ${css.seloPend}`}>{d.status === 'VISUALIZADO' ? 'Você já abriu · falta assinar' : 'Esperando sua assinatura'}</p>;
}
