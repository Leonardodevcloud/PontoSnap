import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import css from './AjustesPonto.module.css';

interface Pedido {
  id: string;
  tipo: 'INCLUSAO' | 'DESCONSIDERAR';
  data: string;
  dtMarcacao: string | null;
  tpMarc: string | null;
  marcacaoId: string | null;
  horaAlvo: string | null;
  observacao: string;
  criadoEm: string;
  empregadoId: string;
  nome: string;
}

const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—');
const dia = (d: string) => { const [a, m, x] = d.split('-'); return `${x}/${m}/${a}`; };

export default function AjustesPonto() {
  const [lista, setLista] = useState<Pedido[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [recusando, setRecusando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try { setLista(await api.get<Pedido[]>('/ajustes/pendentes')); }
    catch (e) { setErro((e as Error).message); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function decidir(p: Pedido, aprovar: boolean) {
    if (!aprovar && !motivo.trim()) { setErro('Escreva o motivo da recusa.'); return; }
    setErro(null); setEnviando(p.id);
    try {
      await api.patch(`/ajustes/${p.id}/decidir`, { aprovar, motivo: aprovar ? undefined : motivo.trim() });
      setMsg(aprovar ? `Ajuste de ${p.nome.split(' ')[0]} aprovado — já vale na apuração.` : `Pedido de ${p.nome.split(' ')[0]} recusado.`);
      setRecusando(null); setMotivo('');
      await carregar();
    } catch (e) { setErro((e as Error).message); }
    finally { setEnviando(null); }
  }

  return (
    <div className={css.tela}>
      <div className={css.top}>
        <div>
          <h1 className={css.h}>Ajustes de ponto</h1>
          <p className={css.sub}>Pedidos dos funcionários. Nada muda na apuração até você decidir — e a batida original nunca é apagada.</p>
        </div>
      </div>

      {erro && <p className={css.erro}>{erro}</p>}
      {msg && <p className={css.ok}>{msg}</p>}

      {lista.length === 0 ? (
        <div className={css.card}><p className={css.vazio}>Nenhum pedido aguardando decisão.</p></div>
      ) : lista.map((p) => (
        <div key={p.id} className={css.ped}>
          <div className={css.pedTop}>
            <span>
              <span className={css.quem}>{p.nome}</span>
              <span className={`${css.badge} ${p.tipo === 'INCLUSAO' ? css.bInc : css.bDesc}`}>
                {p.tipo === 'INCLUSAO' ? 'inclusão' : 'desconsiderar'}
              </span>
            </span>
            <span className={css.quando}>{dia(p.data)}</span>
          </div>

          <p className={css.obs}>“{p.observacao}”</p>

          <div className={css.oQue}>
            {p.tipo === 'INCLUSAO' ? (
              <>Quer incluir a batida das <strong className={css.mono}>{hora(p.dtMarcacao)}</strong> ({p.tpMarc === 'S' ? 'saída' : 'entrada'})</>
            ) : (
              <>Quer desconsiderar a batida das <strong className={css.mono}>{hora(p.horaAlvo)}</strong></>
            )}
          </div>

          {recusando === p.id ? (
            <div className={css.recusa}>
              <input className={css.inp} autoFocus placeholder="Por que está recusando? (o funcionário vai ver)"
                value={motivo} onChange={(e) => setMotivo(e.target.value)} />
              <div className={css.acoes}>
                <button className={css.no} disabled={enviando === p.id} onClick={() => decidir(p, false)}>Confirmar recusa</button>
                <button className={css.cancelar} onClick={() => { setRecusando(null); setMotivo(''); }}>Cancelar</button>
              </div>
            </div>
          ) : (
            <div className={css.acoes}>
              <button className={css.ok2} disabled={enviando === p.id} onClick={() => decidir(p, true)}>
                {enviando === p.id ? 'Aprovando…' : 'Aprovar'}
              </button>
              <button className={css.no} onClick={() => { setRecusando(p.id); setMotivo(''); }}>Recusar</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
