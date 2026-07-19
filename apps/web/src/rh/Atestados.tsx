import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { hojeSP } from '../lib/formato';
import { prepararArquivo, type ArquivoPronto } from '../lib/imagem';
import type { Documento, StatusDocumento, Empregado, TipoDocumento } from '../tipos';
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

  // --- Lançar atestado no lugar do funcionário ---
  const [emps, setEmps] = useState<Empregado[]>([]);
  const [abrindo, setAbrindo] = useState(false);
  const [lancando, setLancando] = useState(false);
  const [empSel, setEmpSel] = useState('');
  const [tipo, setTipo] = useState<TipoDocumento>('ATESTADO');
  const [inicio, setInicio] = useState(hojeSP());
  const [fim, setFim] = useState(hojeSP());
  const [horas, setHoras] = useState('');
  const [abonar, setAbonar] = useState(true);
  const [arquivo, setArquivo] = useState<ArquivoPronto | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => { try { setEmps(await api.get<Empregado[]>('/empregados')); } catch { /* secundário */ } })();
  }, []);

  const carregar = useCallback(async (f: StatusDocumento | '') => {
    setErro(null);
    try { setDocs(await api.get<Documento[]>(`/documentos${f ? `?status=${f}` : ''}`)); }
    catch (e) { setErro((e as Error).message); }
  }, []);

  useEffect(() => { void carregar(filtro); }, [carregar, filtro]);

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErro(null);
    try { setArquivo(await prepararArquivo(f)); }
    catch (err) { setErro((err as Error).message); }
  }

  async function lancarRh() {
    if (!empSel) { setErro('Escolha o funcionário'); return; }
    if (!arquivo) { setErro('Anexe a foto ou o PDF do atestado'); return; }
    setErro(null); setLancando(true);
    try {
      const min = tipo === 'COMPARECIMENTO' && horas.trim() ? Math.round(Number(horas.replace(',', '.')) * 60) : null;
      await api.post('/documentos/rh', {
        empregadoId: empSel, tipo, dataInicio: inicio,
        dataFim: tipo === 'COMPARECIMENTO' ? inicio : fim, minutos: min, abonar,
        arquivoBase64: arquivo.base64, arquivoNome: arquivo.nome, arquivoMime: arquivo.mime,
      });
      setAbrindo(false); setArquivo(null); setHoras(''); setEmpSel('');
      if (inputRef.current) inputRef.current.value = '';
      await carregar(filtro);
    } catch (e) { setErro((e as Error).message); }
    finally { setLancando(false); }
  }

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

      <button className={css.lancar} onClick={() => { setAbrindo(true); setErro(null); }}>
        Lançar atestado no lugar do funcionário
      </button>

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

      {abrindo && (
        <div className={css.folha} onClick={(e) => e.target === e.currentTarget && setAbrindo(false)}>
          <div className={css.folhaIn}>
            <h3 className={css.folhaH}>Lançar atestado</h3>
            <p className={css.folhaSub}>Para quando o funcionário entrega no papel ou não usa o app.</p>

            <span className={css.lb}>Funcionário</span>
            <select className={css.inp} value={empSel} onChange={(e) => setEmpSel(e.target.value)}>
              <option value="">Escolha…</option>
              {emps.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>

            <span className={css.lb}>Tipo</span>
            <div className={css.chips}>
              {(['ATESTADO', 'COMPARECIMENTO'] as TipoDocumento[]).map((t) => (
                <button key={t} className={`${css.chip} ${tipo === t ? css.chipOn : ''}`} onClick={() => setTipo(t)}>
                  {ROTULO[t]}
                </button>
              ))}
            </div>

            <span className={css.lb}>{tipo === 'COMPARECIMENTO' ? 'Dia' : 'De'}</span>
            <input className={css.inp} type="date" value={inicio} max={hojeSP()}
              onChange={(e) => { setInicio(e.target.value); if (e.target.value > fim) setFim(e.target.value); }} />

            {tipo === 'ATESTADO' ? (
              <>
                <span className={css.lb}>Até</span>
                <input className={css.inp} type="date" value={fim} min={inicio} onChange={(e) => setFim(e.target.value)} />
              </>
            ) : (
              <>
                <span className={css.lb}>Quantas horas</span>
                <input className={css.inp} inputMode="decimal" value={horas} placeholder="4" onChange={(e) => setHoras(e.target.value)} />
              </>
            )}

            <span className={css.lb}>Documento</span>
            <button className={css.upload} onClick={() => inputRef.current?.click()}>
              {arquivo
                ? <><b>{arquivo.nome}</b><span>{kb(arquivo.bytes)} · toque pra trocar</span></>
                : <><b>Foto do papel ou PDF</b><span>a foto é reduzida automaticamente</span></>}
            </button>
            <input ref={inputRef} type="file" accept="image/*,application/pdf" hidden onChange={escolher} />
            {arquivo && arquivo.mime.startsWith('image/') && (
              <img className={css.preview} src={`data:${arquivo.mime};base64,${arquivo.base64}`} alt="Prévia" />
            )}

            <label className={css.abonarLinha}>
              <input type="checkbox" checked={abonar} onChange={(e) => setAbonar(e.target.checked)} />
              <span>Já abonar (o dia deixa de contar como falta). Desmarque para deixar em análise.</span>
            </label>

            <div className={css.acoes}>
              <button className={css.bRc} onClick={() => setAbrindo(false)}>Cancelar</button>
              <button className={css.bAb} onClick={lancarRh} disabled={lancando}>
                {lancando ? 'Lançando…' : 'Lançar atestado'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
