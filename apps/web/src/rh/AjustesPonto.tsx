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
interface Batida { id: string; dtMarcacao: string; nsr: number }

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dia = (d: string) => { const [a, m, x] = d.split('-'); return `${x}/${m}/${a}`; };
/** Numa jornada, a ordem manda: 1ª batida é entrada, 2ª saída, e assim por diante. */
const papel = (i: number) => (i % 2 === 0 ? 'entrada' : 'saída');

interface Item { chave: string; hora: string; iso: string; marca: 'NORMAL' | 'SAI' | 'ENTRA' }

/** Monta o dia como está hoje e como fica depois da decisão. */
function montar(p: Pedido, batidas: Batida[]): { antes: Item[]; depois: Item[] } {
  const base: Item[] = batidas.map((b) => ({ chave: b.id, hora: hhmm(b.dtMarcacao), iso: b.dtMarcacao, marca: 'NORMAL' as const }));
  const antes: Item[] = base.map((i) => ({ ...i }));
  let depois: Item[];
  if (p.tipo === 'DESCONSIDERAR') {
    antes.forEach((i) => { if (i.chave === p.marcacaoId) i.marca = 'SAI'; });
    depois = base.filter((i) => i.chave !== p.marcacaoId).map((i) => ({ ...i }));
  } else {
    const novo: Item = { chave: 'novo', hora: p.dtMarcacao ? hhmm(p.dtMarcacao) : '--', iso: p.dtMarcacao ?? '', marca: 'ENTRA' };
    depois = [...base.map((i) => ({ ...i })), novo].sort((a, b) => (a.iso < b.iso ? -1 : 1));
  }
  return { antes, depois };
}

export default function AjustesPonto() {
  const [lista, setLista] = useState<Pedido[]>([]);
  const [batidas, setBatidas] = useState<Record<string, Batida[]>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [recusando, setRecusando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const pend = await api.get<Pedido[]>('/ajustes/pendentes');
      setLista(pend);
      const mapa: Record<string, Batida[]> = {};
      await Promise.all(pend.map(async (p) => {
        mapa[p.id] = await api.get<Batida[]>(`/ajustes/batidas?empregadoId=${p.empregadoId}&data=${p.data}`).catch(() => []);
      }));
      setBatidas(mapa);
    } catch (e) { setErro((e as Error).message); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function decidir(p: Pedido, aprovar: boolean) {
    if (!aprovar && !motivo.trim()) { setErro('Escreva o motivo da recusa.'); return; }
    setErro(null); setEnviando(p.id);
    try {
      await api.patch(`/ajustes/${p.id}/decidir`, { aprovar, motivo: aprovar ? undefined : motivo.trim() });
      setMsg(aprovar ? `Ajuste de ${p.nome.split(' ')[0]} aprovado — ja vale na apuracao.` : `Pedido de ${p.nome.split(' ')[0]} recusado.`);
      setRecusando(null); setMotivo('');
      await carregar();
    } catch (e) { setErro((e as Error).message); }
    finally { setEnviando(null); }
  }

  // Vários pedidos do mesmo funcionário no mesmo dia ficam juntos.
  const mapa = new Map<string, Pedido[]>();
  for (const p of lista) {
    const k = `${p.empregadoId}|${p.data}`;
    mapa.set(k, [...(mapa.get(k) ?? []), p]);
  }
  const grupos = [...mapa.entries()];

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
      ) : grupos.map(([chave, doGrupo]) => (
        <div key={chave} className={css.grupo}>
          <div className={css.grupoTop}>
            <span className={css.quem}>{doGrupo[0]!.nome}</span>
            <span className={css.quando}>{dia(doGrupo[0]!.data)}</span>
            {doGrupo.length > 1 && <span className={css.contador}>{doGrupo.length} pedidos neste dia</span>}
          </div>
          {doGrupo.map((p) => {
        const bs = batidas[p.id] ?? [];
        const { antes, depois } = montar(p, bs);
        const declarado = p.tpMarc === 'S' ? 'saída' : 'entrada';
        const idxNovo = depois.findIndex((i) => i.chave === 'novo');
        const posicao = p.tipo === 'INCLUSAO' && idxNovo >= 0 ? papel(idxNovo) : null;
        const divergiu = posicao !== null && posicao !== declarado;

        return (
          <div key={p.id} className={css.ped}>
            <div className={css.pedTop}>
              <span className={`${css.badge} ${p.tipo === 'INCLUSAO' ? css.bInc : css.bDesc}`}>
                {p.tipo === 'INCLUSAO' ? 'inclusão' : 'desconsiderar'}
              </span>
              <span className={css.quando}>pedido às {new Date(p.criadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>

            <p className={css.obs}>“{p.observacao}”</p>

            <div className={css.comparaWrap}>
              <div className={css.coluna}>
                <span className={css.colLb}>Como está hoje</span>
                {antes.length === 0
                  ? <span className={css.semBat}>nenhuma batida neste dia</span>
                  : <div className={css.linhaBat}>
                      {antes.map((i, idx) => (
                        <span key={i.chave} className={`${css.bat} ${i.marca === 'SAI' ? css.batSai : ''}`}>
                          <span className={css.batPapel}>{papel(idx)}</span>
                          <span className={css.batHora}>{i.hora}</span>
                        </span>
                      ))}
                    </div>}
                {antes.length > 0 && antes.length % 2 !== 0 && <span className={css.avisoImpar}>ímpar — falta uma batida</span>}
              </div>

              <span className={css.seta}>→</span>

              <div className={css.coluna}>
                <span className={css.colLb}>Como fica se aprovar</span>
                <div className={css.linhaBat}>
                  {depois.map((i, idx) => (
                    <span key={i.chave} className={`${css.bat} ${i.marca === 'ENTRA' ? css.batEntra : ''}`}>
                      <span className={css.batPapel}>{papel(idx)}</span>
                      <span className={css.batHora}>{i.hora}</span>
                    </span>
                  ))}
                </div>
                {depois.length % 2 === 0
                  ? <span className={css.avisoOk}>par completo ✓</span>
                  : <span className={css.avisoImpar}>ainda fica ímpar</span>}
              </div>
            </div>

            {p.tipo === 'INCLUSAO' && posicao && (
              <p className={css.detalhe}>
                O funcionário marcou como <strong>{declarado}</strong>; pela ordem do dia, essa batida entra como <strong>{posicao}</strong>.
                {divergiu && <span className={css.divergiu}> Confira antes de aprovar — a posição não bate com o que ele marcou.</span>}
              </p>
            )}

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
          );
        })}
        </div>
      ))}
    </div>
  );
}
