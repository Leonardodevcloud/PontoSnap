import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { hojeSP, minutosParaHhMm } from '../lib/formato';
import { Botao } from '../components/Botao';
import { Campo } from '../components/Campo';
import type {
  BancoResp, ConfigBanco, Empregado, TipoAcordoBanco,
  CompetenciaLancada, LoteResultado, ResumoBanco, LinhaResumoBanco,
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
  const [acao, setAcao] = useState<'folga' | 'abertura' | null>(null);
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

  // Converte "12:30" ou "12h30" ou "12" em minutos. Retorna null se inválido.
  function horasParaMin(v: string): number | null {
    const limpo = v.trim().replace('h', ':').replace(/[^\d:]/g, '');
    if (!limpo) return null;
    const [h, m] = limpo.split(':');
    const horas = Number(h || 0);
    const mins = Number(m || 0);
    if (Number.isNaN(horas) || Number.isNaN(mins) || mins >= 60) return null;
    return horas * 60 + mins;
  }

  async function lancarAbertura() {
    if (!sel) return;
    setAbMsg(null); setErro(null);
    const min = horasParaMin(abHoras);
    if (min == null || min === 0) { setErro('Informe o saldo no formato HH:MM (ex.: 12:30).'); return; }
    setAbEnviando(true);
    try {
      const minutos = abSinal === 'menos' ? -min : min;
      await api.post('/banco/movimento', {
        empregadoId: sel, data: abData, minutos,
        tipo: 'AJUSTE', descricao: 'Saldo importado do sistema anterior',
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
          semBancoEmpresa={!!cfg && !cfg.ativo} onAbrir={setSel} />
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
                    <div className={css.cL}>Saldo atual</div>
                    <div className={css.cV}>{comSinal(banco!.saldoProjetadoMin ?? s.saldoMin)}</div>
                    {banco!.mesCorrente && (
                      <div className={css.cSub}>
                        fechados <b className={css.mono}>{comSinal(s.saldoMin)}</b> · mês atual <b className={css.mono}>{comSinal(banco!.mesCorrente.estimadoMin)}</b>
                      </div>
                    )}
                  </div>
                  <div className={css.card}><div className={css.cL}>Vence em 30 dias</div><div className={css.cV}>{s.aVencerMin > 0 ? minutosParaHhMm(s.aVencerMin) : '—'}</div></div>
                  <div className={`${css.card} ${s.vencidoMin > 0 ? css.cardAlerta : ''}`}><div className={css.cL}>Vencido</div><div className={css.cV}>{s.vencidoMin > 0 ? minutosParaHhMm(s.vencidoMin) : '—'}</div></div>
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
                    <span className={css.extE}>{m.descricao || m.tipo}{m.competencia && <em className={css.extTag}>fechamento {m.competencia}</em>}</span>
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

const fmtComp2 = (c: string) => new Date(`${c}-01T12:00:00-0300`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');

function TodosFuncionarios({ resumo, carregando, busca, setBusca, semBancoEmpresa, onAbrir }: {
  resumo: ResumoBanco | null; carregando: boolean; busca: string; setBusca: (v: string) => void;
  semBancoEmpresa: boolean; onAbrir: (id: string) => void;
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

      {carregando && !resumo && <p className={css.vazio}>Calculando o banco de todo mundo…</p>}

      {resumo && t && (
        <>
          <div className={vt.kpis}>
            <div className={`${vt.kpi} ${vt.kpiInk}`}><div className={vt.kpiK}>Saldo total · projetado</div><div className={vt.kpiV}>{comSinal(t.projetadoMin)}</div><div className={vt.kpiS}>fechados {comSinal(t.saldoMin)} · {mesNome} {comSinal(t.mesCorrenteMin)}</div></div>
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
                  <Th k="saldoMin" t="Fechado" n />
                  <Th k="mesCorrenteMin" t={mesNome} n />
                  <Th k="projetadoMin" t="Saldo atual" n />
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
                      <td><span className={vt.nome}>{l.nome}<small>{l.matricula ? `#${l.matricula} · ` : ''}{l.ativo ? (l.formaCalculo === 'INTRA_MES' ? 'intra-mês' : `${l.tipoAcordo === 'COLETIVO' ? 'coletivo' : 'individual'} · ${l.prazoMeses}m`) : 'sem banco'}</small></span></td>
                      {l.ativo ? (
                        <>
                          <td className={`${vt.n} ${sinal(l.saldoMin)}`}>{comSinal(l.saldoMin)}</td>
                          <td className={`${vt.n} ${sinal(l.mesCorrenteMin)}`}>{comSinal(l.mesCorrenteMin)}</td>
                          <td className={`${vt.n} ${sinal(l.projetadoMin)}`}><b>{comSinal(l.projetadoMin)}</b></td>
                          <td className={`${vt.n} ${l.aVencerMin > 0 ? '' : vt.mute}`}>{l.aVencerMin > 0 ? minutosParaHhMm(l.aVencerMin) : '—'}</td>
                          <td className={`${vt.n} ${l.vencidoMin > 0 ? vt.neg : vt.mute}`}>{l.vencidoMin > 0 ? minutosParaHhMm(l.vencidoMin) : '—'}</td>
                          <td>
                            {l.vencidoMin > 0 && <span className={`${vt.pill} ${vt.pillErr}`}>pagar na folha</span>}
                            {l.vencidoMin === 0 && l.aVencerMin > 0 && l.proximoVencimento && <span className={`${vt.pill} ${vt.pillWarn}`}>vence {fmtData(l.proximoVencimento)}</span>}
                            {l.projetadoMin < 0 && <span className={`${vt.pill} ${vt.pillWarn}`}>devendo</span>}
                            {l.ultimoFechamento && <span className={`${vt.pill} ${vt.pillMute}`}>fechado até {fmtComp2(l.ultimoFechamento)}</span>}
                            {!l.ultimoFechamento && <span className={`${vt.pill} ${vt.pillMute}`}>sem mês fechado</span>}
                            {l.vencidoMin === 0 && l.aVencerMin === 0 && l.projetadoMin >= 0 && <span className={`${vt.pill} ${vt.pillOk}`}>em dia</span>}
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
            <span>Clique no funcionário pra registrar folga, lançar saldo de abertura, pagar vencido e ver o extrato.</span>
            <span>Fechado = meses já fechados · {mesNome} = em andamento, fecha sozinho no dia 1 · Saldo atual = os dois somados.</span>
          </div>
        </>
      )}
    </>
  );
}
