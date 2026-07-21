import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import css from './Convencoes.module.css';

type Tipo = 'EXTRA' | 'TOLERANCIA' | 'NOTURNO' | 'JORNADA' | 'BANCO' | 'DESTINACAO';
interface Item { id: string; tipo: Tipo; nome: string; config: Record<string, unknown>; padrao: boolean; }

const TIPOS: Tipo[] = ['EXTRA', 'TOLERANCIA', 'NOTURNO', 'JORNADA', 'BANCO', 'DESTINACAO'];
const ROTULO: Record<Tipo, string> = {
  EXTRA: 'Hora extra', TOLERANCIA: 'Tolerância', NOTURNO: 'Adicional noturno',
  JORNADA: 'Jornada', BANCO: 'Banco de horas', DESTINACAO: 'Destinação',
};
const DEFAULTS: Record<Tipo, Record<string, unknown>> = {
  EXTRA: { extraDiaUtilPct: 50, extraDomingoFeriadoPct: 100, extraLimiteDiarioMin: 120 },
  TOLERANCIA: { toleranciaDiariaMin: 10, toleranciaPorMarcacaoMin: 5 },
  NOTURNO: { noturnoAdicionalPct: 20, noturnoReduzida: true, noturnoInicioMin: 1320, noturnoFimMin: 300 },
  JORNADA: { jornadaSemanalMin: 2640, interjornadaMinimaMin: 660, intervaloMaior6hMin: 60 },
  BANCO: { bancoModo: 'ATIVO', bancoTipoAcordo: 'INDIVIDUAL', bancoPrazoMeses: 6, formaCalculo: 'BANCO_HORAS' },
  DESTINACAO: { destinacaoFaltas: 'DESCONTA', destinacaoAtrasos: 'BANCO' },
};
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const paraMin = (s: string) => { const [h, m] = s.split(':'); return (Number(h) || 0) * 60 + (Number(m) || 0); };
const num = (v: string) => (v.trim() === '' ? 0 : Number(v.replace(',', '.')) || 0);

function resumo(tipo: Tipo, c: Record<string, unknown>): string {
  const n = (k: string) => Number(c[k]);
  switch (tipo) {
    case 'EXTRA': return `${n('extraDiaUtilPct')}% útil · ${n('extraDomingoFeriadoPct')}% dom/fer`;
    case 'TOLERANCIA': return `${n('toleranciaDiariaMin')}min/dia · ${n('toleranciaPorMarcacaoMin')}min/marcação`;
    case 'NOTURNO': return `${n('noturnoAdicionalPct')}% · ${hhmm(n('noturnoInicioMin'))}–${hhmm(n('noturnoFimMin'))}`;
    case 'JORNADA': return `${Math.round(n('jornadaSemanalMin') / 60)}h semana · interjornada ${Math.round(n('interjornadaMinimaMin') / 60)}h`;
    case 'BANCO': return c.bancoModo === 'ATIVO' ? `ativo · ${n('bancoPrazoMeses')}m · ${c.formaCalculo === 'INTRA_MES' ? 'mês' : 'acumula'}` : c.bancoModo === 'INATIVO' ? 'sem banco' : 'herda empresa';
    case 'DESTINACAO': return `falta: ${String(c.destinacaoFaltas).toLowerCase()} · atraso: ${String(c.destinacaoAtrasos).toLowerCase()}`;
  }
}

export default function RegrasItens() {
  const [tipo, setTipo] = useState<Tipo>('EXTRA');
  const [lista, setLista] = useState<Item[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<{ id?: string; nome: string; padrao: boolean; config: Record<string, unknown> } | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try { setLista(await api.get<Item[]>(`/regra-itens?tipo=${tipo}`)); }
    catch (e) { setErro((e as Error).message); }
  }, [tipo]);
  useEffect(() => { void carregar(); setEditando(null); }, [carregar]);

  const cfg = editando?.config ?? {};
  const setCfg = (patch: Record<string, unknown>) => setEditando((e) => e ? { ...e, config: { ...e.config, ...patch } } : e);

  function novo() { setEditando({ nome: '', padrao: false, config: { ...DEFAULTS[tipo] } }); }
  function editar(i: Item) { setEditando({ id: i.id, nome: i.nome, padrao: i.padrao, config: { ...DEFAULTS[tipo], ...i.config } }); }

  async function salvar() {
    if (!editando) return;
    if (!editando.nome.trim()) { setErro('Dê um nome à opção'); return; }
    setErro(null); setSalvando(true);
    try {
      if (editando.id) await api.patch(`/regra-itens/${editando.id}`, { nome: editando.nome, config: editando.config, padrao: editando.padrao });
      else await api.post('/regra-itens', { tipo, nome: editando.nome, config: editando.config, padrao: editando.padrao });
      setEditando(null); await carregar();
    } catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }
  async function remover(i: Item) {
    if (!confirm(`Remover "${i.nome}"?`)) return;
    setErro(null);
    try { await api.del(`/regra-itens/${i.id}`); await carregar(); }
    catch (e) { setErro((e as Error).message); }
  }

  return (
    <div className={css.tela}>
      <div className={css.top}>
        <div>
          <h1 className={css.h}>Regras por item</h1>
          <p className={css.sub}>Cada item tem suas opções. No funcionário você monta escolhendo uma de cada.</p>
        </div>
      </div>

      <div className={css.itensNav}>
        {TIPOS.map((tp) => (
          <button key={tp} className={`${css.itemPill} ${tp === tipo ? css.itemPillOn : ''}`} onClick={() => setTipo(tp)}>{ROTULO[tp]}</button>
        ))}
      </div>

      {erro && <p className={css.erro}>{erro}</p>}

      {!editando && (
        <div className={css.card}>
          <div className={css.top}><h2 className={css.h2}>Opções de {ROTULO[tipo]}</h2><button className={css.novo} onClick={novo}>+ Nova opção</button></div>
          {lista.length === 0 ? <p className={css.vazio}>Nenhuma opção de {ROTULO[tipo].toLowerCase()}. Quem não escolher usa o padrão CLT.</p> : (
            <table className={css.tab}>
              <thead><tr><th>Nome</th><th>Resumo</th><th></th></tr></thead>
              <tbody>
                {lista.map((i) => (
                  <tr key={i.id}>
                    <td><strong>{i.nome}</strong>{i.padrao && <span className={css.badge}>padrão</span>}</td>
                    <td className={css.mono}>{resumo(tipo, i.config)}</td>
                    <td className={css.acoesCell}>
                      <button className={css.link} onClick={() => editar(i)}>editar</button>
                      <button className={css.linkNo} onClick={() => remover(i)}>remover</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {editando && (
        <div className={css.card}>
          <h2 className={css.h2}>{editando.id ? 'Editar' : 'Nova'} opção de {ROTULO[tipo]}</h2>
          <div className={css.row}>
            <div><span className={css.lb}>Nome da opção</span><input className={css.inp} value={editando.nome} onChange={(x) => setEditando((e) => e ? { ...e, nome: x.target.value } : e)} placeholder={`Ex.: Rodoviários`} /></div>
          </div>

          {tipo === 'EXTRA' && (
            <div className={css.row3}>
              <div><span className={css.lb}>Dia útil (%)</span><input className={css.inp} value={Number(cfg.extraDiaUtilPct)} onChange={(x) => setCfg({ extraDiaUtilPct: num(x.target.value) })} /></div>
              <div><span className={css.lb}>Domingo/feriado (%)</span><input className={css.inp} value={Number(cfg.extraDomingoFeriadoPct)} onChange={(x) => setCfg({ extraDomingoFeriadoPct: num(x.target.value) })} /></div>
              <div><span className={css.lb}>Limite diário (min)</span><input className={css.inp} value={Number(cfg.extraLimiteDiarioMin)} onChange={(x) => setCfg({ extraLimiteDiarioMin: num(x.target.value) })} /></div>
            </div>
          )}
          {tipo === 'TOLERANCIA' && (
            <div className={css.row}>
              <div><span className={css.lb}>Diária total (min)</span><input className={css.inp} value={Number(cfg.toleranciaDiariaMin)} onChange={(x) => setCfg({ toleranciaDiariaMin: num(x.target.value) })} /></div>
              <div><span className={css.lb}>Por marcação (min)</span><input className={css.inp} value={Number(cfg.toleranciaPorMarcacaoMin)} onChange={(x) => setCfg({ toleranciaPorMarcacaoMin: num(x.target.value) })} /></div>
            </div>
          )}
          {tipo === 'NOTURNO' && (
            <div className={css.row3}>
              <div><span className={css.lb}>Percentual (%)</span><input className={css.inp} value={Number(cfg.noturnoAdicionalPct)} onChange={(x) => setCfg({ noturnoAdicionalPct: num(x.target.value) })} /></div>
              <div><span className={css.lb}>Início–fim</span><div className={css.dupla}><input className={css.inp} value={hhmm(Number(cfg.noturnoInicioMin))} onChange={(x) => setCfg({ noturnoInicioMin: paraMin(x.target.value) })} /><input className={css.inp} value={hhmm(Number(cfg.noturnoFimMin))} onChange={(x) => setCfg({ noturnoFimMin: paraMin(x.target.value) })} /></div></div>
              <label className={css.chk}><input type="checkbox" checked={!!cfg.noturnoReduzida} onChange={(x) => setCfg({ noturnoReduzida: x.target.checked })} /> Hora reduzida (52min30)</label>
            </div>
          )}
          {tipo === 'JORNADA' && (
            <div className={css.row3}>
              <div><span className={css.lb}>Semanal (h)</span><input className={css.inp} value={Math.round(Number(cfg.jornadaSemanalMin) / 60 * 10) / 10} onChange={(x) => setCfg({ jornadaSemanalMin: Math.round(num(x.target.value) * 60) })} /></div>
              <div><span className={css.lb}>Interjornada (h)</span><input className={css.inp} value={Math.round(Number(cfg.interjornadaMinimaMin) / 60 * 10) / 10} onChange={(x) => setCfg({ interjornadaMinimaMin: Math.round(num(x.target.value) * 60) })} /></div>
              <div><span className={css.lb}>Intervalo &gt;6h (min)</span><input className={css.inp} value={Number(cfg.intervaloMaior6hMin)} onChange={(x) => setCfg({ intervaloMaior6hMin: num(x.target.value) })} /></div>
            </div>
          )}
          {tipo === 'BANCO' && (
            <>
              <div className={css.row3}>
                <div><span className={css.lb}>Banco</span>
                  <select className={css.inp} value={String(cfg.bancoModo)} onChange={(x) => setCfg({ bancoModo: x.target.value })}>
                    <option value="ATIVO">Ativado</option><option value="INATIVO">Sem banco</option><option value="HERDA">Herda da empresa</option>
                  </select>
                </div>
                {cfg.bancoModo === 'ATIVO' && <>
                  <div><span className={css.lb}>Tipo</span><select className={css.inp} value={String(cfg.bancoTipoAcordo ?? 'INDIVIDUAL')} onChange={(x) => setCfg({ bancoTipoAcordo: x.target.value })}><option value="INDIVIDUAL">Individual</option><option value="COLETIVO">Coletivo</option></select></div>
                  <div><span className={css.lb}>Prazo (meses)</span><input className={css.inp} value={Number(cfg.bancoPrazoMeses ?? 6)} onChange={(x) => setCfg({ bancoPrazoMeses: num(x.target.value) })} /></div>
                </>}
              </div>
              {cfg.bancoModo === 'ATIVO' && (
                <div className={css.row}><div><span className={css.lb}>Compensação</span><select className={css.inp} value={String(cfg.formaCalculo)} onChange={(x) => setCfg({ formaCalculo: x.target.value })}><option value="BANCO_HORAS">Acumula no banco (entre meses)</option><option value="INTRA_MES">Compensa dentro do mês</option></select></div></div>
              )}
            </>
          )}
          {tipo === 'DESTINACAO' && (
            <div className={css.row}>
              <div><span className={css.lb}>Falta injustificada</span><select className={css.inp} value={String(cfg.destinacaoFaltas)} onChange={(x) => setCfg({ destinacaoFaltas: x.target.value })}><option value="DESCONTA">Descontar na folha</option><option value="BANCO">Abater do banco</option><option value="ABONA">Abonar</option></select></div>
              <div><span className={css.lb}>Atraso / saída antecipada</span><select className={css.inp} value={String(cfg.destinacaoAtrasos)} onChange={(x) => setCfg({ destinacaoAtrasos: x.target.value })}><option value="DESCONTA">Descontar na folha</option><option value="BANCO">Abater do banco</option><option value="TOLERA">Tolerar</option></select></div>
            </div>
          )}

          <label className={css.chkLinha} style={{ marginTop: 14 }}><input type="checkbox" checked={editando.padrao} onChange={(x) => setEditando((e) => e ? { ...e, padrao: x.target.checked } : e)} /> <span>É o <strong>padrão</strong> deste item (vale pra quem não escolher)</span></label>

          <div className={css.acoes}>
            <button className={css.salvar} onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar opção'}</button>
            <button className={css.cancelar} onClick={() => { setEditando(null); setErro(null); }}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
