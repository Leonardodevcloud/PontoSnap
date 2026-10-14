import { useEffect, useState } from 'react';
import { quando, type BlocoEnquete, type EstadoEnquete } from '../../lib/comunicacao';
import css from './Enquete.module.css';

const prazo = (iso: string | null) => (iso ? `até ${new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : '');

/** Como a enquete aparece na prévia do RH (sem votar). */
export function EnquetePrevia({ bloco }: { bloco: BlocoEnquete }) {
  return (
    <div className={css.enq}>
      <div className={css.topo}><span>📊 Enquete</span><small>{[bloco.multipla && 'pode marcar mais de uma', prazo(bloco.encerraEm)].filter(Boolean).join(' · ')}</small></div>
      <b className={css.perg}>{bloco.pergunta || 'Pergunta da enquete'}</b>
      {bloco.opcoes.filter((o) => o.texto.trim()).map((o) => (
        <div key={o.id} className={css.op} aria-disabled="true"><span className={bloco.multipla ? css.caixa : css.rad} />{o.texto}</div>
      ))}
      <div className={css.votar} aria-hidden="true">Votar</div>
    </div>
  );
}

/**
 * Enquete no app: escolhe e vota; depois mostra o resultado (se o RH deixou)
 * com o voto da pessoa marcado e o botão para mudar o voto até encerrar.
 */
export function EnqueteVotacao({ estado, onVotar }: { estado: EstadoEnquete; onVotar: (opcoes: string[]) => Promise<EstadoEnquete> }) {
  const [e, setE] = useState(estado);
  const [editando, setEditando] = useState(!estado.meuVoto && !estado.encerrada);
  const [sel, setSel] = useState<string[]>(estado.meuVoto ?? []);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { setE(estado); }, [estado]);

  const alternar = (id: string) => setSel((s) => (e.multipla ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id]));
  const igual = !!e.meuVoto && sel.length === e.meuVoto.length && sel.every((x) => e.meuVoto!.includes(x));

  async function votar() {
    setEnviando(true); setErro(null);
    try { const r = await onVotar(sel); setE(r); setEditando(false); }
    catch (x) { setErro((x as Error).message); }
    finally { setEnviando(false); }
  }

  const cab = (
    <div className={css.topo}>
      <span>📊 Enquete</span>
      <small>{e.encerrada ? 'votação encerrada' : [e.total > 0 && `${e.total} ${e.total === 1 ? 'voto' : 'votos'}`, prazo(e.encerraEm)].filter(Boolean).join(' · ')}</small>
    </div>
  );

  if (editando && !e.encerrada) {
    return (
      <div className={css.enq}>
        {cab}
        <b className={css.perg} id="perg-enq">{e.pergunta}</b>
        {e.multipla && <small className={css.dica}>Pode marcar mais de uma.</small>}
        <div role={e.multipla ? 'group' : 'radiogroup'} aria-labelledby="perg-enq" className={css.lista}>
          {e.opcoes.map((o) => {
            const on = sel.includes(o.id);
            return (
              <button key={o.id} type="button" role={e.multipla ? 'checkbox' : 'radio'} aria-checked={on}
                className={`${css.op} ${css.opBtn} ${on ? css.on : ''}`} onClick={() => alternar(o.id)}>
                <span className={e.multipla ? css.caixa : css.rad} />{o.texto}
              </button>
            );
          })}
        </div>
        {erro && <p className={css.erro} role="alert">{erro}</p>}
        <button type="button" className={css.votar} onClick={votar} disabled={enviando || sel.length === 0 || igual}>
          {enviando ? 'Registrando…' : e.meuVoto ? 'Salvar novo voto' : 'Votar'}
        </button>
        {e.meuVoto
          ? <button type="button" className={css.mudar} onClick={() => { setSel(e.meuVoto!); setEditando(false); }}>Cancelar</button>
          : <small className={css.obs}>Você pode mudar o voto até o fim da votação.</small>}
      </div>
    );
  }

  const maior = Math.max(0, ...e.opcoes.map((o) => o.votos ?? 0));
  return (
    <div className={css.enq}>
      {cab}
      <b className={css.perg}>{e.pergunta}</b>
      {e.verResultado ? e.opcoes.map((o) => {
        const pct = e.total ? Math.round(((o.votos ?? 0) / e.total) * 100) : 0;
        const meu = e.meuVoto?.includes(o.id);
        return (
          <div key={o.id} className={`${css.res} ${meu ? css.meu : ''} ${o.votos === maior && maior > 0 ? css.lider : ''}`}>
            <div className={css.resT}><span>{meu && '✓ '}{o.texto}{meu && <em>seu voto</em>}</span><b>{pct}%</b></div>
            <div className={css.barra} role="img" aria-label={`${o.texto}: ${pct}%`}><i style={{ width: `${pct}%` }} /></div>
          </div>
        );
      }) : (
        <p className={css.seuVoto}>
          {e.meuVoto ? <>Seu voto: <b>{e.opcoes.filter((o) => e.meuVoto!.includes(o.id)).map((o) => o.texto).join(', ')}</b></> : 'Você não votou.'}
          <small>{e.encerrada ? 'O RH vai divulgar o resultado.' : 'O resultado fica com o RH.'}</small>
        </p>
      )}
      {e.meuVoto && <div className={css.ok}>✓ Voto registrado {quando(e.votadoEm)}</div>}
      {!e.encerrada && e.meuVoto && <button type="button" className={css.mudar} onClick={() => { setSel(e.meuVoto!); setEditando(true); }}>Mudar meu voto</button>}
      {e.encerrada && !e.meuVoto && <small className={css.obs}>A votação encerrou antes do seu voto.</small>}
    </div>
  );
}
