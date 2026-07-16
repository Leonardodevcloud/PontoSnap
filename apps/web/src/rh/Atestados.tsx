import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Documento, StatusDocumento } from '../tipos';
import css from './Atestados.module.css';

const fmtData = (d: string) => new Date(`${d}T12:00:00-0300`).toLocaleDateString('pt-BR');
const fmtQuando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const kb = (b: number) => `${Math.round(b / 1024)} KB`;

const ROTULO: Record<string, string> = { ATESTADO: 'Atestado médico', COMPARECIMENTO: 'Comparecimento' };
const STATUS: Record<string, string> = { EM_ANALISE: 'Em análise', ABONADO: 'Abonado', RECUSADO: 'Recusado' };

const FILTROS: { v: StatusDocumento | ''; t: string }[] = [
  { v: 'EM_ANALISE', t: 'Aguardando' },
  { v: 'ABONADO', t: 'Abonados' },
  { v: 'RECUSADO', t: 'Recusados' },
  { v: '', t: 'Todos' },
];

function periodo(d: Documento): string {
  if (d.minutos != null) return `${fmtData(d.dataInicio)} · ${Math.floor(d.minutos / 60)}h${String(d.minutos % 60).padStart(2, '0')}`;
  if (d.dataInicio === d.dataFim) return `${fmtData(d.dataInicio)} · 1 dia`;
  return `${fmtData(d.dataInicio)} a ${fmtData(d.dataFim)}`;
}

export function Atestados() {
  const [filtro, setFiltro] = useState<StatusDocumento | ''>('EM_ANALISE');
  const [docs, setDocs] = useState<Documento[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [recusando, setRecusando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');

  const carregar = useCallback(async (f: StatusDocumento | '') => {
    setErro(null);
    try { setDocs(await api.get<Documento[]>(`/documentos${f ? `?status=${f}` : ''}`)); }
    catch (e) { setErro((e as Error).message); }
  }, []);

  useEffect(() => { void carregar(filtro); }, [carregar, filtro]);

  async function ver(id: string) {
    try {
      const blob = await api.baixar(`/documentos/${id}/arquivo`);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { setErro((e as Error).message); }
  }

  async function decidir(id: string, status: 'ABONADO' | 'RECUSADO', motivoRecusa?: string) {
    setErro(null);
    try {
      await api.post(`/documentos/${id}/decidir`, { status, motivoRecusa });
      setRecusando(null); setMotivo('');
      await carregar(filtro);
    } catch (e) { setErro((e as Error).message); }
  }

  return (
    <div className={css.tela}>
      <h2 className={css.h}>Atestados</h2>
      <p className={css.sub}>
        Abonar aqui faz o dia deixar de contar como falta na apuração.
        <strong> Não é aprovar marcação</strong> — marcação não se aprova; a decisão é sobre a ausência.
      </p>

      {erro && <p className={css.erro}>{erro}</p>}

      <div className={css.filtros}>
        {FILTROS.map((f) => (
          <button
            key={f.v || 'todos'} className={`${css.filtro} ${filtro === f.v ? css.filtroOn : ''}`}
            onClick={() => setFiltro(f.v)}
          >{f.t}</button>
        ))}
      </div>

      {docs.length === 0 && <p className={css.vazio}>Nada por aqui.</p>}

      {docs.map((d) => (
        <div key={d.id} className={css.rev}>
          <div className={css.revTop}>
            <div>
              <div className={css.revN}>{d.nome}</div>
              <div className={css.revD}>
                {ROTULO[d.tipo] ?? d.tipo} · {periodo(d)} · enviado {fmtQuando(d.enviadoEm)}
              </div>
            </div>
            <span className={`${css.st} ${css[`st${d.status}`]}`}>{STATUS[d.status]}</span>
          </div>

          <button className={css.arq} onClick={() => ver(d.id)}>
            <span className={css.arqIco}>📄</span>
            <b>{d.arquivoNome}</b>
            <span className={css.arqL}>{kb(d.arquivoBytes)} · abrir</span>
          </button>

          {d.motivoRecusa && <div className={css.mot}>Motivo: {d.motivoRecusa}</div>}

          {d.status === 'EM_ANALISE' && recusando !== d.id && (
            <div className={css.acoes}>
              <button className={css.bAb} onClick={() => decidir(d.id, 'ABONADO')}>Abonar a ausência</button>
              <button className={css.bRc} onClick={() => { setRecusando(d.id); setMotivo(''); }}>Recusar</button>
            </div>
          )}

          {recusando === d.id && (
            <div className={css.recusa}>
              <input
                className={css.inp} value={motivo} maxLength={200} autoFocus
                placeholder="Por que está recusando? O funcionário vai ler isso."
                onChange={(e) => setMotivo(e.target.value)}
              />
              <div className={css.acoes}>
                <button
                  className={css.bRcFirme} disabled={!motivo.trim()}
                  onClick={() => decidir(d.id, 'RECUSADO', motivo)}
                >Confirmar recusa</button>
                <button className={css.bRc} onClick={() => setRecusando(null)}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      ))}

      <div className={css.lgpd}>
        <strong>Dado sensível.</strong> Atestado com CID é dado de saúde na LGPD: fica cifrado no banco,
        isolado por empresa, e só o RH desta empresa e o próprio funcionário conseguem abrir.
        Todo acesso ao arquivo passa pelo login — não existe link público.
      </div>
    </div>
  );
}
