import { useEffect, useState, type ChangeEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { lerNfseXml, type LidoNfse } from '@ponto/shared';
import { api } from '../lib/api';
import { prepararArquivo, type ArquivoPronto } from '../lib/imagem';
import { lerReais } from '../lib/formato';
import { brl, dataBr, dataIsoBr, fmtCnpj, reais, type Conferencia, type Nota } from '../lib/prestador';
import { usePrestador } from './LayoutPrestador';
import css from './Prestador.module.css';

const hoje = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const kb = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const MAX = 5 * 1024 * 1024;

function lerTexto(f: File): Promise<string> {
  return new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => erro(new Error('Não consegui ler o arquivo')); r.readAsText(f); });
}
function paraBase64Texto(s: string) { return btoa(unescape(encodeURIComponent(s))); }

/** Item da conferência (✓ / ✗ / ?). */
function Cl({ ok, titulo, detalhe }: { ok: boolean | null; titulo: string; detalhe?: string }) {
  return (
    <div className={css.cl}>
      <i className={ok === true ? css.sim : ok === false ? css.nao : css.talvez} aria-hidden="true">{ok === true ? '✓' : ok === false ? '✗' : '?'}</i>
      <span>{titulo}{detalhe && <small>{detalhe}</small>}</span>
      <span className="sr-only">{ok === true ? 'ok' : ok === false ? 'não confere' : 'não verificado'}</span>
    </div>
  );
}

/**
 * Enviar a nota: PDF (o melhor), XML da NFS-e (lido na hora) ou foto. Número,
 * data e valor vêm preenchidos quando dá; o prestador confere e envia.
 */
export function EnviarNota() {
  const { id } = useParams();
  const { eu, recarregar } = usePrestador();
  const navegar = useNavigate();
  const nota = eu?.notas.find((n) => n.id === id) ?? null;
  const [arq, setArq] = useState<ArquivoPronto | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [lido, setLido] = useState<LidoNfse | null>(null);
  const [numero, setNumero] = useState('');
  const [data, setData] = useState(hoje());
  const [valor, setValor] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [feito, setFeito] = useState<(Nota & { conferencia: Conferencia }) | null>(null);

  useEffect(() => { if (nota && !valor) setValor(reais(nota.valorCent)); }, [nota?.id]);
  useEffect(() => () => { if (previa) URL.revokeObjectURL(previa); }, [previa]);

  if (!eu) return <div className={css.tela}><div className={css.esqueleto} aria-busy="true" /></div>;
  if (!nota) return <div className={css.tela}><button type="button" className={css.voltar} onClick={() => navegar('/')}>‹ Voltar</button><p className={css.erro}>Nota não encontrada.</p></div>;

  async function escolher(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setErro(null); setLido(null);
    try {
      const ehXml = /xml/.test(f.type) || /\.xml$/i.test(f.name);
      if (ehXml) {
        const txt = await lerTexto(f);
        const l = lerNfseXml(txt);
        if (!l.numero && !l.valorCent) throw new Error('Esse XML não parece uma NFS-e. Envie o PDF da nota.');
        setArq({ base64: paraBase64Texto(txt), nome: f.name, mime: 'application/xml', bytes: f.size });
        setLido(l); setPrevia(null);
        if (l.numero) setNumero(l.numero);
        if (l.data) setData(l.data);
        if (l.valorCent != null) setValor(reais(l.valorCent));
        return;
      }
      const p = await prepararArquivo(f);
      if (p.bytes > MAX) throw new Error('Arquivo maior que 5 MB. Envie um PDF menor.');
      setArq(p);
      setPrevia(p.mime.startsWith('image/') ? URL.createObjectURL(f) : null);
    } catch (x) { setErro((x as Error).message); }
  }

  const valorCent = Math.round(lerReais(valor) * 100);
  const valorDifere = valor.trim() !== '' && valorCent !== nota.valorCent;

  async function enviar() {
    if (!arq || !nota) return;
    setEnviando(true); setErro(null);
    try {
      const r = await api.post<Nota & { conferencia: Conferencia }>(`/portal/eu/notas/${nota.id}/enviar`, {
        arquivoBase64: arq.base64, arquivoNome: arq.nome, arquivoMime: arq.mime, numero: numero.trim(), data, valor: valorCent / 100,
      });
      setFeito(r);
      await recarregar();
      window.scrollTo({ top: 0 });
    } catch (x) { setErro((x as Error).message); }
    finally { setEnviando(false); }
  }

  if (feito) {
    const c = feito.conferencia;
    return (
      <div className={css.tela}>
        <h1 className={css.h}>Nota enviada ✓</h1>
        <p className={css.s}>{nota.rotulo} · {brl(nota.valorCent)}</p>
        <section className={css.card}>
          <h3>Conferência automática</h3>
          <div className={css.chk}>
            <Cl ok={c.valorBate} titulo={c.valorBate ? 'Valor bate com o fechamento' : c.valorBate === false ? 'Valor diferente do fechamento' : 'Valor não verificado'}
              detalhe={feito.nfValorCent != null ? `Esperado ${brl(nota.valorCent)} · na nota ${brl(feito.nfValorCent)}` : undefined} />
            <Cl ok={!c.numeroRepetido} titulo={c.numeroRepetido ? 'Número de nota já usado antes' : 'Número da nota não repetido'} />
            <Cl ok={c.competenciaOk} titulo={c.competenciaOk === false ? 'Data de emissão antes do período' : 'Data de emissão'} />
            {c.origem === 'XML' && <Cl ok={c.tomadorOk} titulo={c.tomadorOk === false ? 'Tomador diferente' : 'Tomador certo'} detalhe={c.lido?.cnpjTomador ? fmtCnpj(c.lido.cnpjTomador) : undefined} />}
            {c.arquivo === 'FOTO' && <Cl ok={null} titulo="Foto: o RH confere a olho" />}
          </div>
        </section>
        <section className={css.card}>
          <h3>Depois de enviar</h3>
          <div className={css.tl}>
            <div className={`${css.tli} ${css.feito}`}><i>✓</i><div><b>{nota.periodo === 'MES' ? 'Mês fechado' : 'Semana fechada'}</b><small>{dataIsoBr(nota.liberadoEm)} · {brl(nota.valorCent)}</small></div></div>
            <div className={`${css.tli} ${css.feito}`}><i>✓</i><div><b>Nota enviada</b><small>agora · o RH confere</small></div></div>
            <div className={`${css.tli} ${css.agora}`}><i>3</i><div><b>Nota aprovada</b><small>você recebe aviso no celular</small></div></div>
            <div className={css.tli}><i>4</i><div><b>Pagamento</b><small>{eu.prestador.chavePix ? `Pix na chave ${eu.prestador.chavePix}` : 'o RH registra quando pagar'}</small></div></div>
          </div>
        </section>
        <button type="button" className={css.btn} onClick={() => navegar('/', { replace: true })}>Voltar ao início</button>
      </div>
    );
  }

  return (
    <div className={css.tela}>
      <button type="button" className={css.voltar} onClick={() => navegar(-1)}>‹ Voltar</button>
      <h1 className={css.h}>Enviar nota · {nota.periodo === 'MES' ? nota.rotulo.split('/')[0]!.toLowerCase() : nota.rotulo.replace('Semana ', 'semana ')}</h1>
      <p className={css.s}>Valor da nota: <b>{brl(nota.valorCent)}</b>{nota.prazo ? ` · prazo ${dataBr(nota.prazo)}` : ''}</p>

      {!arq ? (
        <div className={css.up}>
          <b>Envie o PDF da sua nota</b>
          <small>O PDF que o emissor gera é o melhor. Se só tiver impressa, pode tirar foto.</small>
          <div className={css.upBtns}>
            <label>📄 Escolher PDF<input type="file" accept="application/pdf,.pdf" onChange={escolher} /></label>
            <label>📷 Tirar foto<input type="file" accept="image/*" capture="environment" onChange={escolher} /></label>
          </div>
          <span className={css.xml}>Tem o XML da NFS-e? <label>enviar XML<input type="file" accept=".xml,text/xml,application/xml" onChange={escolher} /></label> (o app lê a nota na hora)</span>
        </div>
      ) : (
        <div className={css.arq}>
          <span className={css.arqIc}>{previa ? <img src={previa} alt="" /> : arq.mime.includes('xml') ? 'XML' : 'PDF'}</span>
          <div><b>{arq.nome}</b><small>{kb(arq.bytes)}</small></div>
          <button type="button" onClick={() => { setArq(null); setLido(null); setPrevia(null); }}>trocar</button>
        </div>
      )}

      {lido && (
        <div className={css.lido} role="status">
          <b>✓ Li a sua nota</b>
          {[lido.numero && `Nº ${lido.numero}`, lido.data && dataBr(lido.data), lido.valorCent != null && brl(lido.valorCent),
            lido.cnpjTomador && `tomador ${fmtCnpj(lido.cnpjTomador)}`].filter(Boolean).join(' · ')}.
          {' '}{lido.valorCent === nota.valorCent ? 'Bate com o valor do fechamento.' : lido.valorCent != null ? 'O valor não bate com o fechamento.' : ''}
        </div>
      )}

      {arq && (
        <>
          <div className={css.duo}>
            <div className={css.campo}>
              <label htmlFor="nf-numero">Número da nota</label>
              <input id="nf-numero" inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={60} autoComplete="off" />
            </div>
            <div className={css.campo}>
              <label htmlFor="nf-data">Data de emissão</label>
              <input id="nf-data" type="date" value={data} onChange={(e) => setData(e.target.value)} max={hoje()} />
            </div>
          </div>
          <div className={css.campo}>
            <label htmlFor="nf-valor">Valor da nota (R$)</label>
            <input id="nf-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} aria-describedby="nf-valor-ajuda" />
            <small id="nf-valor-ajuda">{valorDifere ? `⚠ Diferente do fechamento (${brl(nota.valorCent)}). O RH pode pedir outra nota.` : 'Igual ao valor do fechamento.'}</small>
          </div>
        </>
      )}

      {erro && <div className={css.erro} role="alert">{erro}</div>}
      <button type="button" className={css.btn} disabled={!arq || !numero.trim() || !data || enviando} onClick={enviar}>
        {enviando ? 'Enviando…' : 'Enviar para o RH'}
      </button>
    </div>
  );
}
