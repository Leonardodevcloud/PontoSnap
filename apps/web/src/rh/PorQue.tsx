import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { explicar, type CampoExplicavel, type Explicacao } from '../lib/explicar';
import { PainelLateral } from '../components/PainelLateral';
import type { ApuracaoResp } from '../tipos';
import css from './PorQue.module.css';

export interface PedidoExplicacao { empregadoId: string; nome: string; campo: CampoExplicavel }

/** Painel "Por que deu esse número?": a conta em português de um total da tabela. */
export function PorQue({ pedido, inicio, fim, onFechar, onVerDias }: {
  pedido: PedidoExplicacao | null; inicio: string; fim: string; onFechar: () => void; onVerDias: (empregadoId: string) => void;
}) {
  const [ex, setEx] = useState<Explicacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!pedido) return;
    let vivo = true;
    setEx(null); setErro(null);
    api.get<ApuracaoResp>(`/tratamento/apuracao?empregadoId=${pedido.empregadoId}&inicio=${inicio}&fim=${fim}`)
      .then((ap) => { if (vivo) setEx(explicar(ap, pedido.campo)); })
      .catch((e) => { if (vivo) setErro((e as Error).message); });
    return () => { vivo = false; };
  }, [pedido, inicio, fim]);

  const mes = new Date(`${inicio}T12:00:00-0300`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return (
    <PainelLateral aberto={!!pedido} onFechar={onFechar} titulo={ex?.titulo ?? 'Calculando a conta…'}
      subtitulo={pedido ? `${pedido.nome} · ${mes}` : undefined}
      rodape={pedido && <>
        <button className={css.sec} onClick={() => { onFechar(); onVerDias(pedido.empregadoId); }}>Ver os dias</button>
        <button className={css.pri} onClick={onFechar} data-autofoco>Entendi</button>
      </>}>
      {!ex && !erro && <p className={css.mudo}>Buscando os dias do mês…</p>}
      {erro && <p className={css.erro} role="alert">Não deu para montar a conta: {erro}</p>}
      {ex && (
        <>
          <p className={css.resumo}>{ex.resumo}</p>
          {ex.linhas.length > 0 && (
            <>
              <h3 className={css.secT}>A conta</h3>
              <ol className={css.conta}>
                {ex.linhas.map((l, i) => (
                  <li key={i} className={`${css.cl} ${l.estilo === 'zero' ? css.zero : ''} ${l.estilo === 'total' ? css.tot : ''}`}>
                    <span className={css.op} aria-hidden="true">{l.op}</span>
                    <div className={css.clTxt}><b>{l.rotulo}</b>{l.detalhe && <small>{l.detalhe}</small>}</div>
                    <span className={css.v}>{l.valor}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
          {ex.nota && <p className={css.nota}>{ex.nota}</p>}
          <h3 className={css.secT}>Regras que entraram</h3>
          <ul className={css.regras}>
            {ex.regras.map((r) => (
              <li key={r.rotulo}>
                <div><b>{r.rotulo}</b><span>{r.texto}</span></div>
                <Link to={r.rota} onClick={onFechar}>mudar</Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </PainelLateral>
  );
}
