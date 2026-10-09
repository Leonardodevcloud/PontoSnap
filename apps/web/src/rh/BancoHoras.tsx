import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { hojeSP, minutosParaHhMm } from '../lib/formato';
import { Botao } from '../components/Botao';
import { Campo } from '../components/Campo';
import type {
  BancoResp, ConfigBanco, Empregado, TipoAcordoBanco,
  CompetenciaLancada, LoteResultado, ResumoBanco, LinhaResumoBanco, AberturaBanco,
} from '../tipos';
import css from './BancoHoras.module.css';
import vt from './VisaoTodos.module.css';

const fmtData = (d: string) => new Date(`${d}T12:00:00-0300`).toLocaleDateString('pt-BR');
const fmtDataHora = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
const fmtComp = (c: string) => new Date(`${c}-01T12:00:00-0300`)
  .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const comSinal = (m: number) => `${m > 0 ? '+' : m < 0 ? '−' : ''}${minutosParaHhMm(Math.abs(m))}`;

const ACORDOS: { v: TipoAcordoBanco; t: string; d: string }[] = [
  { v: 'NENHUM', t: 'Não usamos', d: 'Hora extra é paga na folha. O funcionário nem vê a aba.' },
  { v: 'INDIVIDUAL', t: 'Acordo individual', d: 'Escrito com cada funcionário. Compensar em até 6 meses.' },
  { v: 'COLETIVO', t: 'Acordo coletivo', d: 'Via sindicato. Compensar em até 12 meses.' },
];
const rotuloAcordo = (t: TipoAcordoBanco) => ACORDOS.find((a) => a.v === t)?.t ?? '—';

/** Mesmas descrições que a API grava (banco/acerto-mes.ts). */
const DESC_ABERTURA = 'Saldo importado do sistema anterior';
const SUFIXO_BAIXA_ABERTURA = '(saldo de abertura)';

/** "12:30", "12h30" ou "12" → minutos. Null se inválido. */
function hhmmParaMin(v: string): number | null {
  const limpo = v.trim().replace('h', ':').replace(/[^\d:]/g, '');
  if (!limpo) return null;
  const [h, m] = limpo.split(':');
  const horas = Number(h || 0);
  const mins = Number(m || 0);
  if (Number.isNaN(horas) || Number.isNaN(mins) || mins >= 60) return null;
  return horas * 60 + mins;
}
const minParaHhmm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

/** Últimos meses (AAAA-MM), do atual pra trás. */
function ultimosMeses(n: number): string[] {
  const [a, m] = hojeSP().slice(0, 7).split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(a!, m! - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

/** Resumo curto da regra do banco de um funcionário. */
const regraCurta = (l: { formaCalculo: string; negativoMes?: string; tipoAcordo: TipoAcordoBanco; prazoMeses?: number | null }) =>
  l.formaCalculo === 'INTRA_MES'
    ? `paga a diferença no mês · devendo ${l.negativoMes === 'CARREGA' ? 'passa' : 'desconta'}`
    : `${l.tipoAcordo === 'COLETIVO' ? 'coletivo' : 'individual'} · ${l.prazoMeses}m`;

interface Cobertura { total: number; comRegraPropria: number; seguindoEmpresa: number; comBanco: number; semBanco: number; opcoesBanco: number }

export function BancoHoras() {
  const [cfg, setCfg] = useState<ConfigBanco | null>(null);
  const [tipo, setTipo] = useState<TipoAcordoBanco>('NENHUM');
  const [prazo, setPrazo] = useState('');
  const [editandoAcordo, setEditandoAcordo] = useState(false);

  const [emps, setEmps] = useState<Empregado[]>([]);
  const [comp, setComp] = useState(hojeSP().slice(0, 7));
  const [modoLancar, setModoLancar] = useState<'lote' | 'individual'>('lote');
  const [selLancar, setSelLancar] = useState('');
  const [resultado, setResultado] = useState<LoteResultado | null>(null);

  const [historico, setHistorico] = useState<CompetenciaLancada[]>([]);
  const [expandido, setExpandido] = useState<string | null>(null);

  // Funcionário selecionado vive na URL (?emp=): sem ele, a aba mostra a
  // tabela de todos; com ele, o detalhe (ações + extrato).
  const [params, setParams] = useSearchParams();
  const sel = params.get('emp') ?? '';
  const setSel = useCallback((id: string) => {
    setParams((atual) => { const n = new URLSearchParams(atual); if (id) n.set('emp', id); else n.delete('emp'); return n; });
  }, [setParams]);
  const [banco, setBanco] = useState<BancoResp | null>(null);

  // Visão de todos
  const [resumo, setResumo] = useState<ResumoBanco | null>(null);
  const [resumoCarregando, setResumoCarregando] = useState(false);
  const [busca, setBusca] = useState('');
  const carregarResumo = useCallback(async () => {
    setResumoCarregando(true);
    try { setResumo(await api.get<ResumoBanco>(`/banco/resumo?hoje=${hojeSP()}`)); }
    catch (e) { setErro((e as Error).message); }
    finally { setResumoCarregando(false); }
  }, []);

  // Folga compensatória
  const [folgaData, setFolgaData] = useState(hojeSP());
  const [folgaHoras, setFolgaHoras] = useState('');
  const [regFolga, setRegFolga] = useState(false);

  // Saldo de abertura (migração do sistema anterior)
  const [abData, setAbData] = useState(hojeSP());
  const [abHoras, setAbHoras] = useState('');
  const [abSinal, setAbSinal] = useState<'mais' | 'menos'>('mais');
  const [abEnviando, setAbEnviando] = useState(false);
  const [abMsg, setAbMsg] = useState<string | null>(null);

  // Organização da tela: aba ativa e qual ação (folga/abertura) está aberta.
  const [aba, setAba] = useState<'empresa' | 'funcionario'>('funcionario');
  const [acao, setAcao] = useState<'folga' | 'abertura' | 'baixa' | null>(null);
  const [removendo, setRemovendo] = useState<string | null>(null);

  const [erro, setErro] = useState<string | null>(null);

  const [cob, setCob] = useState<Cobertura | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [lancando, setLancando] = useState(false);

  const carregarCfg = useCallback(async () => {
    try {
      const c = await api.get<ConfigBanco>('/banco/config');
      api.get<Cobertura>('/banco/cobertura').then(setCob).catch(() => {});
      setCfg(c); setTipo(c.tipoAcordo);
      setPrazo(c.prazoMeses != null ? String(c.prazoMeses) : '');
      setEditandoAcordo(false);
    } catch (e) { setErro((e as Error).message); }
  }, []);

  const carregarHistorico = useCallback(async () => {
    try { setHistorico(await api.get<CompetenciaLancada[]>('/banco/competencias')); }
    catch { /* histórico é secundário */ }
  }, []);

  useEffect(() => { void carregarCfg(); }, [carregarCfg]);
  useEffect(() => {
    (async () => { try { setEmps(await api.get<Empregado[]>('/empregados')); } catch { /* secundário */ } })();
  }, []);
  useEffect(() => { if (cfg?.ativo) void carregarHistorico(); }, [cfg?.ativo, carregarHistorico]);

  const carregarBanco = useCallback(async (id: string) => {
    if (!id) { setBanco(null); return; }
    try { setBanco(await api.get<BancoResp>(`/banco/extrato?empregadoId=${id}&hoje=${hojeSP()}`)); }
    catch (e) { setErro((e as Error).message); }
  }, []);
  useEffect(() => { void carregarBanco(sel); }, [carregarBanco, sel]);
  useEffect(() => { if (aba === 'funcionario' && !sel) void carregarResumo(); }, [aba, sel, carregarResumo]);

  async function salvarCfg() {
    setErro(null); setSalvando(true);
    try {
      await api.post('/banco/config', {
        tipoAcordo: tipo,
        prazoMeses: tipo === 'NENHUM' ? null : (prazo.trim() ? Number(prazo) : undefined),
      });
      await carregarCfg();
    } catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }

  const [sincronizando, setSincronizando] = useState(false);
  const [sincMsg, setSincMsg] = useState<string | null>(null);
  async function sincronizarAgora() {
    setErro(null); setSincMsg(null); setSincronizando(true);
    try {
      const r = await api.post<{ funcionarios: number; fechadas: number }>('/banco/sincronizar', {});
      setSincMsg(r.fechadas === 0
        ? `Tudo em dia: nenhum mês pendente (${r.funcionarios} funcionário${r.funcionarios === 1 ? '' : 's'} com banco).`
        : `${r.fechadas} fechamento${r.fechadas === 1 ? '' : 's'} feito${r.fechadas === 1 ? '' : 's'} agora.`);
      await Promise.all([carregarHistorico(), carregarBanco(sel)]);
    } catch (e) { setErro((e as Error).message); }
    finally { setSincronizando(false); }
  }

  async function lancarLote() {
    if (!confirm(`Refazer ${fmtComp(comp)} para todos os funcionários com banco? O que esse mês tinha lançado será recalculado.`)) return;
    setErro(null); setResultado(null); setLancando(true);
    try {
      const r = await api.post<LoteResultado>('/banco/lancar-lote', { competencia: comp });
      setResultado(r);
      await Promise.all([carregarHistorico(), carregarBanco(sel)]);
    } catch (e) { setErro((e as Error).message); }
    finally { setLancando(false); }
  }

  async function lancarIndividual() {
    if (!selLancar) return;
    setErro(null); setResultado(null); setLancando(true);
    try {
      const r = await api.post<{ competencia: string; lancados: number; totalMin: number }>(
        '/banco/lancar-competencia', { empregadoId: selLancar, competencia: comp });
      const nome = emps.find((e) => e.id === selLancar)?.nome ?? 'funcionário';
      setResultado({ competencia: r.competencia, funcionarios: 1, totalMin: r.totalMin,
        porFuncionario: [{ empregadoId: selLancar, nome, minutos: r.totalMin }] });
      await Promise.all([carregarHistorico(), carregarBanco(sel)]);
    } catch (e) { setErro((e as Error).message); }
    finally { setLancando(false); }
  }

  async function registrarFolga() {
    if (!sel) return;
    setErro(null); setMsg(null); setRegFolga(true);
    try {
      const min = folgaHoras.trim() ? Math.round(Number(folgaHoras.replace(',', '.')) * 60) : undefined;
      const r = await api.post<{ minutos: number; data: string }>('/banco/folga', {
        empregadoId: sel, data: folgaData, minutos: min,
      });
      setMsg(`Folga de ${fmtData(r.data)} registrada — ${minutosParaHhMm(r.minutos)} debitados do banco.`);
      setFolgaHoras('');
      await carregarBanco(sel);
      setTimeout(() => setMsg(null), 4000);
    } catch (e) { setErro((e as Error).message); }
    finally { setRegFolga(false); }
  }

  async function pagarVencido() {
    if (!banco?.saldo || banco.saldo.vencidoMin <= 0) return;
    setErro(null);
    try {
      await api.post('/banco/movimento', {
        empregadoId: sel, data: hojeSP(), minutos: -banco.saldo.vencidoMin,
        tipo: 'PAGAMENTO', descricao: 'Saldo vencido pago na folha',
      });
      await carregarBanco(sel);
    } catch (e) { setErro((e as Error).message); }
  }

  async function lancarAbertura() {
    if (!sel) return;
    setAbMsg(null); setErro(null);
    const min = hhmmParaMin(abHoras);
    if (min == null || min === 0) { setErro('Informe o saldo no formato HH:MM (ex.: 12:30).'); return; }
    setAbEnviando(true);
    try {
      const minutos = abSinal === 'menos' ? -min : min;
      await api.post('/banco/movimento', {
        empregadoId: sel, data: abData, minutos,
        tipo: 'AJUSTE', descricao: DESC_ABERTURA,
      });
      const nome = emps.find((e) => e.id === sel)?.nome ?? 'funcionário';
      setAbMsg(`Saldo de abertura de ${abSinal === 'menos' ? '−' : '+'}${minutosParaHhMm(min)} lançado para ${nome}.`);
      setAbHoras('');
      await carregarBanco(sel);
    } catch (e) { setErro((e as Error).message); }
    finally { setAbEnviando(false); }
  }

  async function removerMovimento(id: string, descricao: string) {
    if (!confirm(`Remover o lançamento "${descricao}"? Essa ação desfaz o efeito dele no saldo.`)) return;
    setErro(null); setMsg(null); setRemovendo(id);
    try {
      await api.del(`/banco/movimento/${id}`);
      setMsg('Lançamento removido.');
      await carregarBanco(sel);
    } catch (e) { setErro((e as Error).message); }
    finally { setRemovendo(null); }
  }

  const s = banco?.saldo;
  const maxMes = hojeSP().slice(0, 7);

  return (
    <div className={`${css.tela} ${aba === 'funcionario' && !sel ? css.telaLarga : ''}`}>
      <h2 className={css.h}>Banco de horas</h2>
      <p className={css.sub}>
        Só existe com acordo. Sem ele, a hora extra é paga na folha — e é isso que a lei manda.
        O acordo abaixo é o <strong>padrão da empresa</strong>: vale pra quem não tem uma regra de banco própria.
      </p>

      {erro && <p className={css.erro}>{erro}</p>}
      {msg && <p className={css.ok}>{msg}</p>}

      <div className={css.abas} role="tablist">
        <button role="tab" aria-selected={aba === 'funcionario'}
          className={`${css.aba} ${aba === 'funcionario' ? css.abaOn : ''}`}
          onClick={() => setAba('funcionario')}>Por funcionário</button>
        <button role="tab" aria-selected={aba === 'empresa'}
          className={`${css.aba} ${aba === 'empresa' ? css.abaOn : ''}`}
          onClick={() => setAba('empresa')}>Da empresa</button>
      </div>

      {aba === 'empresa' && <>
      {/* ---------- ACORDO ---------- */}
      {!editandoAcordo && cfg && (
        <div className={css.bloco}>
          <div className={css.blocoH}>Acordo padrão da empresa</div>
          <div className={css.acordoSaved}>
            {cfg.ativo
              ? <>
                  <span className={css.pillOk}><span className={css.dot} />Ativo</span>
                  <span className={css.big}>{rotuloAcordo(cfg.tipoAcordo)}</span>
                  <span className={css.sep}>·</span>
                  <span className={css.muted}>compensar em até <b className={css.mono}>{cfg.prazoMeses} meses</b></span>
                </>
              : <>
                  <span className={css.pillNeutro}><span className={css.dot} />Não usam</span>
                  <span className={css.big}>Sem banco de horas</span>
                  <span className={css.muted}>hora extra é paga na folha</span>
                </>}
            <button className={css.btnEditar} onClick={() => setEditandoAcordo(true)}>
              {cfg.ativo ? 'Editar acordo' : 'Configurar acordo'}
            </button>
          </div>

          {cob && cob.total > 0 && (
            <div className={css.cobertura}>
              <span className={css.cobLinha}>
                <b className={css.mono}>{cob.seguindoEmpresa}</b> de <b className={css.mono}>{cob.total}</b> funcionários seguem este padrão
                {cob.comRegraPropria > 0 && <> · <b className={css.mono}>{cob.comRegraPropria}</b> têm regra de banco própria</>}
              </span>
              <span className={css.cobLinha}>
                Na prática: <b className={css.mono}>{cob.comBanco}</b> com banco, <b className={css.mono}>{cob.semBanco}</b> sem.
              </span>
              <Link to="/rh/regras" className={css.cobLink}>
                {cob.opcoesBanco > 0 ? 'ver as regras de banco →' : 'criar uma regra de banco por funcionário →'}
              </Link>
            </div>
          )}
        </div>
      )}

      {editandoAcordo && (
        <div className={css.bloco}>
          <div className={css.blocoH}>Acordo da empresa</div>
          <div className={css.opcoes}>
            {ACORDOS.map((a) => (
              <button key={a.v}
                className={`${css.opcao} ${tipo === a.v ? css.opcaoOn : ''}`}
                onClick={() => { setTipo(a.v); setPrazo(a.v === 'INDIVIDUAL' ? '6' : a.v === 'COLETIVO' ? '12' : ''); }}>
                <b>{a.t}</b><span>{a.d}</span>
              </button>
            ))}
          </div>
          {tipo !== 'NENHUM' && (
            <>
              <Campo rotulo="Prazo para compensar (meses)" inputMode="numeric"
                value={prazo} onChange={(e) => setPrazo(e.target.value)} placeholder="6" />
              <p className={css.dica}>
                A CLT dá 6 meses no individual e 12 no coletivo.
                <strong> Se a convenção da sua categoria disser outra coisa, ela prevalece.</strong>
              </p>
            </>
          )}
          <div className={css.acoes}>
            <Botao variante="coral" onClick={salvarCfg} disabled={salvando}>
              {salvando ? 'Salvando…' : 'Salvar acordo'}
            </Botao>
            <Botao variante="ghost" onClick={() => { void carregarCfg(); }}>Cancelar</Botao>
          </div>
        </div>
      )}

      {cfg?.ativo && (
        <>
          {/* ---------- FECHAMENTO AUTOMÁTICO ---------- */}
          <div className={css.bloco}>
            <div className={css.blocoH}>Fechamento dos meses</div>
            <p className={css.dica} style={{ marginTop: 0 }}>
              <strong>Automático.</strong> Todo mês encerrado é levado ao banco sozinho (na virada do mês e
              sempre que alguém consulta um saldo). Ajuste de ponto aprovado, atestado abonado, afastamento
              ou folga num mês já fechado fazem o mês ser refeito. Você não precisa lançar nada.
            </p>
            <div className={css.lote}>
              <Botao variante="lime" onClick={sincronizarAgora} disabled={sincronizando}>
                {sincronizando ? 'Verificando…' : 'Verificar pendências agora'}
              </Botao>
              <button className={css.linkish} onClick={() => setModoLancar(modoLancar === 'lote' ? 'individual' : 'lote')}>
                {modoLancar === 'lote' ? 'Refazer um mês…' : 'Fechar'}
              </button>
            </div>
            {sincMsg && <p className={css.ok} style={{ marginTop: 10 }}>{sincMsg}</p>}

            {modoLancar === 'individual' && (
              <div className={css.lote} style={{ marginTop: 12 }}>
                <label className={css.campoMes}>
                  <span className={css.mesLb}>Competência</span>
                  <input className={css.mes} type="month" value={comp} max={maxMes}
                    onChange={(e) => e.target.value && setComp(e.target.value)} />
                </label>
                <select className={css.select} value={selLancar} onChange={(e) => setSelLancar(e.target.value)}>
                  <option value="">Todos os funcionários</option>
                  {emps.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
                <Botao variante="ghost" onClick={selLancar ? lancarIndividual : lancarLote} disabled={lancando}>
                  {lancando ? 'Refazendo…' : 'Refazer mês'}
                </Botao>
              </div>
            )}

            {resultado && (
              <div className={css.result}>
                <span className={css.resultIc}>✓</span>
                <div>
                  <b>{fmtComp(resultado.competencia)} refeito para {resultado.funcionarios} {resultado.funcionarios === 1 ? 'funcionário' : 'funcionários'}.</b>{' '}
                  Saldo do mês no banco: <b className={css.mono}>{comSinal(resultado.totalMin)}</b>.
                </div>
              </div>
            )}
          </div>

          {/* ---------- HISTÓRICO ---------- */}
          <div className={css.bloco}>
            <div className={css.blocoH}>Meses fechados</div>
            {historico.length === 0 && <p className={css.vazio}>Nenhum mês fechado ainda — o primeiro fecha na virada do mês.</p>}
            {historico.length > 0 && (
              <div className={css.hist}>
                <div className={`${css.hrow} ${css.hhead}`}>
                  <span>Competência</span><span>Funcionários</span><span>Total</span><span>Fechado em</span><span />
                </div>
                {historico.map((h) => {
                  const aberto = expandido === h.competencia;
                  return (
                    <div key={h.competencia}>
                      <div className={css.hrow} onClick={() => setExpandido(aberto ? null : h.competencia)}>
                        <span className={css.hcomp}>{fmtComp(h.competencia)} {h.automatico ? <em className={css.hauto}>auto</em> : <em className={css.hauto}>manual</em>}</span>
                        <span className={css.mono}>{h.funcionarios}</span>
                        <span className={`${css.mono} ${h.totalMin >= 0 ? css.pos : css.neg}`}>{comSinal(h.totalMin)}</span>
                        <span className={css.mono}>{fmtDataHora(h.lancadoEm)}</span>
                        <span className={css.chev}>{aberto ? '▾' : '▸'}</span>
                      </div>
                      {aberto && (
                        <div className={css.detalhe}>
                          <div className={css.detTit}>Por funcionário</div>
                          <div className={css.det}>
                            {h.porFuncionario.map((f, i) => (
                              <div key={i} className={css.detItem}>
                                <span className={css.detNome}>{f.nome}</span>
                                <span className={`${css.detV} ${f.minutos >= 0 ? css.pos : css.neg}`}>{comSinal(f.minutos)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
      </>}

      {aba === 'funcionario' && !sel && (
        <TodosFuncionarios resumo={resumo} carregando={resumoCarregando} busca={busca} setBusca={setBusca}
          semBancoEmpresa={!!cfg && !cfg.ativo} onAbrir={setSel} onRecarregar={() => void carregarResumo()} />
      )}

      {aba === 'funcionario' && sel && (
          <div className={css.bloco}>
            <div className={vt.crumb} style={{ marginBottom: 8 }}>
              <button onClick={() => setSel('')}>← Todos os funcionários</button><span>/</span>
              <span>{emps.find((e) => e.id === sel)?.nome ?? '…'}</span>
            </div>
            {cfg && !cfg.ativo && (
              <p className={css.dica} style={{ marginTop: 0 }}>
                O banco de horas está <strong>desativado</strong> para a empresa. Ative o acordo na aba
                <strong> Da empresa</strong> para poder lançar folgas e saldos.
              </p>
            )}
            <div className={css.linha}>
              <select className={css.select} value={sel} onChange={(e) => setSel(e.target.value)}>
                <option value="">Escolha o funcionário…</option>
                {emps.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </select>
            </div>

            {sel && (
              <div className={css.acaoBox}>
                <button className={`${css.acaoH} ${acao === 'folga' ? css.acaoHOn : ''}`}
                  onClick={() => setAcao(acao === 'folga' ? null : 'folga')}>
                  <span>Registrar folga compensatória</span>
                  <span className={css.acaoChev}>{acao === 'folga' ? '▴' : '▾'}</span>
                </button>
                {acao === 'folga' && (
                <div className={css.acaoBody}>
                  <div className={css.folgaLinha}>
                    <input className={css.mes} type="date" value={folgaData} max={hojeSP()}
                      onChange={(e) => e.target.value && setFolgaData(e.target.value)} />
                    <input className={css.folgaH} inputMode="decimal" value={folgaHoras}
                      placeholder="horas (ou jornada do dia)"
                      onChange={(e) => setFolgaHoras(e.target.value)} />
                    <Botao variante="ghost" onClick={registrarFolga} disabled={regFolga}>
                      {regFolga ? 'Registrando…' : 'Registrar folga'}
                    </Botao>
                  </div>
                  <p className={css.dica}>
                    A folga <strong>debita o banco</strong> e faz o dia <strong>não contar como falta</strong>.
                    Deixe as horas em branco pra usar a jornada do dia do funcionário.
                  </p>
                </div>
                )}
              </div>
            )}

            {sel && banco?.ativo && banco.saldo && (
              <CardBaixa key={sel} empregadoId={sel} banco={banco}
                aberto={acao === 'baixa'} onToggle={() => setAcao(acao === 'baixa' ? null : 'baixa')}
                onFeito={() => carregarBanco(sel)} />
            )}

            {sel && (
              <div className={css.acaoBox}>
                <button className={`${css.acaoH} ${acao === 'abertura' ? css.acaoHOn : ''}`}
                  onClick={() => setAcao(acao === 'abertura' ? null : 'abertura')}>
                  <span>Saldo de abertura (migração)</span>
                  <span className={css.acaoChev}>{acao === 'abertura' ? '▴' : '▾'}</span>
                </button>
                {acao === 'abertura' && (
                <div className={css.acaoBody}>
                  <p className={css.dica} style={{ marginTop: 0, marginBottom: 10 }}>
                    Traga o saldo que o funcionário já tinha no sistema anterior. Lance uma vez,
                    na data em que começaram a usar o PontoSnap.
                  </p>
                  <div className={css.folgaLinha}>
                    <input className={css.mes} type="date" value={abData}
                      onChange={(e) => e.target.value && setAbData(e.target.value)} />
                    <input className={css.folgaH} inputMode="numeric" value={abHoras}
                      placeholder="saldo HH:MM (ex.: 12:30)"
                      onChange={(e) => setAbHoras(e.target.value)} />
                  </div>
                  <div className={css.abSinal}>
                    <button type="button"
                      className={`${css.abSinalBtn} ${abSinal === 'mais' ? css.abSinalOn : ''}`}
                      onClick={() => setAbSinal('mais')}>A favor (+) — tem horas guardadas</button>
                    <button type="button"
                      className={`${css.abSinalBtn} ${abSinal === 'menos' ? css.abSinalOnNeg : ''}`}
                      onClick={() => setAbSinal('menos')}>Devendo (−) — deve horas</button>
                  </div>
                  <Botao variante="coral" onClick={lancarAbertura} disabled={abEnviando || !abHoras}>
                    {abEnviando ? 'Lançando…' : 'Lançar saldo de abertura'}
                  </Botao>
                  {abMsg && <p className={css.abOk}>{abMsg}</p>}
                  <p className={css.dica}>
                    Só o <strong>saldo</strong> é trazido. As batidas antigas ficam no sistema anterior
                    (o histórico fiscal de lá).
                  </p>
                </div>
                )}
              </div>
            )}

            {s && (
              <>
                <div className={css.cards}>
                  <div className={css.card}>
                    <div className={css.cL}>{banco!.formaCalculo === 'INTRA_MES' ? (banco!.negativoMes === 'CARREGA' ? 'Devendo de meses anteriores' : 'Saldo (acertado todo mês)') : 'Saldo (meses fechados)'}</div>
                    <div className={css.cV}>{comSinal(s.saldoMin)}</div>
                    {banco!.mesCorrente && (
                      <div className={css.cSub}>
                        mês atual <b className={css.mono}>{comSinal(banco!.mesCorrente.estimadoMin)}</b> · previsão ao fechar <b className={css.mono}>{comSinal(banco!.saldoProjetadoMin ?? s.saldoMin)}</b>
                      </div>
                    )}
                  </div>
                  {banco!.formaCalculo === 'INTRA_MES' ? (() => {
                    const ult = banco!.fechamentos.find((f) => f.acertoMin != null);
                    return (
                      <div className={css.card} style={{ gridColumn: 'span 2' }}>
                        <div className={css.cL}>Último acerto{ult ? ` · ${ult.competencia.slice(5)}/${ult.competencia.slice(0, 4)}` : ''}</div>
                        <div className={`${css.cV} ${ult && ult.acertoMin! < 0 ? css.neg : ''}`}>
                          {!ult ? '—' : ult.acertoMin! > 0 ? `${minutosParaHhMm(ult.acertoMin!)} pagas` : ult.acertoMin! < 0 ? `${minutosParaHhMm(-ult.acertoMin!)} descontadas` : 'nada a acertar'}
                        </div>
                        <div className={css.cSub}>Regra: compensa no mês e paga a diferença · devendo {banco!.negativoMes === 'CARREGA' ? 'passa para o mês seguinte' : 'desconta na folha'}</div>
                      </div>
                    );
                  })() : (
                    <>
                  <div className={css.card}><div className={css.cL}>Vence em 30 dias</div><div className={css.cV}>{s.aVencerMin > 0 ? minutosParaHhMm(s.aVencerMin) : '—'}</div></div>
                  <div className={`${css.card} ${s.vencidoMin > 0 ? css.cardAlerta : ''}`}><div className={css.cL}>Vencido</div><div className={css.cV}>{s.vencidoMin > 0 ? minutosParaHhMm(s.vencidoMin) : '—'}</div></div>
                    </>
                  )}
                </div>

                {s.vencidoMin > 0 && (
                  <div className={css.alerta}>
                    <div>
                      <b>{minutosParaHhMm(s.vencidoMin)} passaram do prazo.</b> Pela lei viraram hora extra
                      e precisam ser pagos em dinheiro, com adicional. Pague na folha e baixe aqui.
                    </div>
                    <Botao variante="coral" onClick={pagarVencido}>Baixar como pago</Botao>
                  </div>
                )}

                <div className={css.blocoH} style={{ marginTop: 18 }}>Extrato</div>
                {banco!.extrato.length === 0 && <p className={css.vazio}>Nenhum movimento.</p>}
                {banco!.extrato.map((m, i) => (
                  <div key={`${m.data}-${i}`} className={css.ext}>
                    <span className={css.extD}>{fmtData(m.data)}</span>
                    <span className={css.extE}>{m.descricao || m.tipo}{m.competencia && (m.tipo === 'PAGAMENTO' || m.tipo === 'AJUSTE'
                      ? <em className={`${css.extTag} ${css.extTagPago}`}>acerto {m.competencia}</em>
                      : <em className={css.extTag}>fechamento {m.competencia}</em>)}
                      {!m.competencia && m.tipo === 'PAGAMENTO' && <em className={`${css.extTag} ${css.extTagPago}`}>pagamento</em>}</span>
                    <span className={`${css.extV} ${m.minutos > 0 ? '' : css.neg}`}>{comSinal(m.minutos)}</span>
                    <span className={css.extAcao}>
                      {/* Só lançamento avulso sai daqui; o de fechamento é refeito junto com o mês. */}
                      {m.id && !m.competencia && (
                        <button className={css.extRemover} title="Remover este lançamento"
                          disabled={removendo === m.id}
                          onClick={() => removerMovimento(m.id!, m.descricao || m.tipo)}>
                          {removendo === m.id ? '…' : '×'}
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
      )}
    </div>
  );
}

/* ---------------- Visão de todos os funcionários ---------------- */

/** "2026-09" → "set/2026" (sem o "de 26", que parece dia). */
const fmtComp2 = (c: string) => {
  const mes = new Date(`${c}-01T12:00:00-0300`).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  return `${mes}/${c.slice(0, 4)}`;
};

function TodosFuncionarios({ resumo, carregando, busca, setBusca, semBancoEmpresa, onAbrir, onRecarregar }: {
  resumo: ResumoBanco | null; carregando: boolean; busca: string; setBusca: (v: string) => void;
  semBancoEmpresa: boolean; onAbrir: (id: string) => void; onRecarregar: () => void;
}) {
  const [ord, setOrd] = useState<{ k: string; asc: boolean }>({ k: 'nome', asc: true });
  const t = resumo?.totais;
  const q = busca.trim().toLowerCase();
  const valor = (l: LinhaResumoBanco, k: string): number | string => {
    if (k === 'nome') return l.nome;
    if (!l.ativo) return -1e9;
    return (l as Record<string, unknown>)[k] as number ?? 0;
  };
  const linhas = (resumo?.linhas ?? [])
    .filter((l) => !q || l.nome.toLowerCase().includes(q) || (l.matricula ?? '').toLowerCase().includes(q))
    .sort((a, b) => {
      const va = valor(a, ord.k), vb = valor(b, ord.k);
      const r = typeof va === 'string' && typeof vb === 'string' ? va.localeCompare(vb, 'pt-BR') : Number(va) - Number(vb);
      return ord.asc ? r : -r;
    });
  const clicar = (k: string) => setOrd((o) => (o.k === k ? { k, asc: !o.asc } : { k, asc: k === 'nome' }));
  const Th = ({ k, t, n }: { k: string; t: string; n?: boolean }) => (
    <th className={`${n ? vt.n : ''} ${ord.k === k ? vt.ord : ''}`} onClick={() => clicar(k)} title="Ordenar">{t}{ord.k === k ? (ord.asc ? ' ▴' : ' ▾') : ''}</th>
  );
  const sinal = (m: number) => (m > 0 ? vt.pos : m < 0 ? vt.neg : vt.mute);
  const mesNome = resumo ? new Date(`${resumo.competencia}-01T12:00:00-0300`).toLocaleDateString('pt-BR', { month: 'long' }) : 'mês atual';

  return (
    <>
      {semBancoEmpresa && (
        <p className={css.dica} style={{ marginTop: 0 }}>
          O banco de horas está <strong>desativado</strong> para a empresa. Só aparecem com saldo os funcionários que têm uma regra própria de banco.
        </p>
      )}
      <div className={css.linha} style={{ marginBottom: 14 }}>
        <input className={vt.busca} placeholder="Buscar por nome ou matrícula" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar funcionário" />
      </div>

      <BaixaAberturas onFeito={onRecarregar} />

      {carregando && !resumo && <p className={css.vazio}>Calculando o banco de todo mundo…</p>}

      {resumo && t && (
        <>
          <div className={vt.kpis}>
            <div className={`${vt.kpi} ${vt.kpiInk}`}><div className={vt.kpiK}>Saldo do banco</div><div className={vt.kpiV}>{comSinal(t.saldoMin)}</div><div className={vt.kpiS}>meses fechados · previsão com {mesNome}: {comSinal(t.projetadoMin)}</div></div>
            <div className={vt.kpi}><div className={vt.kpiK}>Com banco</div><div className={vt.kpiV}>{t.comBanco} / {t.funcionarios}</div><div className={vt.kpiS}>funcionários ativos</div></div>
            <div className={`${vt.kpi} ${t.comVencido > 0 ? vt.kpiAlerta : ''}`}><div className={vt.kpiK}>Vencido</div><div className={vt.kpiV}>{t.vencidoMin > 0 ? minutosParaHhMm(t.vencidoMin) : '—'}</div><div className={vt.kpiS}>{t.comVencido > 0 ? `${t.comVencido} funcionário${t.comVencido === 1 ? '' : 's'} — pagar na folha` : 'nada a pagar'}</div></div>
            <div className={`${vt.kpi} ${t.comAVencer > 0 ? vt.kpiPeach : ''}`}><div className={vt.kpiK}>Vence em 30 dias</div><div className={vt.kpiV}>{t.aVencerMin > 0 ? minutosParaHhMm(t.aVencerMin) : '—'}</div><div className={vt.kpiS}>{t.comAVencer > 0 ? `${t.comAVencer} funcionário${t.comAVencer === 1 ? '' : 's'} — dar folga` : 'nenhum'}</div></div>
            <div className={`${vt.kpi} ${t.devendo > 0 ? vt.kpiAlerta : ''}`}><div className={vt.kpiK}>Devendo horas</div><div className={vt.kpiV}>{t.devendo}</div><div className={vt.kpiS}>com saldo negativo</div></div>
          </div>

          <div className={vt.tab}>
            <div className={vt.scroll}>
              <table className={vt.table} style={{ minWidth: 760 }}>
                <thead><tr>
                  <Th k="nome" t="Funcionário" />
                  <Th k="saldoMin" t="Saldo" n />
                  <Th k="mesCorrenteMin" t={`${mesNome} (em andamento)`} n />
                  <Th k="projetadoMin" t="Previsão" n />
                  <Th k="aVencerMin" t="Vence em 30d" n />
                  <Th k="vencidoMin" t="Vencido" n />
                  <th>Situação</th>
                </tr></thead>
                <tbody>
                  {linhas.length === 0 && <tr><td colSpan={7}><div className={vt.vazio}>{resumo.linhas.length === 0 ? 'Nenhum funcionário ativo.' : 'Ninguém bate com a busca.'}</div></td></tr>}
                  {linhas.map((l) => (
                    <tr key={l.empregadoId} className={vt.row} tabIndex={0} role="button"
                      onClick={() => onAbrir(l.empregadoId)}
                      onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onAbrir(l.empregadoId); } }}>
                      <td><span className={vt.nome}>{l.nome}<small>{l.matricula ? `#${l.matricula} · ` : ''}{l.ativo ? regraCurta(l) : 'sem banco'}</small></span></td>
                      {l.ativo ? (
                        <>
                          <td className={`${vt.n} ${sinal(l.saldoMin)}`}><b>{comSinal(l.saldoMin)}</b></td>
                          <td className={`${vt.n} ${sinal(l.mesCorrenteMin)}`}>{comSinal(l.mesCorrenteMin)}</td>
                          <td className={`${vt.n} ${sinal(l.projetadoMin)} ${vt.mute}`}>{comSinal(l.projetadoMin)}</td>
                          <td className={`${vt.n} ${l.aVencerMin > 0 ? '' : vt.mute}`}>{l.aVencerMin > 0 ? minutosParaHhMm(l.aVencerMin) : '—'}</td>
                          <td className={`${vt.n} ${l.vencidoMin > 0 ? vt.neg : vt.mute}`}>{l.vencidoMin > 0 ? minutosParaHhMm(l.vencidoMin) : '—'}</td>
                          <td>
                            {l.vencidoMin > 0 && <span className={`${vt.pill} ${vt.pillErr}`}>pagar na folha</span>}
                            {l.vencidoMin === 0 && l.aVencerMin > 0 && l.proximoVencimento && <span className={`${vt.pill} ${vt.pillWarn}`}>vence {fmtData(l.proximoVencimento)}</span>}
                            {l.saldoMin < 0 && <span className={`${vt.pill} ${vt.pillWarn}`}>devendo</span>}
                            {l.ultimoFechamento && <span className={`${vt.pill} ${vt.pillMute}`}>fechado até {fmtComp2(l.ultimoFechamento)}</span>}
                            {!l.ultimoFechamento && <span className={`${vt.pill} ${vt.pillMute}`}>sem mês fechado</span>}
                            {l.vencidoMin === 0 && l.aVencerMin === 0 && l.saldoMin >= 0 && <span className={`${vt.pill} ${vt.pillOk}`}>em dia</span>}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className={`${vt.n} ${vt.mute}`} colSpan={5}>extra paga na folha (sem acordo de banco)</td>
                          <td><span className={`${vt.pill} ${vt.pillMute}`}>sem banco</span></td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
                {t.comBanco > 1 && !q && (
                  <tfoot><tr className={vt.tot}>
                    <td>Total · {t.comBanco} com banco</td>
                    <td className={vt.n}>{comSinal(t.saldoMin)}</td>
                    <td className={vt.n}>{comSinal(t.mesCorrenteMin)}</td>
                    <td className={vt.n}>{comSinal(t.projetadoMin)}</td>
                    <td className={vt.n}>{t.aVencerMin > 0 ? minutosParaHhMm(t.aVencerMin) : '—'}</td>
                    <td className={vt.n}>{t.vencidoMin > 0 ? minutosParaHhMm(t.vencidoMin) : '—'}</td>
                    <td />
                  </tr></tfoot>
                )}
              </table>
            </div>
          </div>
          <div className={vt.legenda}>
            <span>Clique no funcionário pra registrar folga, baixar ou corrigir saldo, lançar saldo de abertura e ver o extrato.</span>
            <span>Saldo = só meses fechados. {mesNome} ainda está em andamento e fecha sozinho no dia 1 — até lá é previsão, não saldo.</span>
          </div>
        </>
      )}
    </>
  );
}

/* ---------------- Baixar ou corrigir saldo (um funcionário) ---------------- */

function CardBaixa({ empregadoId, banco, aberto, onToggle, onFeito }: {
  empregadoId: string; banco: BancoResp; aberto: boolean; onToggle: () => void; onFeito: () => Promise<void> | void;
}) {
  // Saldo de abertura que ainda não saiu do banco (pra sugerir a baixa).
  const ab = banco.extrato.filter((m) => !m.competencia && m.descricao === DESC_ABERTURA);
  const aberturaMin = ab.reduce((s, m) => s + m.minutos, 0);
  const aberturaData = ab.map((m) => m.data).sort()[0] ?? null;
  const baixadoMin = banco.extrato.filter((m) => !m.competencia && (m.descricao ?? '').endsWith(SUFIXO_BAIXA_ABERTURA))
    .reduce((s, m) => s - m.minutos, 0);
  const restanteAbertura = Math.max(0, aberturaMin - baixadoMin);

  const meses = ultimosMeses(7);
  const [modo, setModo] = useState<'pago' | 'corr'>('pago');
  const [horas, setHoras] = useState(restanteAbertura > 0 ? minParaHhmm(restanteAbertura) : '');
  const [comp, setComp] = useState(meses[1]!);
  const [data, setData] = useState(hojeSP());
  const [deAbertura, setDeAbertura] = useState(restanteAbertura > 0);
  const [sinal, setSinal] = useState<'mais' | 'menos'>('menos');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const min = hhmmParaMin(horas);
  const saldo = banco.saldo?.saldoMin ?? 0;
  const delta = min == null ? 0 : modo === 'pago' ? -min : sinal === 'mais' ? min : -min;
  const desc = modo === 'pago'
    ? `Horas pagas na folha de ${fmtComp2(comp)}${deAbertura ? ` ${SUFIXO_BAIXA_ABERTURA}` : ''}`
    : (motivo.trim() || '(seu motivo)');
  const hh = min != null ? minutosParaHhMm(min) : '';

  async function enviar() {
    setErro(null); setOk(null);
    if (min == null || min === 0) { setErro('Informe as horas no formato HH:MM (ex.: 12:30).'); return; }
    if (modo === 'pago' && deAbertura && min > restanteAbertura) {
      setErro(`Do saldo de abertura só restam ${minutosParaHhMm(restanteAbertura)} para baixar.`); return;
    }
    if (modo === 'corr' && motivo.trim().length < 5) { setErro('Escreva o motivo da correção: ele aparece no extrato e no app do funcionário.'); return; }
    setEnviando(true);
    try {
      await api.post('/banco/movimento', {
        empregadoId,
        data: modo === 'pago' && deAbertura && aberturaData ? aberturaData : data,
        minutos: delta,
        tipo: modo === 'pago' ? 'PAGAMENTO' : 'AJUSTE',
        descricao: modo === 'pago' ? desc : motivo.trim(),
      });
      setOk(modo === 'pago' ? `${hh} baixadas como pagas na folha de ${fmtComp2(comp)}.` : `Correção de ${delta > 0 ? '+' : '−'}${hh} lançada.`);
      setHoras(''); setMotivo(''); setDeAbertura(false);
      await onFeito();
    } catch (e) { setErro((e as Error).message); }
    finally { setEnviando(false); }
  }

  return (
    <div className={css.acaoBox}>
      <button className={`${css.acaoH} ${aberto ? css.acaoHOn : ''}`} onClick={onToggle} aria-expanded={aberto}>
        <span>Baixar ou corrigir saldo</span>
        <span className={css.acaoChev}>{aberto ? '▴' : '▾'}</span>
      </button>
      {aberto && (
        <div className={css.acaoBody}>
          <div className={css.modos} role="radiogroup" aria-label="Tipo de lançamento">
            <button type="button" role="radio" aria-checked={modo === 'pago'} className={`${css.modo} ${modo === 'pago' ? css.modoOn : ''}`}
              onClick={() => { setModo('pago'); setOk(null); }}>
              <b>Pago na folha</b><span>As horas foram (ou serão) pagas em dinheiro. Saem do banco como pagamento.</span>
            </button>
            <button type="button" role="radio" aria-checked={modo === 'corr'} className={`${css.modo} ${modo === 'corr' ? css.modoOn : ''}`}
              onClick={() => { setModo('corr'); setDeAbertura(false); setOk(null); }}>
              <b>Correção de erro</b><span>Lançamento errado. Ajusta o saldo com motivo obrigatório.</span>
            </button>
          </div>

          <div className={css.campos3}>
            <label className={css.campoB}><span>Horas</span>
              <input className={`${css.folgaH} ${css.mono}`} inputMode="numeric" placeholder="HH:MM" value={horas} onChange={(e) => setHoras(e.target.value)} />
            </label>
            {modo === 'pago' ? (
              <label className={css.campoB}><span>Pago na folha de</span>
                <select className={css.select} value={comp} onChange={(e) => setComp(e.target.value)}>
                  {meses.map((m) => <option key={m} value={m}>{fmtComp(m)}</option>)}
                </select>
              </label>
            ) : (
              <div className={css.campoB}><span>Somar ou tirar</span>
                <div className={css.abSinal} style={{ margin: 0 }}>
                  <button type="button" className={`${css.abSinalBtn} ${sinal === 'mais' ? css.abSinalOn : ''}`} onClick={() => setSinal('mais')} aria-pressed={sinal === 'mais'}>Somar (+)</button>
                  <button type="button" className={`${css.abSinalBtn} ${sinal === 'menos' ? css.abSinalOnNeg : ''}`} onClick={() => setSinal('menos')} aria-pressed={sinal === 'menos'}>Tirar (−)</button>
                </div>
              </div>
            )}
            <label className={css.campoB}><span>Data</span>
              <input className={css.mes} type="date" value={modo === 'pago' && deAbertura && aberturaData ? aberturaData : data}
                disabled={modo === 'pago' && deAbertura} max={hojeSP()}
                onChange={(e) => e.target.value && setData(e.target.value)} />
            </label>
          </div>

          {modo === 'pago' && restanteAbertura > 0 && (
            <label className={css.chkAb}>
              <input type="checkbox" checked={deAbertura} onChange={(e) => {
                setDeAbertura(e.target.checked);
                if (e.target.checked && !horas) setHoras(minParaHhmm(restanteAbertura));
              }} />
              <span>É o <strong>saldo de abertura</strong> ({minutosParaHhMm(restanteAbertura)} ainda no banco, importado em {fmtData(aberturaData!)}). A baixa entra na mesma data dele.</span>
            </label>
          )}
          {modo === 'corr' && (
            <label className={css.campoB} style={{ marginTop: 10 }}><span>Motivo (aparece no extrato e no app do funcionário)</span>
              <textarea className={css.motivo} rows={2} maxLength={160} value={motivo} placeholder="ex.: saldo de abertura lançado em dobro na migração"
                onChange={(e) => setMotivo(e.target.value)} />
            </label>
          )}

          <div className={css.prev}>
            <div><div className={css.prevK}>Saldo hoje</div><div className={css.prevV}>{comSinal(saldo)}</div></div>
            <div className={css.prevSeta} aria-hidden>→</div>
            <div><div className={css.prevK}>Depois</div><div className={css.prevV}>{comSinal(saldo + delta)}</div></div>
            <div className={css.prevDesc}>No extrato:<br /><b>“{desc}”</b></div>
          </div>
          <Botao variante="coral" onClick={enviar} disabled={enviando || !horas}>
            {enviando ? 'Lançando…' : modo === 'pago' ? `Baixar ${hh || 'horas'} como pago` : `${sinal === 'mais' ? 'Somar' : 'Tirar'} ${hh || 'horas'} ${sinal === 'mais' ? 'ao' : 'do'} banco`}
          </Botao>
          {ok && <p className={css.abOk}>{ok}</p>}
          {erro && <p className={css.erro} role="alert">{erro}</p>}
          <p className={css.dica}>Fica registrado na auditoria quem lançou. Dá para desfazer pelo × do extrato.</p>
        </div>
      )}
    </div>
  );
}

/* ---------------- Baixa em lote do saldo de abertura ---------------- */

function BaixaAberturas({ onFeito }: { onFeito: () => void }) {
  const [lista, setLista] = useState<AberturaBanco[] | null>(null);
  const [aberto, setAberto] = useState(false);
  const meses = ultimosMeses(7);
  const [comp, setComp] = useState(meses[1]!);
  const [marcados, setMarcados] = useState<Record<string, boolean>>({});
  const [valores, setValores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const l = await api.get<AberturaBanco[]>('/banco/aberturas');
      setLista(l);
      setMarcados(Object.fromEntries(l.filter((a) => a.restanteMin > 0).map((a) => [a.empregadoId, true])));
      setValores(Object.fromEntries(l.map((a) => [a.empregadoId, minParaHhmm(a.restanteMin)])));
    } catch { setLista([]); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const pendentes = (lista ?? []).filter((a) => a.restanteMin > 0);
  if (!lista || (pendentes.length === 0 && !ok)) return null;

  const itens = pendentes.filter((a) => marcados[a.empregadoId]).map((a) => ({ a, min: hhmmParaMin(valores[a.empregadoId] ?? '') }));
  const invalido = itens.find((i) => i.min == null || i.min <= 0 || i.min > i.a.restanteMin);
  const total = itens.reduce((s, i) => s + (i.min ?? 0), 0);
  const todos = pendentes.length > 0 && pendentes.every((a) => marcados[a.empregadoId]);

  async function baixar() {
    setErro(null); setOk(null);
    if (invalido) { setErro(`${invalido.a.nome}: informe até ${minutosParaHhMm(invalido.a.restanteMin)} (HH:MM).`); return; }
    if (!itens.length) return;
    if (!confirm(`Baixar ${minutosParaHhMm(total)} de ${itens.length} funcionário${itens.length === 1 ? '' : 's'} como pago na folha de ${fmtComp(comp)}?`)) return;
    setEnviando(true);
    try {
      const r = await api.post<{ baixados: number; totalMin: number }>('/banco/baixa-abertura', {
        competenciaFolha: comp, itens: itens.map((i) => ({ empregadoId: i.a.empregadoId, minutos: i.min! })),
      });
      setOk(`${r.baixados} funcionário${r.baixados === 1 ? '' : 's'} · ${minutosParaHhMm(r.totalMin)} baixadas como pagas na folha de ${fmtComp2(comp)}.`);
      await carregar();
      onFeito();
    } catch (e) { setErro((e as Error).message); }
    finally { setEnviando(false); }
  }

  return (
    <div className={css.acaoBox} style={{ marginTop: 0, marginBottom: 14 }}>
      <button className={`${css.acaoH} ${aberto ? css.acaoHOn : ''}`} onClick={() => setAberto(!aberto)} aria-expanded={aberto}>
        <span>Baixar saldos de abertura pagos na folha · {pendentes.length} funcionário{pendentes.length === 1 ? '' : 's'}</span>
        <span className={css.acaoChev}>{aberto ? '▴' : '▾'}</span>
      </button>
      {aberto && (
        <div className={css.acaoBody}>
          <p className={css.loteAviso}>
            Lista quem ainda tem <strong>saldo de abertura</strong> (importado do sistema anterior) no banco. Marque quem já recebeu essas horas
            em dinheiro: elas saem do banco como <strong>pagamento</strong>, na data do saldo de abertura, sem mexer nas horas dos meses fechados no PontoSnap.
          </p>
          <div className={css.loteTopo}>
            <label className={css.campoB}><span>Pago na folha de</span>
              <select className={css.select} value={comp} onChange={(e) => setComp(e.target.value)}>
                {meses.map((m) => <option key={m} value={m}>{fmtComp(m)}</option>)}
              </select>
            </label>
            <label className={css.chkTodos}>
              <input type="checkbox" checked={todos}
                onChange={(e) => setMarcados(Object.fromEntries(pendentes.map((a) => [a.empregadoId, e.target.checked])))} />
              Marcar todos
            </label>
          </div>
          <div className={vt.tab}>
            <div className={vt.scroll}>
              <table className={vt.table} style={{ minWidth: 680 }}>
                <thead><tr>
                  <th style={{ width: 36 }}><span className={vt.srOnly}>Marcar</span></th>
                  <th>Funcionário</th>
                  <th className={vt.n}>Abertura</th>
                  <th className={vt.n}>Já baixado</th>
                  <th className={vt.n}>Baixar</th>
                  <th className={vt.n}>Fica</th>
                </tr></thead>
                <tbody>
                  {pendentes.map((a) => {
                    const on = !!marcados[a.empregadoId];
                    const v = hhmmParaMin(valores[a.empregadoId] ?? '');
                    const fica = a.restanteMin - (on && v != null ? v : 0);
                    const ruim = on && (v == null || v <= 0 || v > a.restanteMin);
                    return (
                      <tr key={a.empregadoId} className={on ? '' : css.loteOff}>
                        <td><input type="checkbox" checked={on} aria-label={`Baixar ${a.nome}`}
                          onChange={(e) => setMarcados({ ...marcados, [a.empregadoId]: e.target.checked })} /></td>
                        <td><span className={vt.nome}>{a.nome}<small>{!a.bancoAtivo ? 'sem banco ativo' : a.formaCalculo === 'INTRA_MES' ? `paga a diferença no mês · devendo ${a.negativoMes === 'CARREGA' ? 'passa' : 'desconta'}` : 'acumula no banco'} · importado em {fmtData(a.aberturaData)}</small></span></td>
                        <td className={vt.n}>{comSinal(a.aberturaMin)}</td>
                        <td className={`${vt.n} ${a.baixadoMin ? '' : vt.mute}`}>{a.baixadoMin ? minutosParaHhMm(a.baixadoMin) : '—'}</td>
                        <td className={vt.n}>
                          {on ? <input className={`${css.loteInp} ${ruim ? css.loteInpErr : ''}`} inputMode="numeric" aria-label={`Horas a baixar de ${a.nome}`}
                            value={valores[a.empregadoId] ?? ''} onChange={(e) => setValores({ ...valores, [a.empregadoId]: e.target.value })} /> : '—'}
                        </td>
                        <td className={`${vt.n} ${fica === 0 ? vt.mute : ''}`}>{minutosParaHhMm(Math.max(0, fica))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className={css.loteRod}>
            <span><b>{itens.length}</b> funcionário{itens.length === 1 ? '' : 's'} · <b className={css.mono}>{minutosParaHhMm(total)}</b> saem do banco</span>
            <Botao variante="coral" onClick={baixar} disabled={enviando || itens.length === 0}>
              {enviando ? 'Baixando…' : `Baixar ${itens.length} como pago na folha de ${fmtComp2(comp)}`}
            </Botao>
          </div>
          {ok && <p className={css.abOk}>{ok}</p>}
          {erro && <p className={css.erro} role="alert">{erro}</p>}
          <p className={css.dica}>Cada baixa entra no extrato do funcionário como “Horas pagas na folha de {fmtComp2(comp)} (saldo de abertura)” e pode ser desfeita no × do extrato dele.</p>
        </div>
      )}
    </div>
  );
}
