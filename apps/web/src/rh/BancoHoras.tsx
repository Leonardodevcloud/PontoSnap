import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { hojeSP, minutosParaHhMm } from '../lib/formato';
import { Botao } from '../components/Botao';
import { Campo } from '../components/Campo';
import type {
  BancoResp, ConfigBanco, Empregado, TipoAcordoBanco,
  CompetenciaLancada, LoteResultado,
} from '../tipos';
import css from './BancoHoras.module.css';

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

  const [sel, setSel] = useState('');
  const [banco, setBanco] = useState<BancoResp | null>(null);

  // Folga compensatória
  const [folgaData, setFolgaData] = useState(hojeSP());
  const [folgaHoras, setFolgaHoras] = useState('');
  const [regFolga, setRegFolga] = useState(false);

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

  async function lancarLote() {
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

  const s = banco?.saldo;
  const maxMes = hojeSP().slice(0, 7);

  return (
    <div className={css.tela}>
      <h2 className={css.h}>Banco de horas</h2>
      <p className={css.sub}>
        Só existe com acordo. Sem ele, a hora extra é paga na folha — e é isso que a lei manda.
        O acordo abaixo é o <strong>padrão da empresa</strong>: vale pra quem não tem uma regra de banco própria.
      </p>

      {erro && <p className={css.erro}>{erro}</p>}
      {msg && <p className={css.ok}>{msg}</p>}

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
          {/* ---------- LANÇAR COMPETÊNCIA ---------- */}
          <div className={css.bloco}>
            <div className={css.blocoH}>Lançar competência</div>
            <div className={css.lote}>
              <label className={css.campoMes}>
                <span className={css.mesLb}>Competência</span>
                <input className={css.mes} type="month" value={comp} max={maxMes}
                  onChange={(e) => e.target.value && setComp(e.target.value)} />
              </label>
              {modoLancar === 'lote' ? (
                <>
                  <Botao variante="lime" onClick={lancarLote} disabled={lancando}>
                    {lancando ? 'Lançando…' : 'Lançar para todos os ativos'}
                  </Botao>
                  <button className={css.linkish} onClick={() => setModoLancar('individual')}>Um funcionário…</button>
                </>
              ) : (
                <>
                  <select className={css.select} value={selLancar} onChange={(e) => setSelLancar(e.target.value)}>
                    <option value="">Escolha o funcionário…</option>
                    {emps.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                  </select>
                  <Botao variante="lime" onClick={lancarIndividual} disabled={lancando || !selLancar}>
                    {lancando ? 'Lançando…' : 'Lançar'}
                  </Botao>
                  <button className={css.linkish} onClick={() => setModoLancar('lote')}>Todos</button>
                </>
              )}
            </div>

            {resultado && (
              <div className={css.result}>
                <span className={css.resultIc}>✓</span>
                <div>
                  <b>{fmtComp(resultado.competencia)} lançado para {resultado.funcionarios} {resultado.funcionarios === 1 ? 'funcionário' : 'funcionários'}.</b>{' '}
                  Saldo do mês somou <b className={css.mono}>{comSinal(resultado.totalMin)}</b> ao banco.
                </div>
              </div>
            )}

            <p className={css.dica}>
              Leva o saldo de cada dia apurado do mês para o banco. Rodar de novo o mesmo mês
              <strong> substitui</strong> o que aquele mês tinha lançado — pagamentos e ajustes manuais não são tocados.
            </p>
          </div>

          {/* ---------- HISTÓRICO ---------- */}
          <div className={css.bloco}>
            <div className={css.blocoH}>Competências lançadas</div>
            {historico.length === 0 && <p className={css.vazio}>Nenhuma competência lançada ainda.</p>}
            {historico.length > 0 && (
              <div className={css.hist}>
                <div className={`${css.hrow} ${css.hhead}`}>
                  <span>Competência</span><span>Funcionários</span><span>Total</span><span>Lançado em</span><span />
                </div>
                {historico.map((h) => {
                  const aberto = expandido === h.competencia;
                  return (
                    <div key={h.competencia}>
                      <div className={css.hrow} onClick={() => setExpandido(aberto ? null : h.competencia)}>
                        <span className={css.hcomp}>{fmtComp(h.competencia)}</span>
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

          {/* ---------- SALDO POR FUNCIONÁRIO ---------- */}
          <div className={css.bloco}>
            <div className={css.blocoH}>Saldo por funcionário</div>
            <div className={css.linha}>
              <select className={css.select} value={sel} onChange={(e) => setSel(e.target.value)}>
                <option value="">Escolha o funcionário…</option>
                {emps.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </select>
            </div>

            {sel && (
              <div className={css.folga}>
                <div className={css.folgaTit}>Registrar folga compensatória</div>
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

            {s && (
              <>
                <div className={css.cards}>
                  <div className={css.card}><div className={css.cL}>Saldo</div><div className={css.cV}>{comSinal(s.saldoMin)}</div></div>
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
                    <span className={css.extE}>{m.descricao || m.tipo}</span>
                    <span className={`${css.extV} ${m.minutos > 0 ? '' : css.neg}`}>{comSinal(m.minutos)}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
