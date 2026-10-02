import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { fmtHora, hojeSP, minutosParaHhMm, rotuloMarcacaoPorHora } from '../lib/formato';
import { salvarBlob } from '../lib/download';
import { Botao } from '../components/Botao';
import type { ApuracaoResp, Empregado, EspelhoResp, RelatorioCompetencia, ResultadoDiaCLT, TipoAfastamento } from '../tipos';
import { TabelaCompetencia } from './TabelaCompetencia';
import vt from './VisaoTodos.module.css';
import css from './Espelhos.module.css';

/**
 * Espelhos (RH): três níveis.
 *  1. Todos os funcionários na competência — jornada, saldo e banco de cada um.
 *  2. Um funcionário no mês — dias, banco real e ações.
 *  3. Um dia — batidas e resumo (a tela antiga).
 * A URL guarda o nível (?emp=&mes=&dia=) pra voltar e compartilhar.
 */

const mesAtual = () => hojeSP().slice(0, 7);
function faixaDoMes(mes: string): { inicio: string; fim: string } {
  const [a, m] = mes.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a!, m!, 0)).getUTCDate();
  return { inicio: `${mes}-01`, fim: `${mes}-${String(ultimo).padStart(2, '0')}` };
}
const rotuloMes = (comp: string) => new Date(`${comp}-01T12:00:00-0300`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const diaSemanaCurto = (iso: string) => ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(`${iso}T12:00:00-0300`).getUTCDay()];
const fmtDia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const comSinal = (m: number) => `${m > 0 ? '+' : m < 0 ? '−' : ''}${minutosParaHhMm(Math.abs(m))}`;
const ROTULO_AFAST: Record<TipoAfastamento, string> = {
  FERIAS: 'Férias', INSS: 'Afastamento (INSS)', MATERNIDADE: 'Licença-maternidade',
  PATERNIDADE: 'Licença-paternidade', SUSPENSAO: 'Suspensão', OUTRO: 'Afastamento',
};

export function Espelhos() {
  const [params, setParams] = useSearchParams();
  const mes = params.get('mes') ?? mesAtual();
  const empregadoId = params.get('emp') ?? '';
  const dia = params.get('dia') ?? '';
  const visao: 'todos' | 'um' = empregadoId ? 'um' : 'todos';

  const [emps, setEmps] = useState<Empregado[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api.get<Empregado[]>('/empregados')
      .then((l) => setEmps(l.filter((e) => e.ativo)))
      .catch((e) => setErro((e as Error).message));
  }, []);

  const ir = useCallback((p: { mes?: string; emp?: string | null; dia?: string | null }) => {
    setParams((atual) => {
      const n = new URLSearchParams(atual);
      if (p.mes !== undefined) n.set('mes', p.mes);
      if (p.emp !== undefined) { if (p.emp) n.set('emp', p.emp); else n.delete('emp'); }
      if (p.dia !== undefined) { if (p.dia) n.set('dia', p.dia); else n.delete('dia'); }
      return n;
    });
  }, [setParams]);

  const nomeSel = emps.find((e) => e.id === empregadoId)?.nome ?? '';

  return (
    <div>
      <div className={css.head}>
        <div><h2>Espelhos</h2><p>Jornada e banco de horas de todo mundo no mês — ou de um funcionário, dia a dia.</p></div>
      </div>

      <div className={css.controles}>
        <div className={css.sel}>
          <span className={css.lb}>Visão</span>
          <div className={vt.seg} role="tablist">
            <button role="tab" aria-selected={visao === 'todos'} className={visao === 'todos' ? vt.segOn : ''} onClick={() => ir({ emp: null, dia: null })}>Todos os funcionários</button>
            <button role="tab" aria-selected={visao === 'um'} className={visao === 'um' ? vt.segOn : ''} onClick={() => ir({ emp: empregadoId || emps[0]?.id || null, dia: null })}>Um funcionário</button>
          </div>
        </div>
        <label className={css.sel}>
          <span className={css.lb}>Competência</span>
          <input type="month" value={mes} max={mesAtual()} onChange={(e) => e.target.value && ir({ mes: e.target.value, dia: null })} />
        </label>
        {visao === 'um' && (
          <label className={css.sel}>
            <span className={css.lb}>Funcionário</span>
            <select value={empregadoId} onChange={(e) => ir({ emp: e.target.value, dia: null })}>
              {emps.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          </label>
        )}
      </div>

      {erro && <p className={css.erro}>{erro}</p>}

      {visao === 'todos' && <Todos mes={mes} emps={emps} onAbrir={(id) => ir({ emp: id })} onErro={setErro} />}
      {visao === 'um' && !dia && empregadoId && (
        <MesFuncionario mes={mes} empregadoId={empregadoId} nome={nomeSel} onVoltar={() => ir({ emp: null })} onDia={(d) => ir({ dia: d })} onErro={setErro} />
      )}
      {visao === 'um' && dia && empregadoId && (
        <DiaFuncionario data={dia} empregadoId={empregadoId} nome={nomeSel} mes={mes}
          onTodos={() => ir({ emp: null, dia: null })} onMes={() => ir({ dia: null })} onErro={setErro} />
      )}
    </div>
  );
}

/* ---------------- Nível 1: todos ---------------- */

function Todos({ mes, emps, onAbrir, onErro }: { mes: string; emps: Empregado[]; onAbrir: (id: string) => void; onErro: (m: string | null) => void }) {
  const [rel, setRel] = useState<RelatorioCompetencia | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [busca, setBusca] = useState('');
  const [baixando, setBaixando] = useState<'zip' | 'xlsx' | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCarregando(true); onErro(null);
      try {
        const { inicio, fim } = faixaDoMes(mes);
        // Fecha no banco os meses pendentes de todo mundo antes de ler o relatório.
        await api.post('/banco/sincronizar', {}).catch(() => {});
        const r = await api.get<RelatorioCompetencia>(`/tratamento/relatorio-competencia?inicio=${inicio}&fim=${fim}`);
        if (vivo) setRel(r);
      } catch (e) { if (vivo) { onErro((e as Error).message); setRel(null); } }
      finally { if (vivo) setCarregando(false); }
    })();
    return () => { vivo = false; };
  }, [mes, onErro]);

  async function baixarZip() {
    const { inicio, fim } = faixaDoMes(mes);
    setBaixando('zip');
    try {
      const blob = await api.baixarPost('/tratamento/apuracao/lote', { empregadoIds: emps.map((e) => e.id), inicio, fim, apuracao: false, espelho: true });
      salvarBlob(blob, `espelhos_${mes}.zip`);
    } catch (e) { onErro((e as Error).message); }
    finally { setBaixando(null); }
  }
  async function baixarXlsx() {
    const { inicio, fim } = faixaDoMes(mes);
    setBaixando('xlsx');
    try {
      const blob = await api.baixar(`/tratamento/relatorio-competencia/xlsx?inicio=${inicio}&fim=${fim}`);
      salvarBlob(blob, `competencia_${mes}.xlsx`);
    } catch (e) { onErro((e as Error).message); }
    finally { setBaixando(null); }
  }

  const t = rel?.totais;
  const pendentes = useMemo(() => {
    if (!rel) return { abertos: [] as string[], faltas: [] as { nome: string; dias: string[] }[] };
    const hoje = rel.hoje;
    return {
      abertos: rel.linhas.filter((l) => l.sinais.emAbertoHoje).map((l) => l.nome.split(' ')[0]!),
      faltas: rel.linhas.filter((l) => l.sinais.faltaDias.some((d) => d < hoje)).map((l) => ({ nome: l.nome.split(' ')[0]!, dias: l.sinais.faltaDias.filter((d) => d < hoje) })),
    };
  }, [rel]);
  const nPend = pendentes.abertos.length + pendentes.faltas.length;

  return (
    <>
      <div className={css.barra}>
        <input className={vt.busca} placeholder="Buscar por nome ou matrícula" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar funcionário" />
        <div className={vt.acoes}>
          <Botao variante="ghost" className={vt.btn} onClick={baixarZip} disabled={baixando !== null || emps.length === 0}>{baixando === 'zip' ? 'Gerando…' : 'Espelhos em lote (ZIP)'}</Botao>
          <Botao variante="lime" className={vt.btn} onClick={baixarXlsx} disabled={baixando !== null}>{baixando === 'xlsx' ? 'Gerando…' : 'Exportar XLSX'}</Botao>
        </div>
      </div>

      {carregando && !rel && <p className={css.carregando}>Apurando {rotuloMes(mes)}…</p>}

      {rel && t && (
        <>
          {nPend > 0 && (
            <div className={vt.callout}>
              <b>{nPend} pendência{nPend === 1 ? '' : 's'}</b> em {rotuloMes(mes)}:
              {pendentes.abertos.length > 0 && <span>{pendentes.abertos.length === 1 ? `${pendentes.abertos[0]} com batida em aberto hoje` : `${pendentes.abertos.length} com batida em aberto hoje (${pendentes.abertos.join(', ')})`}</span>}
              {pendentes.faltas.length > 0 && <span>{pendentes.faltas.map((f) => `${f.nome} sem batida em ${f.dias.map(fmtDia).join(', ')}`).join(' · ')}</span>}
            </div>
          )}

          <div className={vt.kpis}>
            <div className={vt.kpi}><div className={vt.kpiK}>Funcionários</div><div className={vt.kpiV}>{rel.linhas.length}</div><div className={vt.kpiS}>apurados no mês</div></div>
            <div className={vt.kpi}><div className={vt.kpiK}>Trabalhado</div><div className={vt.kpiV}>{minutosParaHhMm(t.trabalhadoMin)}</div><div className={vt.kpiS}>de {minutosParaHhMm(t.contratadoMin)} previstas</div></div>
            <div className={`${vt.kpi} ${vt.kpiPeach}`}><div className={vt.kpiK}>Extras no mês</div><div className={vt.kpiV}>+{minutosParaHhMm(t.extrasMin)}</div><div className={vt.kpiS}>50% e 100%</div></div>
            <div className={`${vt.kpi} ${t.atrasoMin + t.faltaMin > 0 ? vt.kpiAlerta : ''}`}><div className={vt.kpiK}>Atrasos e faltas</div><div className={vt.kpiV}>−{minutosParaHhMm(t.atrasoMin + t.faltaMin)}</div><div className={vt.kpiS}>{rel.linhas.filter((l) => l.atrasoMin + l.faltaMin > 0).length} funcionário{rel.linhas.filter((l) => l.atrasoMin + l.faltaMin > 0).length === 1 ? '' : 's'}</div></div>
            {t.comBanco > 0 && <div className={`${vt.kpi} ${vt.kpiInk}`}><div className={vt.kpiK}>Banco · acumulado</div><div className={vt.kpiV}>{comSinal(t.bancoAcumuladoMin)}</div><div className={vt.kpiS}>saldo de {t.comBanco} com banco, até hoje</div></div>}
            <div className={vt.kpi}><div className={vt.kpiK}>Assinaturas</div><div className={vt.kpiV}>{t.assinadas} / {rel.linhas.length}</div><div className={vt.kpiS}>espelho de {rotuloMes(mes).split(' de ')[0]} assinado</div></div>
          </div>

          <TabelaCompetencia rel={rel} modo="espelho" busca={busca} onAbrir={onAbrir} />
          <div className={vt.legenda}>
            <span>Clique na linha pra ver o mês do funcionário.</span>
            <span>Banco anterior = saldo fechado até o mês passado · Acumulado = anterior + este mês + folgas/pagamentos.</span>
          </div>
        </>
      )}
    </>
  );
}

/* ---------------- Nível 2: um funcionário no mês ---------------- */

function MesFuncionario({ mes, empregadoId, nome, onVoltar, onDia, onErro }: {
  mes: string; empregadoId: string; nome: string;
  onVoltar: () => void; onDia: (d: string) => void; onErro: (m: string | null) => void;
}) {
  const [ap, setAp] = useState<ApuracaoResp | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [baixando, setBaixando] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCarregando(true); onErro(null); setAp(null);
      try {
        const { inicio, fim } = faixaDoMes(mes);
        await api.post(`/banco/sincronizar?empregadoId=${empregadoId}`, {}).catch(() => {});
        let r = await api.get<ApuracaoResp>(`/tratamento/apuracao?empregadoId=${empregadoId}&inicio=${inicio}&fim=${fim}`);
        if (r.banco?.desatualizado) {
          // A apuração reabriu um mês fechado com valor velho: refaz agora e relê.
          await api.post(`/banco/sincronizar?empregadoId=${empregadoId}`, {}).catch(() => {});
          r = await api.get<ApuracaoResp>(`/tratamento/apuracao?empregadoId=${empregadoId}&inicio=${inicio}&fim=${fim}`);
        }
        if (vivo) setAp(r);
      } catch (e) { if (vivo) onErro((e as Error).message); }
      finally { if (vivo) setCarregando(false); }
    })();
    return () => { vivo = false; };
  }, [mes, empregadoId, onErro]);

  async function baixarEspelho() {
    setBaixando(true);
    try {
      const blob = await api.baixar(`/espelho-assinatura/rh/pdf?empregadoId=${empregadoId}&competencia=${mes}`);
      salvarBlob(blob, `espelho_${mes}.pdf`);
    } catch (e) { onErro((e as Error).message); }
    finally { setBaixando(false); }
  }

  const r = ap?.resultado;
  const hoje = hojeSP();
  const motivoDoDia = (data: string): string | null => {
    const a = (ap?.afastamentos ?? []).find((x) => data >= x.dataInicio && data <= x.dataFim);
    return a ? ROTULO_AFAST[a.tipo] : null;
  };
  const dias = useMemo(() => (r?.dias ?? []).filter((d) => d.data <= hoje).reverse(), [r, hoje]);
  const horasDoDia = (d: ResultadoDiaCLT) => {
    if (d.marcacoes.length === 0) return null;
    return d.marcacoes.map((m) => fmtHora(m)).join(' · ');
  };

  return (
    <>
      <div className={vt.crumb}><button onClick={onVoltar}>← Todos os funcionários</button><span>/</span><span>{nome || ap?.nome}</span><span>/</span><span>{rotuloMes(mes)}</span></div>

      {carregando && !ap && <p className={css.carregando}>Apurando…</p>}

      {r && (
        <div className={css.dois}>
          <div>
            <div className={vt.kpis} style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(125px, 1fr))' }}>
              <div className={vt.kpi}><div className={vt.kpiK}>Trabalhado</div><div className={vt.kpiV}>{minutosParaHhMm(r.totalTrabalhadoMin)}</div></div>
              <div className={vt.kpi}><div className={vt.kpiK}>Previsto</div><div className={vt.kpiV}>{minutosParaHhMm(r.totalContratadoMin)}</div></div>
              <div className={`${vt.kpi} ${r.totalExtrasMin > 0 ? vt.kpiPeach : ''}`}><div className={vt.kpiK}>Extras</div><div className={vt.kpiV}>{r.totalExtrasMin > 0 ? `+${minutosParaHhMm(r.totalExtrasMin)}` : '—'}</div></div>
              <div className={`${vt.kpi} ${r.totalAtrasoMin > 0 ? vt.kpiAlerta : ''}`}><div className={vt.kpiK}>Atrasos</div><div className={vt.kpiV}>{r.totalAtrasoMin > 0 ? `−${minutosParaHhMm(r.totalAtrasoMin)}` : '—'}</div></div>
              <div className={`${vt.kpi} ${r.totalFaltaMin > 0 ? vt.kpiAlerta : ''}`}><div className={vt.kpiK}>Faltas</div><div className={vt.kpiV}>{r.totalFaltaMin > 0 ? minutosParaHhMm(r.totalFaltaMin) : '—'}</div></div>
            </div>

            <div className={css.card}>
              <h3>Dias do mês <span className={css.h3sub}>· clique no dia para ver as batidas</span></h3>
              {dias.length === 0 && <div className={css.vazio}>Nenhum dia apurado neste mês.</div>}
              <div className={css.dias}>
                {dias.map((d) => {
                  const motivo = motivoDoDia(d.data);
                  const folga = (d.ehDescansoDia || !!motivo) && d.marcacoes.length === 0;
                  const faltou = d.faltaMin > 0 && d.marcacoes.length === 0;
                  const alerta = d.paresIncompletos || faltou;
                  const horas = horasDoDia(d);
                  return (
                    <button key={d.data} className={`${css.dia} ${alerta ? css.diaAlerta : ''} ${folga ? css.diaFolga : ''}`} onClick={() => onDia(d.data)}>
                      <span className={css.dN}>{d.data.slice(8, 10)}<small>{diaSemanaCurto(d.data)}</small></span>
                      <span className={css.dM}>
                        {motivo ?? (horas ? <>{horas}{d.paresIncompletos && <span className={css.neg}> · em aberto</span>}</> : folga ? 'Folga' : faltou ? 'Sem batida' : '—')}
                      </span>
                      <span className={css.dTags}>
                        {faltou && <span className={`${vt.pill} ${vt.pillErr}`}>falta</span>}
                        {d.paresIncompletos && <span className={`${vt.pill} ${vt.pillErr}`}>faltou bater</span>}
                        {d.atrasoMin > 0 && <span className={`${vt.pill} ${vt.pillErr}`}>atraso {minutosParaHhMm(d.atrasoMin)}</span>}
                        {d.penalidadeIntervaloMin > 0 && <span className={`${vt.pill} ${vt.pillWarn}`}>intervalo curto</span>}
                        {d.violacaoInterjornada && <span className={`${vt.pill} ${vt.pillWarn}`}>descanso &lt; 11h</span>}
                      </span>
                      <span className={`${css.dS} ${d.saldoMin > 0 ? vt.pos : d.saldoMin < 0 ? vt.neg : ''}`}>
                        {d.paresIncompletos || d.marcacoes.length === 0 ? '' : comSinal(d.saldoMin)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div>
            {ap?.banco ? (
              <div className={css.banco}>
                <div className={css.bK}>Banco de horas · saldo atual</div>
                <div className={`${css.bBig} ${ap.banco.saldoAcumuladoMin < 0 ? css.bBigNeg : ''}`}>{comSinal(ap.banco.saldoAcumuladoMin)}</div>
                {ap.banco.formaCalculo === 'INTRA_MES' ? (
                  <div className={css.bAviso}>Regra intra-mês: compensa só dentro do mês, nada passa pro seguinte.</div>
                ) : (
                  <div className={css.bLinha}><span>Veio dos meses anteriores (fechado)</span><span className={css.bM}>{comSinal(ap.banco.saldoAnteriorMin)}</span></div>
                )}
                <div className={css.bLinha}><span>{rotuloMes(mes).split(' de ')[0]} {ap.banco.fechada ? '(fechado)' : 'até agora (em andamento)'}</span><span className={`${css.bM} ${ap.banco.saldoMesMin < 0 ? css.bNeg : ''}`}>{comSinal(ap.banco.saldoMesMin)}</span></div>
                {ap.banco.avulsoMin !== 0 && <div className={css.bLinha}><span>Folgas, pagamentos e ajustes</span><span className={`${css.bM} ${ap.banco.avulsoMin < 0 ? css.bNeg : ''}`}>{comSinal(ap.banco.avulsoMin)}</span></div>}
                <div className={`${css.bLinha} ${css.bTotal}`}><span>Saldo acumulado</span><span className={css.bM}>{comSinal(ap.banco.saldoAcumuladoMin)}</span></div>
                {ap.banco.desatualizado && <div className={css.bAviso}>Este mês estava fechado com outro valor e foi reaberto: o banco é refeito sozinho na próxima consulta.</div>}
                <div className={css.bNota}>Os meses fecham sozinhos no dia 1º. Ajuste aprovado ou atestado abonado refazem o mês.</div>
              </div>
            ) : (
              <div className={css.card}><h3>Banco de horas</h3><p className={css.vazio}>Este funcionário não tem banco de horas: a hora extra é paga na folha.</p></div>
            )}

            <div className={css.card}>
              <h3>Ações</h3>
              <div className={vt.acoes}>
                <Botao variante="coral" className={vt.btn} onClick={baixarEspelho} disabled={baixando}>{baixando ? 'Gerando…' : 'Espelho de ponto (PDF)'}</Botao>
                <Link to={`/rh/apuracao?emp=${empregadoId}&mes=${mes}`} className={css.linkBtn}>Apuração CLT</Link>
                <Link to="/rh/banco" className={css.linkBtn}>Extrato do banco</Link>
                <Link to="/rh/ajustes" className={css.linkBtn}>Ajustes de ponto</Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------------- Nível 3: um dia (tela anterior) ---------------- */

function DiaFuncionario({ data, empregadoId, nome, mes, onTodos, onMes, onErro }: {
  data: string; empregadoId: string; nome: string; mes: string;
  onTodos: () => void; onMes: () => void; onErro: (m: string | null) => void;
}) {
  const [esp, setEsp] = useState<EspelhoResp | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    let vivo = true;
    setCarregando(true); onErro(null);
    api.get<EspelhoResp>(`/tratamento/espelho?empregadoId=${empregadoId}&data=${data}`)
      .then((r) => { if (vivo) setEsp(r); })
      .catch((e) => { if (vivo) { onErro((e as Error).message); setEsp(null); } })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [empregadoId, data, onErro]);

  const r = esp?.resumo;

  return (
    <>
      <div className={vt.crumb}>
        <button onClick={onTodos}>← Todos</button><span>/</span>
        <button onClick={onMes}>{nome || esp?.nome}</button><span>/</span>
        <span>{rotuloMes(mes)}</span><span>/</span><span>{fmtDia(data)} ({diaSemanaCurto(data)})</span>
      </div>

      {carregando && !esp && <div className={css.vazio}>Carregando…</div>}

      {esp && (
        <div className={css.grid}>
          <div className={css.timeline}>
            <div className={css.tHead}>Batidas de {esp.nome.split(' ')[0]} — {fmtDia(data)}</div>
            {(() => {
              const todas: Array<{ dt: string | Date; nsr?: number; offline?: boolean; fora?: boolean; obs?: string | null; defSeg?: number | null; lat?: number | null; desc?: boolean; origem: 'O' | 'A'; ajusteId?: string }> = [];
              for (const m of esp.marcacoes) todas.push({ dt: m.dtMarcacao, nsr: m.nsr, offline: m.offline, fora: m.fora, obs: m.observacao, defSeg: m.defasagemSeg, lat: m.latitude, desc: m.desconsiderada, origem: 'O' });
              for (const inc of (esp.incluidas ?? [])) todas.push({ dt: inc.dtMarcacao, origem: 'A', ajusteId: (inc as { ajusteId?: string }).ajusteId });
              todas.sort((a, b) => new Date(a.dt).getTime() - new Date(b.dt).getTime());
              const ativas = todas.filter((t) => !t.desc);
              if (todas.length === 0) return <div className={css.vazio}>Nenhuma batida nesse dia.</div>;
              return todas.map((t, i) => {
                const idx = ativas.indexOf(t);
                const rotulo = idx >= 0 ? rotuloMarcacaoPorHora(String(t.dt), esp.horarioPares ?? [], idx, esp.esperadas || ativas.length) : 'Desconsiderada';
                return (
                  <div key={`b${i}`} className={`${css.row} ${t.desc ? css.riscado : ''}`}>
                    <span className={`${css.dot} ${t.desc ? css.desc : idx % 2 === 0 ? css.e : css.s}`} />
                    <span>
                      <span className={css.k}>{rotulo}</span>
                      {t.origem === 'A' && <>
                        <span className={css.ajTag}>Ajuste</span>
                        <button className={css.revogarBtn} onClick={async (ev) => {
                          ev.stopPropagation();
                          if (!confirm('Revogar este ajuste? A batida será removida da apuração.')) return;
                          try { await api.del(`/ajustes/${t.ajusteId}`); window.location.reload(); } catch (e) { alert((e as Error).message); }
                        }}>revogar</button>
                      </>}
                      {t.desc && <span className={css.descTag}>Desconsiderada</span>}
                    </span>
                    <span className={css.t}>{fmtHora(String(t.dt))}</span>
                    <span className={css.nsr}>{t.nsr != null ? `NSR #${String(t.nsr).padStart(5, '0')}` : 'ajuste'}</span>
                  </div>
                );
              });
            })()}
            {r?.paresIncompletos && <div className={css.aviso}>Batida em aberto — falta uma saída/entrada.</div>}
            <div className={vt.acoes} style={{ marginTop: 14 }}>
              <Link to={`/rh/ajustes?emp=${empregadoId}&data=${data}`} className={css.linkBtn}>Lançar ajuste neste dia</Link>
            </div>
          </div>

          {r && (
            <div className={css.resumo}>
              <div className={css.rHead}>Resumo do dia</div>
              <div className={css.metric}><span className={css.mL}>Trabalhado</span><span className={css.mV}>{minutosParaHhMm(r.minutosTrabalhados)}</span></div>
              <div className={css.metric}><span className={css.mL}>Contratado</span><span className={css.mVsub}>{minutosParaHhMm(r.minutosContratados)}</span></div>
              <div className={css.metric}>
                <span className={css.mL}>Saldo</span>
                <span className={`${css.mV} ${r.saldoMinutos >= 0 ? css.pos : css.neg}`}>{r.saldoMinutos > 0 ? '+' : ''}{minutosParaHhMm(r.saldoMinutos)}</span>
              </div>
              <div className={css.metric}><span className={css.mL}>Noturno (22h–05h)</span><span className={css.mVsub}>{minutosParaHhMm(r.minutosNoturnos)}</span></div>
              <div className={css.disclaimer}>
                {r.paresIncompletos
                  ? 'Com batida em aberto, o dia não entra no banco de horas até ser fechado (ou ajustado).'
                  : 'Saldo do dia pela jornada contratada. O que vai pro banco segue a regra do funcionário (destinação de atrasos e faltas).'}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
