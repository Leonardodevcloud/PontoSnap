import { useEffect, useState, type ChangeEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { lerNfseXml } from '@ponto/shared';
import { api } from '../lib/api';
import { prepararArquivo, type ArquivoPronto } from '../lib/imagem';
import { lerReais } from '../lib/formato';
import { brl, dataBr, dataIsoBr, fmtCnpj, reais, type Conferencia, type Eu, type Nota } from '../lib/prestador';
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
function Cl({ ok, titulo, detalhe, aviso }: { ok: boolean | null; titulo: string; detalhe?: string; aviso?: boolean }) {
  return (
    <div className={css.cl}>
      <i className={ok === true ? css.sim : aviso ? css.avisoI : ok === false ? css.nao : css.talvez} aria-hidden="true">{ok === true ? '✓' : aviso ? '!' : ok === false ? '✗' : '?'}</i>
      <span>{titulo}{detalhe && <small>{detalhe}</small>}</span>
      <span className="sr-only">{ok === true ? 'ok' : ok === false ? 'não confere' : 'não verificado'}</span>
    </div>
  );
}

/** O que a API leu do arquivo (prévia, antes de enviar). */
interface Lido { numero: string | null; data: string | null; valorCent: number | null; cnpjPrestador: string | null; cnpjTomador: string | null; codigoServico?: string | null; descricao?: string | null }
interface Leitura { lido: Lido | null; conferencia: Conferencia | null }
interface ItemConf { ok: boolean | null; titulo: string; detalhe?: string; /** Só avisa (não é problema): o RH decide. */ aviso?: boolean }

const curto = (t: string | null | undefined, n = 70) => (!t ? '—' : t.length > n ? `…${t.slice(-n)}` : t);
const normPal = (w: string) => w.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9/]/g, '');
/** Palavras do pedido que não estão na nota (ex.: "(13/10 e 16/10)"). */
function faltouNaNota(pedido: string, nota: string | null | undefined): string | null {
  const resto = new Map<string, number>();
  for (const w of (nota ?? '').split(/\s+/).map(normPal).filter(Boolean)) resto.set(w, (resto.get(w) ?? 0) + 1);
  const faltam = pedido.split(/\s+/).filter((w) => { const k = normPal(w); if (!k) return false; const n = resto.get(k) ?? 0; if (n > 0) { resto.set(k, n - 1); return false; } return true; });
  return faltam.length && faltam.length <= 12 ? faltam.join(' ') : null;
}
const nomeCurto = (r: string) => r.split(' ').filter((w, i) => i < 3 && !(i === 2 && /^(de|da|do|e)$/i.test(w))).slice(0, 3).join(' ').replace(/\s+(de|da|do|e)$/i, '');

/** Itens da conferência a partir do que foi lido (só mostra o que deu para checar). */
function itensConferencia(c: Conferencia, nota: Nota, eu: Eu): ItemConf[] {
  const l = c.lido ?? {};
  const r: ItemConf[] = [];
  if (c.valorBate !== null) r.push(c.valorBate
    ? { ok: true, titulo: 'Valor igual ao fechamento', detalhe: brl(nota.valorCent) }
    : { ok: false, titulo: 'Valor diferente do fechamento', detalhe: `na nota ${l.valorCent != null ? brl(l.valorCent) : '—'} · esperado ${brl(nota.valorCent)}` });
  if (l.cnpjPrestador) r.push(c.prestadorOk === false
    ? { ok: false, titulo: 'Emitida em outro CNPJ', detalhe: `na nota ${fmtCnpj(l.cnpjPrestador)}${eu.prestador.documento ? ` · o seu ${fmtCnpj(eu.prestador.documento)}` : ''}` }
    : { ok: c.prestadorOk, titulo: 'Emitida no seu CNPJ', detalhe: fmtCnpj(l.cnpjPrestador) });
  const tom = nota.pedido ? { nome: nota.pedido.tomador.razao, cnpj: nota.pedido.tomador.cnpj } : eu.tomador;
  if (l.cnpjTomador) r.push(c.tomadorOk === false
    ? { ok: false, titulo: 'Emitida para outra empresa', detalhe: `na nota ${fmtCnpj(l.cnpjTomador)} · certo ${fmtCnpj(tom.cnpj)}` }
    : { ok: c.tomadorOk, titulo: 'Para a empresa certa', detalhe: `${nomeCurto(tom.nome)} · ${fmtCnpj(l.cnpjTomador)}` });
  const pedido = nota.pedido;
  if (pedido?.codigoServico && c.codigoOk != null) r.push(c.codigoOk
    ? { ok: true, titulo: 'Código do serviço', detalhe: pedido.codigoServico }
    : { ok: false, titulo: 'Código do serviço diferente', detalhe: `na nota ${l.codigoServico ?? '—'} · pedido ${pedido.codigoServico}` });
  if (pedido && c.descricaoOk != null) r.push(c.descricaoOk
    ? { ok: true, titulo: 'Descrição igual à pedida' }
    : { ok: false, aviso: true, titulo: 'Descrição diferente da pedida', detalhe: (() => {
      const f = faltouNaNota(pedido.descricao, l.descricao);
      return f ? `Faltou na nota: "${f}"` : `na nota "${curto(l.descricao)}" · pedido "${curto(pedido.descricao)}"`;
    })() });
  if (l.data) r.push(c.competenciaOk === false
    ? { ok: false, titulo: 'Emitida antes do serviço', detalhe: `emitida em ${dataBr(l.data)}` }
    : { ok: true, titulo: 'Emitida depois do serviço', detalhe: `emitida em ${dataBr(l.data)}` });
  if (c.numeroRepetido) r.push({ ok: false, titulo: 'Número de nota já usado antes', detalhe: l.numero ? `nº ${l.numero}` : undefined });
  return r;
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
  const [lendo, setLendo] = useState(false);
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const lido = leitura?.lido ?? null;
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

  /** Manda o arquivo para a API ler e conferir (não grava) e preenche os campos. */
  async function ler(a: ArquivoPronto) {
    if (!nota) return;
    setLendo(true); setLeitura(null);
    try {
      const r = await api.post<Leitura>(`/portal/eu/notas/${nota.id}/ler`, { arquivoBase64: a.base64, arquivoMime: a.mime });
      setLeitura(r);
      if (r.lido?.numero) setNumero(r.lido.numero);
      if (r.lido?.data) setData(r.lido.data);
      if (r.lido?.valorCent != null) setValor(reais(r.lido.valorCent));
    } catch { setLeitura({ lido: null, conferencia: null }); }
    finally { setLendo(false); }
  }

  async function escolher(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setErro(null); setLeitura(null); setNumero(''); setData(hoje());
    if (nota) setValor(reais(nota.valorCent));
    try {
      const ehXml = /xml/.test(f.type) || /\.xml$/i.test(f.name);
      if (ehXml) {
        const txt = await lerTexto(f);
        const l = lerNfseXml(txt);
        if (!l.numero && !l.valorCent) throw new Error('Esse XML não parece uma NFS-e. Envie o PDF da nota.');
        const a: ArquivoPronto = { base64: paraBase64Texto(txt), nome: f.name, mime: 'application/xml', bytes: f.size };
        setArq(a); setPrevia(null);
        await ler(a);
        return;
      }
      // Alguns celulares mandam o PDF sem tipo: confia na extensão.
      const arquivo = !f.type && /\.pdf$/i.test(f.name) ? new File([f], f.name, { type: 'application/pdf' }) : f;
      const p = await prepararArquivo(arquivo);
      if (p.bytes > MAX) throw new Error('Arquivo maior que 5 MB. Envie um PDF menor.');
      setArq(p);
      setPrevia(p.mime.startsWith('image/') ? URL.createObjectURL(arquivo) : null);
      if (p.mime === 'application/pdf') await ler(p);
    } catch (x) { setErro((x as Error).message); }
  }

  const valorCent = Math.round(lerReais(valor) * 100);
  const valorDifere = valor.trim() !== '' && valorCent !== nota.valorCent;
  const conf = leitura?.conferencia ?? null;
  const itensConf = conf ? itensConferencia(conf, nota, eu) : [];
  const problemas = itensConf.filter((i) => i.ok === false && !i.aviso);
  const avisos = itensConf.filter((i) => i.aviso);
  const fonte = arq?.mime.includes('xml') ? 'do XML' : 'do PDF';
  const valorDoArq = lido?.valorCent != null && valor.trim() !== '' && valorCent === lido.valorCent;

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
            {c.origem !== 'INFORMADO' && c.lido?.cnpjTomador && <Cl ok={c.tomadorOk} titulo={c.tomadorOk === false ? 'Tomador diferente' : 'Tomador certo'} detalhe={c.lido?.cnpjTomador ? fmtCnpj(c.lido.cnpjTomador) : undefined} />}
            {c.codigoOk != null && <Cl ok={c.codigoOk} titulo={c.codigoOk ? 'Código do serviço certo' : 'Código do serviço diferente'} detalhe={c.lido?.codigoServico ?? undefined} />}
            {c.descricaoOk != null && <Cl ok={c.descricaoOk} aviso={!c.descricaoOk} titulo={c.descricaoOk ? 'Descrição igual à pedida' : 'Descrição diferente da pedida (o RH decide)'} />}
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
          <button type="button" onClick={() => { setArq(null); setLeitura(null); setPrevia(null); setNumero(''); setData(hoje()); setValor(reais(nota.valorCent)); }}>trocar</button>
        </div>
      )}

      {lendo && (
        <div className={css.lendo} role="status" aria-live="polite">
          <span className={css.spin} aria-hidden="true" />
          <div><b>Lendo sua nota…</b><small>número, data, valor e CNPJs</small></div>
        </div>
      )}

      {!lendo && arq?.mime === 'application/pdf' && leitura && !leitura.lido && (
        <div className={`${css.alerta} ${css.alertaInfo}`} role="status">
          <b>Não consegui ler esse PDF sozinho</b>
          Pode ser uma nota escaneada. Preencha os dados abaixo, que o RH confere olhando o arquivo.
        </div>
      )}

      {!lendo && conf && problemas.length > 0 && (
        <div className={css.alerta} role="alert">
          <b>{problemas.length === 1 ? 'Essa nota tem 1 problema' : `Essa nota tem ${problemas.length} problemas`}</b>
          O mais seguro é emitir de novo e enviar o arquivo certo. Se enviar assim, o RH provavelmente vai recusar.
        </div>
      )}

      {!lendo && conf && itensConf.length > 0 && (
        <section className={css.card} aria-label="Conferência da nota">
          {problemas.length === 0 && <h3><span style={{ color: 'var(--ok-text)' }}>✓</span> {conf.valorBate && avisos.length === 0 ? 'Li sua nota e está tudo certo' : 'Li sua nota'}</h3>}
          <div className={css.chk}>
            {itensConf.map((i) => <Cl key={i.titulo} ok={i.ok} titulo={i.titulo} detalhe={i.detalhe} aviso={i.aviso} />)}
          </div>
          {problemas.length === 0 && avisos.length > 0 && (
            <p className={css.avisoTxt}>A descrição não bate com o pedido. Você pode enviar assim mesmo (o RH decide) ou emitir de novo com o texto de "Dados para emitir a nota".</p>
          )}
        </section>
      )}

      {arq && (
        <>
          <div className={css.duo}>
            <div className={css.campo}>
              <label htmlFor="nf-numero">Número da nota{lido?.numero && numero === lido.numero && <em className={css.doArq}>{fonte}</em>}</label>
              <input id="nf-numero" inputMode="numeric" className={lido?.numero && numero === lido.numero ? css.auto : undefined} value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={60} autoComplete="off" />
            </div>
            <div className={css.campo}>
              <label htmlFor="nf-data">Data de emissão{lido?.data && data === lido.data && <em className={css.doArq}>{fonte}</em>}</label>
              <input id="nf-data" type="date" className={lido?.data && data === lido.data ? css.auto : undefined} value={data} onChange={(e) => setData(e.target.value)} max={hoje()} />
            </div>
          </div>
          <div className={css.campo}>
            <label htmlFor="nf-valor">Valor da nota (R$){valorDoArq && <em className={css.doArq}>{fonte}</em>}</label>
            <input id="nf-valor" inputMode="decimal" className={valorDoArq ? css.auto : undefined} value={valor} onChange={(e) => setValor(e.target.value)} aria-describedby="nf-valor-ajuda" />
            <small id="nf-valor-ajuda">{valorDifere ? `⚠ Diferente do fechamento (${brl(nota.valorCent)}). O RH pode pedir outra nota.` : 'Igual ao valor do fechamento.'}</small>
          </div>
        </>
      )}

      {erro && <div className={css.erro} role="alert">{erro}</div>}
      {problemas.length > 0 && !lendo ? (
        <>
          <label className={`${css.btn} ${css.btnArq}`}>Trocar o arquivo
            <input type="file" accept="application/pdf,.pdf,.xml,text/xml,application/xml" onChange={escolher} />
          </label>
          <button type="button" className={css.linkBtn} disabled={!numero.trim() || !data || enviando} onClick={enviar}>
            {enviando ? 'Enviando…' : 'Enviar assim mesmo'}
          </button>
        </>
      ) : (
        <button type="button" className={css.btn} disabled={!arq || lendo || !numero.trim() || !data || enviando} onClick={enviar}>
          {enviando ? 'Enviando…' : 'Enviar para o RH'}
        </button>
      )}
    </div>
  );
}
