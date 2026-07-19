import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { hojeSP } from '../lib/formato';
import { prepararArquivo, type ArquivoPronto } from '../lib/imagem';
import type { Documento, TipoDocumento } from '../tipos';
import css from './MeusAtestados.module.css';

const fmtData = (d: string) => new Date(`${d}T12:00:00-0300`).toLocaleDateString('pt-BR');
const kb = (b: number) => `${Math.round(b / 1024)} KB`;

const ROTULO: Record<string, string> = { ATESTADO: 'Atestado médico', COMPARECIMENTO: 'Comparecimento' };
const STATUS: Record<string, string> = { EM_ANALISE: 'Em análise', ABONADO: 'Abonado', RECUSADO: 'Recusado' };

function periodo(d: Documento): string {
  if (d.minutos != null) return `${fmtData(d.dataInicio)} · ${Math.floor(d.minutos / 60)}h${String(d.minutos % 60).padStart(2, '0')}`;
  if (d.dataInicio === d.dataFim) return `${fmtData(d.dataInicio)} · 1 dia`;
  return `${fmtData(d.dataInicio)} a ${fmtData(d.dataFim)}`;
}

export function MeusAtestados() {
  const [docs, setDocs] = useState<Documento[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const [tipo, setTipo] = useState<TipoDocumento>('ATESTADO');
  const [inicio, setInicio] = useState(hojeSP());
  const [fim, setFim] = useState(hojeSP());
  const [horas, setHoras] = useState('');
  const [arquivo, setArquivo] = useState<ArquivoPronto | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    try { setDocs(await api.get<Documento[]>('/documentos/meus')); }
    catch (e) { setErro((e as Error).message); }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErro(null);
    try { setArquivo(await prepararArquivo(f)); }
    catch (err) { setErro((err as Error).message); }
  }

  async function enviar() {
    if (!arquivo) { setErro('Anexe a foto ou o PDF do documento'); return; }
    setErro(null); setEnviando(true);
    try {
      const min = tipo === 'COMPARECIMENTO' && horas.trim() ? Math.round(Number(horas.replace(',', '.')) * 60) : null;
      await api.post('/documentos', {
        tipo, dataInicio: inicio, dataFim: tipo === 'COMPARECIMENTO' ? inicio : fim,
        minutos: min,
        arquivoBase64: arquivo.base64, arquivoNome: arquivo.nome, arquivoMime: arquivo.mime,
      });
      setAbrindo(false); setArquivo(null); setHoras('');
      if (inputRef.current) inputRef.current.value = '';
      await carregar();
    } catch (e) { setErro((e as Error).message); }
    finally { setEnviando(false); }
  }

  async function ver(id: string) {
    try {
      const blob = await api.baixar(`/documentos/${id}/arquivo`);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { setErro((e as Error).message); }
  }

  return (
    <div className="appshell">
      <div className={css.h}>Atestados</div>
      <div className={css.s}>Mande o documento e acompanhe o que o RH decidiu.</div>

      {erro && <p className={css.erro}>{erro}</p>}

      <button className={css.enviar} onClick={() => setAbrindo(true)}>Enviar atestado</button>

      {docs.length === 0 && <div className={css.vazio}>Você ainda não enviou nenhum documento.</div>}

      {docs.map((d) => (
        <div key={d.id} className={css.doc}>
          <div className={css.docTop}>
            <div>
              <button className={css.docT} onClick={() => ver(d.id)}>{ROTULO[d.tipo] ?? d.tipo}</button>
              <div className={css.docD}>{periodo(d)} · {kb(d.arquivoBytes)}</div>
            </div>
            <span className={`${css.st} ${css[`st${d.status}`]}`}>{STATUS[d.status]}</span>
          </div>
          {d.motivoRecusa && <div className={css.docMot}>RH: {d.motivoRecusa}</div>}
        </div>
      ))}

      {abrindo && (
        <div className={css.folha} onClick={(e) => e.target === e.currentTarget && setAbrindo(false)}>
          <div className={css.folhaIn}>
            <h3 className={css.folhaH}>Enviar atestado</h3>

            <span className={css.lb}>Tipo</span>
            <div className={css.chips}>
              {(['ATESTADO', 'COMPARECIMENTO'] as TipoDocumento[]).map((t) => (
                <button
                  key={t} className={`${css.chip} ${tipo === t ? css.chipOn : ''}`}
                  onClick={() => setTipo(t)}
                >{ROTULO[t]}</button>
              ))}
            </div>

            <span className={css.lb}>{tipo === 'COMPARECIMENTO' ? 'Dia' : 'De'}</span>
            <input className={css.inp} type="date" value={inicio} max={hojeSP()}
              onChange={(e) => { setInicio(e.target.value); if (e.target.value > fim) setFim(e.target.value); }} />

            {tipo === 'ATESTADO' ? (
              <>
                <span className={css.lb}>Até</span>
                <input className={css.inp} type="date" value={fim} min={inicio}
                  onChange={(e) => setFim(e.target.value)} />
              </>
            ) : (
              <>
                <span className={css.lb}>Quantas horas</span>
                <input className={css.inp} inputMode="decimal" value={horas} placeholder="4"
                  onChange={(e) => setHoras(e.target.value)} />
              </>
            )}

            <span className={css.lb}>Documento</span>
            <button className={css.upload} onClick={() => inputRef.current?.click()}>
              {arquivo
                ? <><b>{arquivo.nome}</b><span>{kb(arquivo.bytes)} · toque pra trocar</span></>
                : <><b>Tirar foto, escolher da galeria ou anexar PDF</b><span>a foto é reduzida no seu aparelho</span></>}
            </button>
            <input
              ref={inputRef} type="file" accept="image/*,application/pdf"
              hidden onChange={escolher}
            />

            {arquivo && arquivo.mime.startsWith('image/') && (
              <img className={css.preview} src={`data:${arquivo.mime};base64,${arquivo.base64}`} alt="Prévia do documento" />
            )}
            {arquivo && arquivo.mime === 'application/pdf' && (
              <div className={css.previewPdf}>📄 PDF anexado — {arquivo.nome}</div>
            )}

            <div className={css.lgpd}>
              🔒 Seu atestado é dado de saúde. Fica guardado <b>cifrado</b> e só o RH da sua
              empresa consegue abrir.
            </div>

            <div className={css.acoes}>
              <button className={css.bNo} onClick={() => setAbrindo(false)}>Cancelar</button>
              <button className={css.bOk} onClick={enviar} disabled={enviando}>
                {enviando ? 'Enviando…' : 'Enviar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
