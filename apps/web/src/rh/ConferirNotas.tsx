import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { brl, dataBr, dataIsoBr, fmtCnpj, type Conferencia, type NotaFila } from '../lib/prestador';
import { Rosto } from './Prestadores';
import { VisorNota, type FonteNota } from '../components/VisorNota';
import css from './Prestadores.module.css';

const MOTIVOS = ['Valor diferente', 'Tomador errado', 'Código do serviço errado', 'Descrição diferente da pedida', 'Competência errada', 'Ilegível', 'Número repetido'];

function marca(n: NotaFila): { texto: string; tom: string } {
  const c = n.conferencia;
  if (!c) return { texto: 'conferir', tom: 'cz' };
  if (c.arquivo === 'FOTO') return { texto: 'foto', tom: 'av' };
  if (c.valorBate === false) return { texto: 'valor ≠', tom: 'er' };
  if (c.codigoOk === false) return { texto: 'código ≠', tom: 'er' };
  if (!c.bate) return { texto: 'olhar', tom: 'av' };
  if (c.descricaoOk === false) return { texto: 'descrição ≠', tom: 'av' };
  return { texto: 'bate', tom: 'ok' };
}

/** Arquivo da nota (PDF, imagem ou XML) dentro da tela. */
/** Baixa o arquivo da nota e entrega para o visor (PDF desenhado na tela, com zoom). */
function Visor({ n, ampliado, onAmpliar }: { n: NotaFila; ampliado: boolean; onAmpliar: () => void }) {
  const [fonte, setFonte] = useState<FonteNota | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const a = n.nf.arquivo;
  useEffect(() => {
    setFonte(null); setErro(null);
    if (!a) return;
    let u = ''; let vivo = true;
    api.baixar(`/pessoal/nf/${a.id}`).then(async (b) => {
      if (!vivo) return;
      if (a.mime.includes('xml')) { setFonte({ tipo: 'xml', texto: await b.text() }); return; }
      u = URL.createObjectURL(new Blob([b], { type: a.mime }));
      setFonte(a.mime === 'application/pdf' ? { tipo: 'pdf', dados: await b.arrayBuffer(), url: u } : { tipo: 'img', url: u });
    }).catch((e) => setErro((e as Error).message));
    return () => { vivo = false; if (u) URL.revokeObjectURL(u); };
  }, [a?.id]);
  if (!a) return <div className={css.visorVazio}><p>Sem arquivo.</p></div>;
  if (erro) return <div className={css.visorVazio}><p>{erro}</p></div>;
  return <VisorNota fonte={fonte} titulo={`Nota de ${n.nome}`} ampliado={ampliado} onAmpliar={onAmpliar} />;
}

function Cl({ ok, titulo, det }: { ok: boolean | null; titulo: string; det?: string }) {
  return (
    <div className={css.cl}>
      <i className={ok === true ? css.s : ok === false ? css.n : css.q} aria-hidden="true">{ok === true ? '✓' : ok === false ? '✗' : '?'}</i>
      <span>{titulo}{det && <small>{det}</small>}</span>
    </div>
  );
}

/**
 * Conferir notas em sequência: fila à esquerda, a nota no meio e a
 * conferência automática à direita. Atalhos: A aprova, R recusa, ↓/↑ navega.
 */
const faltas = (c: Conferencia) => [c.valorBate, c.prestadorOk, c.tomadorOk, c.codigoOk, c.competenciaOk, !c.numeroRepetido].filter((x) => x === false).length;

/** Linha da conferência: o que está na nota e, quando diverge, o esperado. */
/** Palavras de `a` que não aparecem em `b` (sem acento/pontuação) ficam marcadas. */
const normPal = (w: string) => w.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9/]/g, '');
function marcarDiferenca(a: string, b: string): ReactNode {
  const resto = new Map<string, number>();
  for (const w of b.split(/\s+/).map(normPal).filter(Boolean)) resto.set(w, (resto.get(w) ?? 0) + 1);
  return a.split(/(\s+)/).map((w, i) => {
    const k = normPal(w);
    if (!k) return w;
    const n = resto.get(k) ?? 0;
    if (n > 0) { resto.set(k, n - 1); return w; }
    return <mark key={i}>{w}</mark>;
  });
}

function LinhaConf({ ok, rot, nota, esp, aviso, texto }: { ok: boolean | null; rot: string; nota: string; esp: string; aviso?: boolean; texto?: boolean }) {
  const so = aviso && ok === false;
  return (
    <tr className={ok === false && !so ? css.confRuim : ok === null || so ? css.confTalvez : undefined}>
      <td className={css.confSt}><span aria-hidden="true">{ok === true ? '✓' : so ? '!' : ok === false ? '✗' : '?'}</span><span className="sr-only">{ok === true ? 'confere' : so ? 'difere (você decide)' : ok === false ? 'não confere' : 'não verificado'}</span></td>
      <td className={css.confRot}>{rot}</td>
      <td>
        <span className={`${css.confV} ${texto ? css.confTexto : ''}`}>{texto && ok === false ? marcarDiferenca(nota, esp) : nota}</span>
        {ok !== true && <small className={`${css.confEsp} ${texto ? css.confTexto : ''}`}>{so ? 'pedido:' : 'esperado'} {texto && ok === false ? marcarDiferenca(esp, nota) : esp}</small>}
      </td>
    </tr>
  );
}

export function ConferirNotas() {
  const navegar = useNavigate();
  const [fila, setFila] = useState<NotaFila[] | null>(null);
  const [atual, setAtual] = useState<string | null>(null);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [outro, setOutro] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const recusarRef = useRef<HTMLButtonElement>(null);
  const [ampliado, setAmpliado] = useState(() => { try { return localStorage.getItem('pontosnap.conferir.ampliado') === '1'; } catch { return false; } });
  const alternarAmpliado = () => setAmpliado((v) => { try { localStorage.setItem('pontosnap.conferir.ampliado', v ? '0' : '1'); } catch { /* sem storage */ } return !v; });

  const carregar = useCallback(async (manter?: string | null) => {
    try {
      const f = await api.get<NotaFila[]>('/portal/rh/conferir');
      setFila(f);
      setAtual((a) => {
        const quer = manter !== undefined ? manter : a;
        return quer && f.some((x) => x.id === quer) ? quer : f[0]?.id ?? null;
      });
    } catch (e) { setErro((e as Error).message); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);
  const n = fila?.find((x) => x.id === atual) ?? null;
  const idx = fila && n ? fila.indexOf(n) : -1;
  // Lote só com as que batem em tudo (descrição diferente o RH olha uma a uma).
  const batem = (fila ?? []).filter((x) => x.conferencia?.bate && x.conferencia.descricaoOk !== false);

  const proximoId = () => (fila && idx >= 0 ? (fila[idx + 1] ?? fila[idx - 1])?.id ?? null : null);
  async function aprovar(ids: string[]) {
    if (!ids.length) return;
    setOcupado(true); setErro(null);
    const prox = ids.length === 1 ? proximoId() : null;
    try {
      const r = await api.post<{ aprovadas: number }>('/portal/rh/aprovar', { ids });
      setMsg(`${r.aprovadas} ${r.aprovadas === 1 ? 'nota aprovada' : 'notas aprovadas'}. O prestador recebe o aviso.`);
      setMotivo(null); setOutro('');
      await carregar(prox);
    } catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  }
  async function recusar() {
    if (!n) return;
    const m = motivo === 'Outro' ? outro.trim() : motivo === 'Valor diferente' && n.nfValorCent != null
      ? `Valor diferente: a nota veio com ${brl(n.nfValorCent)} e o valor de ${n.rotulo.toLowerCase()} é ${brl(n.valorCent)}.` : motivo;
    if (!m) { setErro('Escolha o motivo — o prestador vê no app.'); return; }
    setOcupado(true); setErro(null);
    const prox = proximoId();
    try {
      await api.post(`/portal/rh/notas/${n.id}/recusar`, { motivo: m });
      setMsg(`Nota de ${n.nome} recusada. Ele recebe o motivo no celular e reenvia.`);
      setMotivo(null); setOutro('');
      await carregar(prox);
    } catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  }

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName) || e.metaKey || e.ctrlKey || e.altKey || !fila || !n || ocupado) return;
      if (e.key === 'a' || e.key === 'A') { e.preventDefault(); void aprovar([n.id]); }
      else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); if (!motivo) setMotivo('Valor diferente'); recusarRef.current?.focus(); }
      else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); alternarAmpliado(); }
      else if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); const p = fila[idx + 1]; if (p) { setAtual(p.id); setMotivo(null); } }
      else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); const p = fila[idx - 1]; if (p) { setAtual(p.id); setMotivo(null); } }
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  });

  const c = n?.conferencia;
  return (
    <div className={css.pagina}>
      <div className={css.cab}>
        <div>
          <button type="button" className={css.btnTxt} style={{ paddingLeft: 0 }} onClick={() => navegar('/rh/prestadores')}>‹ Notas de prestadores</button>
          <h2>Conferir notas{fila ? ` · ${fila.length}` : ''}</h2>
          <p>Atalhos: <span className={css.kbd}>A</span> aprovar · <span className={css.kbd}>R</span> recusar · <span className={css.kbd}>↓ ↑</span> próxima · <span className={css.kbd}>+ −</span> zoom · <span className={css.kbd}>F</span> ampliar</p>
        </div>
        <div className={css.acoes}>
          {batem.length > 1 && <button type="button" className={css.btnPri} disabled={ocupado} onClick={() => aprovar(batem.map((x) => x.id))}>Aprovar as {batem.length} que batem</button>}
        </div>
      </div>
      {erro && <p className={css.erro} role="alert">{erro}</p>}
      {msg && <p className={css.okMsg} role="status">{msg}</p>}
      {fila && fila.length === 0 && <div className={css.vazio}><b>Nenhuma nota para conferir 🎉</b><p>Quando um prestador enviar a nota pelo app, ela aparece aqui.</p></div>}

      {fila && fila.length > 0 && (
        <div className={`${css.conf} ${ampliado ? css.confAmpliado : ''}`}>
          <div className={css.fila} role="listbox" aria-label="Notas para conferir">
            <h4><span>Para conferir</span><span className={css.kbd}>{idx + 1}/{fila.length}</span></h4>
            {fila.map((x) => {
              const m = marca(x);
              return (
                <button key={x.id} type="button" role="option" aria-selected={x.id === atual} className={`${css.fi} ${x.id === atual ? css.fiOn : ''}`} onClick={() => { setAtual(x.id); setMotivo(null); }}>
                  <span><Rosto id={x.pessoaId} semente={x.avatarSemente} tamanho={30} /></span>
                  <span><b>{x.nome}</b><small>{x.pessoaTipo === 'MEI' ? 'MEI' : 'Motorista'} · {brl(x.valorCent)}</small></span>
                  <span className={`${css.tag} ${css[`t-${m.tom}`]}`}>{m.texto}</span>
                </button>
              );
            })}
          </div>

          {n && <Visor n={n} ampliado={ampliado} onAmpliar={alternarAmpliado} />}

          {n && c && (
            <div className={css.check}>
              <h4>{n.nome}</h4>
              <p className={css.hint}>{n.rotulo} · enviada {dataIsoBr(n.enviadaEm)}{n.nf.numero ? ` · NF ${n.nf.numero}` : ''}{n.nf.data ? ` de ${dataBr(n.nf.data)}` : ''}</p>
              <h4>Conferência automática</h4>
              {c.origem !== 'INFORMADO' ? (
                <>
                  <p className={css.hint}>Lido do {c.origem === 'PDF' ? 'PDF' : 'XML'} da nota{faltas(c) > 0 ? ` · ${faltas(c) === 1 ? '1 divergência' : `${faltas(c)} divergências`}` : c.descricaoOk === false ? ' · confere, mas a descrição difere do pedido' : ' · tudo confere'}</p>
                  <table className={css.tabConf}>
                    <thead><tr><th aria-label="Situação" /><th /><th>Na nota</th></tr></thead>
                    <tbody>
                      <LinhaConf ok={c.valorBate} rot="valor" nota={c.lido?.valorCent != null ? brl(c.lido.valorCent) : '—'} esp={brl(n.valorCent)} />
                      {c.lido?.cnpjPrestador && <LinhaConf ok={c.prestadorOk} rot="prestador" nota={fmtCnpj(c.lido.cnpjPrestador)} esp={n.documento ? fmtCnpj(n.documento) : 'sem CNPJ no cadastro'} />}
                      {c.lido?.cnpjTomador && <LinhaConf ok={c.tomadorOk} rot="tomador" nota={fmtCnpj(c.lido.cnpjTomador)} esp={n.tomadorEsperado ? fmtCnpj(n.tomadorEsperado) : '—'} />}
                      {n.pedido?.codigoServico && c.codigoOk !== undefined && <LinhaConf ok={c.codigoOk ?? null} rot="código" nota={c.lido?.codigoServico ?? 'não lido'} esp={n.pedido.codigoServico} />}
                      {n.pedido && c.descricaoOk !== undefined && <LinhaConf ok={c.descricaoOk ?? null} aviso texto rot="descrição" nota={c.lido?.descricao ?? 'não lida'} esp={n.pedido.descricao} />}
                      <LinhaConf ok={c.competenciaOk} rot="emissão" nota={n.nf.data ? dataBr(n.nf.data) : '—'} esp={`a partir de ${dataBr(n.periodo === 'MES' ? `${n.competencia}-01` : n.periodo)}`} />
                      <LinhaConf ok={!c.numeroRepetido} rot="número" nota={n.nf.numero ? `nº ${n.nf.numero}` : '—'} esp="não repetido" />
                    </tbody>
                  </table>
                </>
              ) : (
                <>
                  <Cl ok={c.valorBate} titulo={c.valorBate ? 'Valor bate com o fechamento' : c.valorBate === false ? 'Valor diferente do fechamento' : 'Valor não informado'}
                    det={`Esperado ${brl(n.valorCent)}${n.nfValorCent != null ? ` · na nota ${brl(n.nfValorCent)}` : ''} (informado pelo prestador)`} />
                  <Cl ok={c.competenciaOk} titulo="Emitida depois do período" det={n.nf.data ? dataBr(n.nf.data) : undefined} />
                  <Cl ok={!c.numeroRepetido} titulo={c.numeroRepetido ? 'Número de nota repetido' : 'Número da nota não repetido'} det={n.nf.numero ? `NF ${n.nf.numero}` : undefined} />
                  {c.arquivo === 'FOTO' && <Cl ok={null} titulo="Foto: confira a olho" />}
                  {n.pedido && <p className={css.hint}><b>Pedido:</b> {n.pedido.codigoServico ? `código ${n.pedido.codigoServico} · ` : ''}"{n.pedido.descricao}". Confira no arquivo.</p>}
                  {c.arquivo === 'PDF' && <p className={css.hint}>Não deu para ler este PDF (escaneado ou modelo diferente): número, data e valor foram informados pelo prestador. Confira com o arquivo ao lado.</p>}
                </>
              )}

              <button type="button" className={css.btnPri} disabled={ocupado} onClick={() => aprovar([n.id])}>{faltas(c) > 0 ? 'Aprovar mesmo assim (A)' : 'Aprovar nota (A)'}</button>
              <div className={css.motivos} role="group" aria-label="Motivo da recusa">
                {[...MOTIVOS, 'Outro'].map((m) => <button key={m} type="button" aria-pressed={motivo === m} onClick={() => setMotivo(motivo === m ? null : m)}>{m}</button>)}
              </div>
              {motivo === 'Outro' && (
                <div className={css.campo}><label htmlFor="mot-outro">Motivo</label><textarea id="mot-outro" value={outro} onChange={(e) => setOutro(e.target.value)} maxLength={500} /></div>
              )}
              <button ref={recusarRef} type="button" className={css.btnSec} disabled={ocupado || !motivo || (motivo === 'Outro' && outro.trim().length < 3)} onClick={recusar}>Recusar e pedir outra (R)</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
