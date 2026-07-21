import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Cct } from '../tipos';
import css from './Convencoes.module.css';

const VAZIA: Omit<Cct, 'id' | 'funcionarios'> = {
  nome: '', uf: null, vigencia: null,
  extraDiaUtilPct: 50, extraDomingoFeriadoPct: 100, extraLimiteDiarioMin: 120,
  toleranciaDiariaMin: 10, toleranciaPorMarcacaoMin: 5,
  noturnoAdicionalPct: 20, noturnoReduzida: true, noturnoInicioMin: 1320, noturnoFimMin: 300,
  jornadaSemanalMin: 2640, interjornadaMinimaMin: 660, intervaloMaior6hMin: 60,
  bancoPrazoMeses: null,
  bancoModo: 'HERDA', bancoTipoAcordo: null, ativa: true, padrao: false,
  destinacaoFaltas: 'DESCONTA', destinacaoAtrasos: 'BANCO',
  formaCalculo: 'BANCO_HORAS',
};

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const paraMin = (s: string) => { const [h, m] = s.split(':'); return (Number(h) || 0) * 60 + (Number(m) || 0); };

export default function Convencoes() {
  const [lista, setLista] = useState<Cct[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<(typeof VAZIA & { id?: string }) | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try { setLista(await api.get<Cct[]>('/cct')); }
    catch (e) { setErro((e as Error).message); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  function novo() { setEditando({ ...VAZIA }); }
  function editar(c: Cct) { const { funcionarios, id, ...resto } = c; void funcionarios; setEditando({ ...resto, id }); }

  async function salvar() {
    if (!editando) return;
    if (!editando.nome.trim()) { setErro('Dê um nome à regra'); return; }
    setErro(null); setSalvando(true);
    const { id, ...corpo } = editando;
    try {
      if (id) await api.patch(`/cct/${id}`, corpo);
      else await api.post('/cct', corpo);
      setEditando(null);
      await carregar();
    } catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }

  async function remover(c: Cct) {
    if (!confirm(`Remover a regra "${c.nome}"?`)) return;
    setErro(null);
    try { await api.del(`/cct/${c.id}`); await carregar(); }
    catch (e) { setErro((e as Error).message); }
  }

  const e = editando;
  const set = (patch: Partial<typeof VAZIA>) => setEditando((cur) => cur ? { ...cur, ...patch } : cur);
  const numero = (v: string) => (v.trim() === '' ? 0 : Number(v.replace(',', '.')) || 0);

  return (
    <div className={css.tela}>
      <div className={css.top}>
        <div>
          <h1 className={css.h}>Regras de jornada</h1>
          <p className={css.sub}>Cada regra define o cálculo (extra, tolerância, noturno, banco, destinação). Você atribui a regra ao funcionário no cadastro dele.</p>
        </div>
        {!e && <button className={css.novo} onClick={novo}>+ Nova regra</button>}
      </div>

      {erro && <p className={css.erro}>{erro}</p>}

      {!e && (
        <div className={css.card}>
          {lista.length === 0 ? (
            <p className={css.vazio}>Nenhuma regra ainda. Quem não tiver regra é apurado pela CLT padrão.</p>
          ) : (
            <table className={css.tab}>
              <thead><tr><th>Convenção</th><th>UF</th><th>Extra útil</th><th>Dom/fer</th><th>Noturno</th><th>Banco</th><th>Func.</th><th></th></tr></thead>
              <tbody>
                {lista.map((c) => (
                  <tr key={c.id} style={{ opacity: c.ativa ? 1 : 0.5 }}>
                    <td>
                      <strong>{c.nome}</strong>
                      {c.padrao && <span className={css.badge}>padrão</span>}
                      {!c.ativa && <span className={css.badgeArq}>arquivada</span>}
                      {c.vigencia && <div className={css.esc}>{c.vigencia}</div>}
                    </td>
                    <td className={css.mono}>{c.uf ?? '—'}</td>
                    <td className={css.mono}>{c.extraDiaUtilPct}%</td>
                    <td className={css.mono}>{c.extraDomingoFeriadoPct}%</td>
                    <td className={css.mono}>{c.noturnoAdicionalPct}%</td>
                    <td className={css.mono}>
                      {c.bancoModo === 'ATIVO' ? `${c.bancoPrazoMeses ?? (c.bancoTipoAcordo === 'COLETIVO' ? 12 : 6)}m`
                        : c.bancoModo === 'INATIVO' ? 'não' : 'empresa'}
                    </td>
                    <td><span className={css.pill}>{c.funcionarios ?? 0}</span></td>
                    <td className={css.acoesCell}>
                      <button className={css.link} onClick={() => editar(c)}>editar</button>
                      <button className={css.linkNo} onClick={() => remover(c)}>remover</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {e && (
        <div className={css.card}>
          <h2 className={css.h2}>{e.id ? 'Editar regra' : 'Nova regra'}</h2>
          <p className={css.sub}>Defina o cálculo. Dica: dá pra gerar uma regra automaticamente a partir do PDF na aba <strong>Convenções</strong>.</p>

          <div className={css.row}>
            <div><span className={css.lb}>Nome</span><input className={css.inp} value={e.nome} onChange={(x) => set({ nome: x.target.value })} placeholder="Ex.: Motoristas Carga RS 2025" /></div>
            <div><span className={css.lb}>UF / vigência (informativo)</span>
              <div className={css.dupla}>
                <input className={css.inp} style={{ maxWidth: 70 }} maxLength={2} value={e.uf ?? ''} onChange={(x) => set({ uf: x.target.value.toUpperCase() || null })} placeholder="UF" />
                <input className={css.inp} value={e.vigencia ?? ''} onChange={(x) => set({ vigencia: x.target.value || null })} placeholder="05/2025 a 04/2026" />
              </div>
            </div>
          </div>

          <span className={css.grupoLb}>Horas extras</span>
          <div className={css.row3}>
            <div><span className={css.lb}>Dia útil (%)</span><input className={css.inp} inputMode="numeric" value={e.extraDiaUtilPct} onChange={(x) => set({ extraDiaUtilPct: numero(x.target.value) })} /></div>
            <div><span className={css.lb}>Domingo/feriado (%)</span><input className={css.inp} inputMode="numeric" value={e.extraDomingoFeriadoPct} onChange={(x) => set({ extraDomingoFeriadoPct: numero(x.target.value) })} /></div>
            <div><span className={css.lb}>Limite diário (min)</span><input className={css.inp} inputMode="numeric" value={e.extraLimiteDiarioMin} onChange={(x) => set({ extraLimiteDiarioMin: numero(x.target.value) })} /></div>
          </div>

          <span className={css.grupoLb}>Tolerância</span>
          <div className={css.row}>
            <div><span className={css.lb}>Diária total (min)</span><input className={css.inp} inputMode="numeric" value={e.toleranciaDiariaMin} onChange={(x) => set({ toleranciaDiariaMin: numero(x.target.value) })} /></div>
            <div><span className={css.lb}>Por marcação (min)</span><input className={css.inp} inputMode="numeric" value={e.toleranciaPorMarcacaoMin} onChange={(x) => set({ toleranciaPorMarcacaoMin: numero(x.target.value) })} /></div>
          </div>

          <span className={css.grupoLb}>Adicional noturno</span>
          <div className={css.row3}>
            <div><span className={css.lb}>Percentual (%)</span><input className={css.inp} inputMode="numeric" value={e.noturnoAdicionalPct} onChange={(x) => set({ noturnoAdicionalPct: numero(x.target.value) })} /></div>
            <div><span className={css.lb}>Início–fim</span>
              <div className={css.dupla}>
                <input className={css.inp} value={hhmm(e.noturnoInicioMin)} onChange={(x) => set({ noturnoInicioMin: paraMin(x.target.value) })} />
                <input className={css.inp} value={hhmm(e.noturnoFimMin)} onChange={(x) => set({ noturnoFimMin: paraMin(x.target.value) })} />
              </div>
            </div>
            <label className={css.chk}><input type="checkbox" checked={e.noturnoReduzida} onChange={(x) => set({ noturnoReduzida: x.target.checked })} /> Hora reduzida (52min30)</label>
          </div>

          <span className={css.grupoLb}>Jornada</span>
          <div className={css.row}>
            <div><span className={css.lb}>Semanal (h)</span><input className={css.inp} inputMode="decimal" value={Math.round(e.jornadaSemanalMin / 60 * 10) / 10} onChange={(x) => set({ jornadaSemanalMin: Math.round(numero(x.target.value) * 60) })} /></div>
            <div><span className={css.lb}>Interjornada (h)</span><input className={css.inp} inputMode="decimal" value={Math.round(e.interjornadaMinimaMin / 60 * 10) / 10} onChange={(x) => set({ interjornadaMinimaMin: Math.round(numero(x.target.value) * 60) })} /></div>
          </div>

          <span className={css.grupoLb}>Banco de horas desta regra</span>
          <div className={css.row3}>
            <div><span className={css.lb}>Banco</span>
              <select className={css.inp} value={e.bancoModo} onChange={(x) => set({ bancoModo: x.target.value as typeof e.bancoModo })}>
                <option value="HERDA">Herda da empresa</option>
                <option value="ATIVO">Ativado nesta regra</option>
                <option value="INATIVO">Desativado nesta regra</option>
              </select>
            </div>
            {e.bancoModo === 'ATIVO' && (
              <>
                <div><span className={css.lb}>Tipo de acordo</span>
                  <select className={css.inp} value={e.bancoTipoAcordo ?? 'INDIVIDUAL'} onChange={(x) => set({ bancoTipoAcordo: x.target.value as 'INDIVIDUAL' | 'COLETIVO' })}>
                    <option value="INDIVIDUAL">Individual</option>
                    <option value="COLETIVO">Coletivo</option>
                  </select>
                </div>
                <div><span className={css.lb}>Prazo (meses)</span><input className={css.inp} inputMode="numeric" value={e.bancoPrazoMeses ?? ''} placeholder={e.bancoTipoAcordo === 'COLETIVO' ? '12' : '6'} onChange={(x) => set({ bancoPrazoMeses: x.target.value.trim() === '' ? null : numero(x.target.value) })} /></div>
              </>
            )}
          </div>

          {e.bancoModo !== 'INATIVO' && (
            <div className={css.row}>
              <div><span className={css.lb}>Compensação</span>
                <select className={css.inp} value={e.formaCalculo} onChange={(x) => set({ formaCalculo: x.target.value as typeof e.formaCalculo })}>
                  <option value="BANCO_HORAS">Acumula no banco (entre meses)</option>
                  <option value="INTRA_MES">Compensa dentro do mês (não acumula)</option>
                </select>
              </div>
            </div>
          )}

          <span className={css.grupoLb}>Esta regra</span>
          <label className={css.chkLinha}><input type="checkbox" checked={e.padrao} onChange={(x) => set({ padrao: x.target.checked })} /> <span>É a <strong>regra padrão</strong> da empresa (vale pra quem não tem regra escolhida)</span></label>
          <label className={css.chkLinha}><input type="checkbox" checked={e.ativa} onChange={(x) => set({ ativa: x.target.checked })} /> <span>Ativa (desmarque para arquivar)</span></label>

          <div className={css.nota}>Se o banco <strong>herda</strong>, vale a config da empresa (aba Banco de horas). <strong>Ativado/Desativado</strong> mandam por esta regra — assim motorista pode ter banco e administrativo não, na mesma empresa. O intervalo (&gt;6h) segue {e.intervaloMaior6hMin}min.</div>

          <span className={css.grupoLb}>Destinação de faltas e atrasos</span>
          <div className={css.row}>
            <div>
              <span className={css.lb}>Falta injustificada (dia inteiro)</span>
              <select className={css.inp} value={e.destinacaoFaltas} onChange={(x) => set({ destinacaoFaltas: x.target.value as typeof e.destinacaoFaltas })}>
                <option value="DESCONTA">Descontar na folha</option>
                {e.bancoModo !== 'INATIVO' && <option value="BANCO">Abater do banco de horas</option>}
                <option value="ABONA">Abonar (não descontar)</option>
              </select>
            </div>
            <div>
              <span className={css.lb}>Atraso e saída antecipada</span>
              <select className={css.inp} value={e.destinacaoAtrasos} onChange={(x) => set({ destinacaoAtrasos: x.target.value as typeof e.destinacaoAtrasos })}>
                <option value="DESCONTA">Descontar na folha</option>
                {e.bancoModo !== 'INATIVO' && <option value="BANCO">Abater do banco de horas</option>}
                <option value="TOLERA">Tolerar (não descontar)</option>
              </select>
            </div>
          </div>
          <div className={css.nota}>O sistema <strong>calcula e sinaliza</strong> — o desconto real (e o reflexo do DSR) é aplicado pela sua folha. Se o banco estiver desligado, "abater do banco" vira desconto sinalizado.</div>

          <div className={css.acoes}>
            <button className={css.salvar} onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar regra'}</button>
            <button className={css.cancelar} onClick={() => { setEditando(null); setErro(null); }}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
