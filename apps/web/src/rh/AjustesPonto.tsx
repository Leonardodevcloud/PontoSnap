import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { rotuloMarcacao } from '../lib/formato';
import css from './AjustesPonto.module.css';
import { Avatar } from '../components/Avatar';
import { Explica } from '../components/Explica';
import { ExplicaSecao } from '../components/ExplicaSecao';

interface Pedido {
  id: string;
  tipo: 'INCLUSAO' | 'DESCONSIDERAR' | 'CORRECAO';
  data: string;
  dtMarcacao: string | null;
  tpMarc: string | null;
  marcacaoId: string | null;
  horaAlvo: string | null;
  observacao: string;
  criadoEm: string;
  empregadoId: string;
  status?: string;
  decididoPor?: string | null;
  motivoDecisao?: string | null;
  origem?: string;
  nome: string;
}
interface Batida { id: string; dtMarcacao: string; nsr: number | null }
interface DiaCtx { batidas: Batida[]; pares: { entrada: string; saida: string }[]; esperadas: number }

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
  const [params, setParams] = useSearchParams();
  const [lancando, setLancando] = useState(false);
  const navegar = useNavigate();
  // Veio de outra tela (espelho do funcionário, apuração): ao lançar ou cancelar, volta pra lá.
  const voltarPara = (() => { const v = params.get('voltar'); return v && v.startsWith('/rh/') && !v.startsWith('//') ? v : null; })();

  const [filtroStatus, setFiltroStatus] = useState('EM_ANALISE');
  const [folgas, setFolgas] = useState<FolgaLancada[]>([]);
  const [removendo, setRemovendo] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    if (filtroStatus === 'FOLGAS') {
      try { setFolgas(await api.get<FolgaLancada[]>('/ajustes/folgas')); } catch (e) { setErro((e as Error).message); }
      return;
    }
    try {
      const pend = await api.get<Pedido[]>(`/ajustes/todos?status=${filtroStatus}`);
      setLista(pend);
      const mapa: Record<string, Batida[]> = {};
      await Promise.all(pend.map(async (p) => {
        mapa[p.id] = await api.get<DiaCtx>(`/ajustes/batidas?empregadoId=${p.empregadoId}&data=${p.data}`)
          .then((d) => d.batidas).catch(() => []);
      }));
      setBatidas(mapa);
    } catch (e) { setErro((e as Error).message); }
  }, [filtroStatus]);
  useEffect(() => { void carregar(); }, [carregar]);
  // Veio da gaveta da Apuração (com funcionário e dia): já abre o lançamento.
  useEffect(() => {
    if (params.get('empregadoId') && params.get('data')) setLancando(true);
  }, [params]);

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

  async function removerFolga(f: FolgaLancada) {
    setErro(null); setEnviando(f.id);
    try {
      await api.del(`/ajustes/folgas/${f.id}`);
      setMsg(`Folga de ${f.nome.split(' ')[0]} em ${dia(f.data)} removida — o dia volta a ser apurado normalmente.`);
      setRemovendo(null); await carregar();
    } catch (e) { setErro((e as Error).message); } finally { setEnviando(null); }
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
          <div className={css.tituloLinha}>
            <h2 className="sr-only">Ajustes de ponto</h2>
            <ExplicaSecao>Pedidos dos funcionários. Nada muda na apuração até você decidir, e a batida original nunca é apagada.</ExplicaSecao>
          </div>
          <div className={css.filtros}>
            {(['EM_ANALISE', 'APROVADO', 'RECUSADO', 'REVOGADO', 'FOLGAS'] as const).map((s) => (
              <button key={s} className={`${css.filtroBtn} ${filtroStatus === s ? css.filtroOn : ''}`}
                onClick={() => setFiltroStatus(s)}>
                {s === 'EM_ANALISE' ? 'Pendentes' : s === 'APROVADO' ? 'Aprovados' : s === 'RECUSADO' ? 'Recusados' : s === 'REVOGADO' ? 'Revogados' : 'Folgas lançadas'}
              </button>
            ))}
          </div>
        </div>
        <button className={css.novoBtn} onClick={() => setLancando(true)}>Lançar ajuste</button>
      </div>

      {erro && <p className={css.erro}>{erro}</p>}
      {msg && <p className={css.ok}>{msg}</p>}

      {filtroStatus === 'FOLGAS' ? (
        folgas.length === 0
          ? <div className={css.card}><p className={css.vazio}>Nenhuma folga lançada. Use "Lançar ajuste" › "Lançar folga".</p></div>
          : <div className={css.card}>
            <p className={css.folgaInfo}>Folga concedida: o dia não conta como falta e <b>não mexe no banco de horas</b>.</p>
            {folgas.map((f) => (
              <div key={f.id} className={css.folgaLinha}>
                <Avatar id={f.empregadoId} nome={f.nome} tamanho={32} />
                <span className={css.folgaTxt}>
                  <b title={f.nome}>{f.nome}</b>
                  <small>{f.feriadoRef ? `feriado trabalhado em ${dia(f.feriadoRef)}` : 'folga concedida'}{f.motivo ? ` · ${f.motivo}` : ''}</small>
                </span>
                <span className={css.folgaDia}>{dia(f.data)}</span>
                {removendo === f.id
                  ? <span className={css.folgaAcoes}><button className={css.no} disabled={enviando === f.id} onClick={() => void removerFolga(f)}>Confirmar remoção</button>
                    <button className={css.cancelar} onClick={() => setRemovendo(null)}>Cancelar</button></span>
                  : <button className={css.no} onClick={() => setRemovendo(f.id)}>Remover</button>}
              </div>
            ))}
          </div>
      ) : lista.length === 0 ? (
        <div className={css.card}><p className={css.vazio}>{filtroStatus === 'EM_ANALISE' ? 'Nenhum pedido aguardando decisão.' : 'Nenhum pedido aqui.'}</p></div>
      ) : grupos.map(([chave, doGrupo]) => (
        <div key={chave} className={css.grupo}>
          <div className={css.grupoTop}>
            <Avatar id={doGrupo[0]!.empregadoId} nome={doGrupo[0]!.nome} tamanho={36} />
            <span className={css.quem} title={doGrupo[0]!.nome}>{doGrupo[0]!.nome}</span>
            <span className={css.quando}>{dia(doGrupo[0]!.data)}{doGrupo.length > 1 && ` · ${doGrupo.length} pedidos neste dia`}</span>
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
              <span className={css.tipoTxt}>
                {p.tipo === 'INCLUSAO' ? 'Incluir batida' : p.tipo === 'CORRECAO' ? 'Corrigir horário' : 'Desconsiderar batida'}
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
                    <span key={i.chave} className={`${css.bat} ${i.marca === 'ENTRA' ? css.batEntra : ''}`}
                      title={i.marca === 'ENTRA' && p.tipo === 'INCLUSAO' ? `O funcionário marcou como ${declarado}` : undefined}>
                      <span className={css.batPapel}>{papel(idx)}</span>
                      <span className={css.batHora}>{i.hora}</span>
                    </span>
                  ))}
                </div>
                {depois.length % 2 === 0
                  ? <span className={css.avisoOk}>par completo</span>
                  : <span className={css.avisoImpar}>ainda fica ímpar</span>}
              </div>
            </div>

            {divergiu && (
              <p className={css.avisoLinha}>
                Marcou como {declarado}, mas pela ordem do dia entra como {posicao}. Confira antes de aprovar.
              </p>
            )}

            {filtroStatus === 'EM_ANALISE' && (
            recusando === p.id ? (
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
            )
            )}
            {filtroStatus === 'APROVADO' && (
              <div className={css.acoes}>
                <span className={css.decisao}>Aprovado{p.decididoPor ? ` por ${p.decididoPor}` : ''}</span>
              </div>
            )}
            {filtroStatus === 'RECUSADO' && (
              <div className={css.acoes}>
                <span className={css.decisao}>Recusado{p.motivoDecisao ? `: ${p.motivoDecisao}` : ''}</span>
              </div>
            )}
            {filtroStatus === 'REVOGADO' && (
              <div className={css.acoes}>
                <span className={css.decisao}>Revogado{p.decididoPor ? ` por ${p.decididoPor}` : ''}</span>
              </div>
            )}
            </div>
          );
        })}
        </div>
      ))}

      {lancando && (
        <ModalLancar
          empregadoIdInicial={params.get('empregadoId') ?? ''}
          tipoInicial={params.get('tipo') === 'FOLGA' ? 'FOLGA' : undefined}
          dataInicial={params.get('data') ?? ''}
          onFechar={() => { setLancando(false); if (voltarPara) { navegar(voltarPara); return; } setParams({}); }}
          onPronto={(m) => {
            setLancando(false);
            if (voltarPara) { navegar(voltarPara, { state: { aviso: m ?? 'Ajuste lançado — já vale na apuração.' } }); return; }
            setParams({});
            setMsg(m ?? 'Ajuste lançado — já vale na apuração.');
            void carregar();
          }}
        />
      )}
    </div>
  );
}

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
interface EmpLite { id: string; nome: string; ativo: boolean }
/** "2" → 120 · "1,5" → 90 · "1:30" → 90 · inválido → null */
function lerHoras(t: string): number | null {
  const v = t.trim();
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(v);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(v.replace(',', '.'));
  return v && Number.isFinite(n) && n > 0 ? Math.round(n * 60) : null;
}
interface FolgaLancada { id: string; empregadoId: string; nome: string; data: string; motivo: string | null; feriadoRef: string | null; criadoEm: string }
interface BatidaLite { id: string; dtMarcacao: string; nsr: number | null }

/**
 * Lançamento direto do RH: nasce aprovado (não passa por decisão). É o caminho
 * pra tirar uma batida a mais ou incluir uma que faltou sem esperar o pedido.
 */
function ModalLancar({ empregadoIdInicial, dataInicial, tipoInicial, onFechar, onPronto }: {
  empregadoIdInicial: string; dataInicial: string; tipoInicial?: 'FOLGA'; onFechar: () => void; onPronto: (msg?: string) => void;
}) {
  const [emps, setEmps] = useState<EmpLite[]>([]);
  const [empregadoId, setEmpregadoId] = useState(empregadoIdInicial);
  const [data, setData] = useState(dataInicial || new Date().toISOString().slice(0, 10));
  const [fixo, setFixo] = useState(!!empregadoIdInicial && !!dataInicial);
  const [tipo, setTipo] = useState<'INCLUSAO' | 'DESCONSIDERAR' | 'CORRECAO' | 'FOLGA'>(tipoInicial ?? 'INCLUSAO');
  // Folga concedida: por feriado trabalhado (com a data dele) ou outro motivo.
  const [porFeriado, setPorFeriado] = useState(true);
  const [feriadoRef, setFeriadoRef] = useState('');
  // Folga que desconta do banco: dia inteiro (vira folga) ou só algumas horas (saída antecipada).
  const [doBanco, setDoBanco] = useState(false);
  const [diaInteiro, setDiaInteiro] = useState(true);
  const [horasFolga, setHorasFolga] = useState('');
  const [hora, setHora] = useState('');
  const [tpMarc, setTpMarc] = useState<'E' | 'S'>('E');
  const [dia, setDia] = useState<{ batidas: BatidaLite[]; pares: { entrada: string; saida: string }[]; esperadas: number }>({ batidas: [], pares: [], esperadas: 0 });
  const batidas = dia.batidas;
  const [alvo, setAlvo] = useState<string>('');
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api.get<EmpLite[]>('/empregados').then((l) => setEmps(l.filter((e) => e.ativo))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!empregadoId || !data) { setDia({ batidas: [], pares: [], esperadas: 0 }); return; }
    api.get<{ batidas: BatidaLite[]; pares: { entrada: string; saida: string }[]; esperadas: number }>(
      `/ajustes/batidas?empregadoId=${empregadoId}&data=${data}`)
      .then((d) => { setDia(d); setAlvo(''); })
      .catch(() => setDia({ batidas: [], pares: [], esperadas: 0 }));
  }, [empregadoId, data]);

  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const hor = (p: string) => `${p.slice(0, 2)}:${p.slice(2)}`;

  // Cruza o horário previsto com o que foi batido: cada posição vira um slot
  // (batido, incluído por ajuste, ou faltando). Batidas além do previsto entram
  // no fim como "extra".
  const previstos = dia.pares.flatMap((p) => [
    { hora: hor(p.entrada), tp: 'E' as const },
    { hora: hor(p.saida), tp: 'S' as const },
  ]);
  const total = Math.max(previstos.length, batidas.length);
  const slots = Array.from({ length: total }, (_, i) => {
    const prev = previstos[i];
    return {
      rotulo: prev ? rotuloMarcacao(i, previstos.length) : 'extra',
      sugestao: prev?.hora ?? null,
      tp: prev?.tp ?? ('E' as const),
      batida: batidas[i] ?? null,
    };
  });

  async function enviar() {
    if (!empregadoId) { setErro('Escolha o funcionário.'); return; }
    if (tipo === 'FOLGA' && doBanco) {
      const min = diaInteiro ? null : lerHoras(horasFolga);
      if (!diaInteiro && (min == null || min <= 0)) { setErro('Informe as horas (ex.: 2 ou 1:30).'); return; }
      setErro(null); setEnviando(true);
      try {
        const r = await api.post<{ minutos: number; parcial: boolean }>('/banco/folga', { empregadoId, data, ...(min != null ? { minutos: min } : {}) });
        const nome = emps.find((e) => e.id === empregadoId)?.nome.split(' ')[0] ?? 'Funcionário';
        const hh = `${Math.floor(r.minutos / 60)}h${r.minutos % 60 ? String(r.minutos % 60).padStart(2, '0') : ''}`;
        onPronto(r.parcial
          ? `${hh} de ${nome} em ${data.split('-').reverse().join('/')} saíram do banco de horas — o resto do dia segue normal.`
          : `Folga de ${nome} em ${data.split('-').reverse().join('/')}: ${hh} saíram do banco de horas e o dia não conta como falta.`);
      } catch (e) { setErro((e as Error).message); setEnviando(false); }
      return;
    }
    if (tipo === 'FOLGA') {
      if (porFeriado && !/^\d{4}-\d{2}-\d{2}$/.test(feriadoRef)) { setErro('Informe o dia do feriado que ele trabalhou.'); return; }
      if (!porFeriado && obs.trim().length < 5) { setErro('Escreva o motivo da folga — fica registrado na auditoria.'); return; }
      setErro(null); setEnviando(true);
      try {
        await api.post('/ajustes/folgas', { empregadoId, data, feriadoRef: porFeriado ? feriadoRef : null, motivo: obs.trim() || null });
        const nome = emps.find((e) => e.id === empregadoId)?.nome.split(' ')[0] ?? 'Funcionário';
        onPronto(`Folga de ${nome} em ${data.split('-').reverse().join('/')} lançada — o dia não conta como falta e o banco de horas não muda.`);
      } catch (e) { setErro((e as Error).message); setEnviando(false); }
      return;
    }
    if (obs.trim().length < 5) { setErro('Escreva o motivo — fica registrado na auditoria.'); return; }
    if ((tipo === 'INCLUSAO' || tipo === 'CORRECAO') && !/^\d{2}:\d{2}$/.test(hora)) { setErro('Informe a hora (HH:MM).'); return; }
    if ((tipo === 'DESCONSIDERAR' || tipo === 'CORRECAO') && !alvo) { setErro('Escolha qual batida.'); return; }
    setErro(null); setEnviando(true);
    try {
      // Se é DESCONSIDERAR e a batida selecionada é de ajuste (nsr == null),
      // revoga o ajuste em vez de criar DESCONSIDERAR (não existe em ponto_marcacao)
      const batidaSelecionada = alvo ? batidas.find((b) => b.id === alvo) : null;
      if (tipo === 'DESCONSIDERAR' && batidaSelecionada && batidaSelecionada.nsr == null) {
        await api.del(`/ajustes/${alvo}`);
      } else {
        await api.post('/ajustes/lancar', {
          empregadoId, tipo, data,
          ...(tipo === 'INCLUSAO' ? { hora, tpMarc } : tipo === 'CORRECAO' ? { hora, tpMarc, marcacaoId: alvo } : { marcacaoId: alvo }),
          observacao: obs.trim(),
        });
      }
      onPronto();
    } catch (e) { setErro((e as Error).message); setEnviando(false); }
  }

  return (
    <>
      <div className={css.fundoModal} onClick={onFechar} />
      <div className={css.modal} role="dialog" aria-label="Lançar ajuste">
        <div className={css.modalTop}>
          <div className={css.tituloLinha}>
            <h2 className={css.modalH}>Lançar ajuste</h2>
            <Explica>Este lançamento já nasce valendo: não passa por aprovação. O motivo fica na auditoria.</Explica>
          </div>
          <button className={css.gX} onClick={onFechar} aria-label="Fechar">✕</button>
        </div>

        {fixo ? (
          // Veio de um dia do espelho: funcionário e dia já escolhidos.
          <div className={css.fixoLinha}>
            <span><b>{emps.find((e) => e.id === empregadoId)?.nome ?? 'Carregando…'}</b> · {SEMANA[new Date(`${data}T12:00:00Z`).getUTCDay()]} {data.split('-').reverse().join('/')}</span>
            <button className={css.cancelar} onClick={() => setFixo(false)}>trocar</button>
          </div>
        ) : <>
        <span className={css.lb}>Funcionário</span>
        <select className={css.inp} value={empregadoId} onChange={(e) => setEmpregadoId(e.target.value)}>
          <option value="">— escolher —</option>
          {emps.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>

        <span className={css.lb}>Dia</span>
        <input className={css.inp} type="date" value={data} max={tipo === 'FOLGA' ? undefined : new Date().toISOString().slice(0, 10)}
          onChange={(e) => setData(e.target.value)} />
        </>}

        {empregadoId && data && (
          <div className={css.diaCtx}>
            <span className={css.diaCtxLb}>
              Como está o dia
              {dia.pares.length > 0 && <em> · previsto {dia.pares.map((p) => `${hor(p.entrada)}–${hor(p.saida)}`).join(' / ')}</em>}
            </span>
            {dia.esperadas === 0 && batidas.length === 0 && (
              <p className={css.semBat}>Sem horário contratual e sem batidas neste dia.</p>
            )}
            <div className={css.slots}>
              {slots.map((s2, i) => {
                const clicavelInc = !s2.batida && tipo === 'INCLUSAO';
                const clicavelCorr = !!s2.batida && tipo === 'CORRECAO';
                return (
                <button
                  key={i}
                  className={`${css.slot} ${s2.batida ? css.slotOk : css.slotFalta} ${clicavelInc || clicavelCorr ? css.slotClicavel : ''} ${clicavelCorr && alvo === s2.batida?.id ? css.slotSelecionado : ''}`}
                  disabled={!clicavelInc && !clicavelCorr}
                  onClick={() => {
                    if (clicavelInc && s2.sugestao) { setHora(s2.sugestao); setTpMarc(s2.tp); }
                    if (clicavelCorr && s2.batida?.id) { setAlvo(s2.batida.id); setTpMarc(s2.tp); }
                  }}
                  title={clicavelInc ? 'Clique pra preencher esta batida' : clicavelCorr ? 'Clique pra corrigir o horário desta batida' : ''}
                >
                  <span className={css.slotLb}>{s2.rotulo}</span>
                  <span className={css.slotV}>{s2.batida ? hhmm(s2.batida.dtMarcacao) : (s2.sugestao ?? '—')}</span>
                  <span className={css.slotTag}>{s2.batida ? (s2.batida.nsr == null ? 'ajuste' : 'batido') : 'faltando'}</span>
                </button>
                );
              })}
            </div>
          </div>
        )}

        <span className={css.lb}>O que fazer</span>
        <div className={css.opts}>
          <button className={`${css.optB} ${tipo === 'INCLUSAO' ? css.optOn : ''}`} onClick={() => setTipo('INCLUSAO')}>Incluir batida que faltou</button>
          <button className={`${css.optB} ${tipo === 'CORRECAO' ? css.optOn : ''}`} onClick={() => setTipo('CORRECAO')}>Corrigir horário</button>
          <button className={`${css.optB} ${tipo === 'DESCONSIDERAR' ? css.optOn : ''}`} onClick={() => setTipo('DESCONSIDERAR')}>Tirar batida a mais</button>
          <button className={`${css.optB} ${tipo === 'FOLGA' ? css.optOn : ''}`} onClick={() => setTipo('FOLGA')}>Lançar folga</button>
        </div>

        {tipo === 'FOLGA' && (
          <>
            <span className={css.lb}>E as horas?</span>
            <div className={css.opts}>
              <button className={`${css.optB} ${!doBanco ? css.optOn : ''}`} onClick={() => setDoBanco(false)}>Não mexe no banco (folga dada)</button>
              <button className={`${css.optB} ${doBanco ? css.optOn : ''}`} onClick={() => setDoBanco(true)}>Desconta do banco de horas</button>
            </div>
            <p className={css.folgaInfo}>{doBanco
              ? <>As horas <b>saem do banco de horas</b> e não viram falta nem desconto no salário. Serve para folga paga com o saldo (ex.: um sábado) e para <b>saída antecipada</b> ou chegada tarde autorizada.</>
              : <>O dia vira folga: <b>não conta como falta</b> e <b>não mexe no banco de horas</b> (ex.: folga da convenção por feriado trabalhado). VR/VT do dia são abatidos.</>}</p>
            {doBanco && (
              <>
                <div className={css.opts}>
                  <button className={`${css.optB} ${diaInteiro ? css.optOn : ''}`} onClick={() => setDiaInteiro(true)}>Dia inteiro</button>
                  <button className={`${css.optB} ${!diaInteiro ? css.optOn : ''}`} onClick={() => setDiaInteiro(false)}>Só algumas horas</button>
                </div>
                {diaInteiro
                  ? <p className={css.semBat}>Sai do banco a jornada daquele dia pela escala (no sábado de meio turno, só as horas do sábado).</p>
                  : <>
                    <span className={css.lb}>Quantas horas saem do banco</span>
                    <input className={css.inp} inputMode="decimal" placeholder="Ex.: 2 ou 1:30" value={horasFolga} onChange={(e) => setHorasFolga(e.target.value)} />
                    <p className={css.semBat}>Ex.: saiu às 15h num dia que vai até 17h → 2. As horas que ele trabalhou continuam normais.</p>
                  </>}
              </>
            )}
            {batidas.length > 0 && !(doBanco && !diaInteiro) && <p className={css.erroModal}>Este dia tem {batidas.length} {batidas.length === 1 ? 'batida' : 'batidas'}: ele trabalhou. {doBanco ? 'Se ele saiu mais cedo, escolha "Só algumas horas".' : 'Escolha o dia em que ele folgou.'}</p>}
            {!doBanco && <>
            <span className={css.lb}>Por quê</span>
            <div className={css.opts}>
              <button className={`${css.optB} ${porFeriado ? css.optOn : ''}`} onClick={() => setPorFeriado(true)}>Trabalhou em feriado</button>
              <button className={`${css.optB} ${!porFeriado ? css.optOn : ''}`} onClick={() => setPorFeriado(false)}>Outro motivo</button>
            </div>
            {porFeriado && (
              <>
                <span className={css.lb}>Dia do feriado trabalhado</span>
                <input className={css.inp} type="date" value={feriadoRef} onChange={(e) => setFeriadoRef(e.target.value)} />
              </>
            )}
            </>}
          </>
        )}

        {(tipo === 'CORRECAO' || tipo === 'DESCONSIDERAR') && (
          <>
            <span className={css.lb}>{tipo === 'CORRECAO' ? 'Qual batida corrigir' : 'Qual batida sai da conta'}</span>
            {batidas.length === 0 ? (
              <p className={css.semBat}>Nenhuma batida neste dia.</p>
            ) : (
              <div className={css.batidas}>
                {batidas.map((b) => (
                  <button key={b.id} className={`${css.batB} ${alvo === b.id ? css.batOn : ''}`}
                    onClick={() => setAlvo(b.id)} 
                    title={b.nsr == null ? 'Batida de ajuste — será revogada' : ''}>
                    {hhmm(b.dtMarcacao)}{b.nsr == null ? ' ✎' : ''}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {(tipo === 'INCLUSAO' || tipo === 'CORRECAO') && (
          <>
            <span className={css.lb}>{tipo === 'CORRECAO' ? 'Horário correto' : 'Horário'}</span>
            <div className={css.dupla}>
              <input className={css.inp} type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
              <select className={css.inp} value={tpMarc} onChange={(e) => setTpMarc(e.target.value as 'E' | 'S')}>
                <option value="E">entrada</option>
                <option value="S">saída</option>
              </select>
            </div>
          </>
        )}

        {!(tipo === 'FOLGA' && doBanco) && <><span className={css.lb}>{tipo === 'FOLGA' && porFeriado ? 'Observação (opcional)' : 'Motivo'}</span>
        <textarea className={css.inp} rows={2} value={obs} onChange={(e) => setObs(e.target.value)}
          placeholder={tipo === 'FOLGA' ? (porFeriado ? 'Ex.: folga da convenção pelo feriado de Finados.' : 'Ex.: folga de aniversário prevista na convenção.') : 'Ex.: batida duplicada confirmada com o funcionário.'} /></>}

        {erro && <p className={css.erroModal}>{erro}</p>}
        <div className={css.acoes}>
          <button className={css.ok2} onClick={enviar} disabled={enviando || (tipo === 'FOLGA' && batidas.length > 0 && !(doBanco && !diaInteiro))}>{enviando ? 'Lançando…' : tipo === 'FOLGA' ? (doBanco ? 'Tirar do banco' : 'Lançar folga') : 'Lançar'}</button>
          <button className={css.cancelar} onClick={onFechar}>Cancelar</button>
        </div>
      </div>
    </>
  );
}
