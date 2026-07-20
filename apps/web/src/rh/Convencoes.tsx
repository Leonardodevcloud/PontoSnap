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
};

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const paraMin = (s: string) => { const [h, m] = s.split(':'); return (Number(h) || 0) * 60 + (Number(m) || 0); };

export default function Convencoes() {
  const [lista, setLista] = useState<Cct[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<(typeof VAZIA & { id?: string }) | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [lendoPdf, setLendoPdf] = useState(false);
  const [citacoes, setCitacoes] = useState<{ campo: string; texto: string }[]>([]);
  const [preenchidoIA, setPreenchidoIA] = useState(false);

  async function lerPdf(file: File) {
    if (file.type !== 'application/pdf') { setErro('Envie um PDF'); return; }
    setErro(null); setLendoPdf(true); setCitacoes([]);
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1] ?? '');
        r.onerror = () => rej(new Error('Falha ao ler o arquivo'));
        r.readAsDataURL(file);
      });
      const out = await api.post<{ valores: Partial<typeof VAZIA>; citacoes: { campo: string; texto: string }[] }>('/cct/extrair', { arquivoBase64: base64 });
      setEditando((cur) => cur ? { ...cur, ...out.valores } : cur);
      setCitacoes(out.citacoes);
      setPreenchidoIA(true);
    } catch (e) { setErro((e as Error).message); }
    finally { setLendoPdf(false); }
  }

  const carregar = useCallback(async () => {
    setErro(null);
    try { setLista(await api.get<Cct[]>('/cct')); }
    catch (e) { setErro((e as Error).message); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  function novo() { setCitacoes([]); setPreenchidoIA(false); setEditando({ ...VAZIA }); }
  function editar(c: Cct) { setCitacoes([]); setPreenchidoIA(false); const { funcionarios, id, ...resto } = c; void funcionarios; setEditando({ ...resto, id }); }

  async function salvar() {
    if (!editando) return;
    if (!editando.nome.trim()) { setErro('Dê um nome à convenção'); return; }
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
    if (!confirm(`Remover a convenção "${c.nome}"?`)) return;
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
          <h1 className={css.h}>Convenções (CCT/ACT)</h1>
          <p className={css.sub}>Cadastre as convenções da empresa; cada funcionário aponta pra sua no cadastro dele.</p>
        </div>
        {!e && <button className={css.novo} onClick={novo}>+ Nova convenção</button>}
      </div>

      {erro && <p className={css.erro}>{erro}</p>}

      {!e && (
        <div className={css.card}>
          {lista.length === 0 ? (
            <p className={css.vazio}>Nenhuma convenção ainda. Quem não tiver convenção é apurado pela CLT.</p>
          ) : (
            <table className={css.tab}>
              <thead><tr><th>Convenção</th><th>UF</th><th>Extra útil</th><th>Dom/fer</th><th>Noturno</th><th>Banco</th><th>Func.</th><th></th></tr></thead>
              <tbody>
                {lista.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.nome}</strong>{c.vigencia && <div className={css.esc}>{c.vigencia}</div>}</td>
                    <td className={css.mono}>{c.uf ?? '—'}</td>
                    <td className={css.mono}>{c.extraDiaUtilPct}%</td>
                    <td className={css.mono}>{c.extraDomingoFeriadoPct}%</td>
                    <td className={css.mono}>{c.noturnoAdicionalPct}%</td>
                    <td className={css.mono}>{c.bancoPrazoMeses ? `${c.bancoPrazoMeses}m` : '—'}</td>
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
          <h2 className={css.h2}>{e.id ? 'Editar convenção' : 'Nova convenção'}</h2>
          <p className={css.sub}>Envie o PDF da CCT e a IA preenche pra você — depois confira e salve. Ou preencha à mão.</p>

          <div className={css.upload}>
            <label className={css.uploadBtn}>
              {lendoPdf ? 'Lendo o PDF…' : '📄 Enviar PDF da CCT'}
              <input type="file" accept="application/pdf" hidden disabled={lendoPdf}
                onChange={(x) => { const f = x.target.files?.[0]; if (f) void lerPdf(f); x.target.value = ''; }} />
            </label>
            <span className={css.uploadDica}>A IA lê e preenche os campos. Você confere antes de salvar.</span>
          </div>

          {preenchidoIA && (
            <div className={css.iaBox}>
              <strong>A IA preencheu os campos abaixo.</strong> Confira cada número antes de salvar.
              {citacoes.length > 0 && (
                <ul className={css.cit}>
                  {citacoes.map((c, i) => <li key={i}><b>{c.campo}:</b> {c.texto}</li>)}
                </ul>
              )}
            </div>
          )}

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

          <span className={css.grupoLb}>Jornada e banco</span>
          <div className={css.row3}>
            <div><span className={css.lb}>Semanal (h)</span><input className={css.inp} inputMode="decimal" value={Math.round(e.jornadaSemanalMin / 60 * 10) / 10} onChange={(x) => set({ jornadaSemanalMin: Math.round(numero(x.target.value) * 60) })} /></div>
            <div><span className={css.lb}>Interjornada (h)</span><input className={css.inp} inputMode="decimal" value={Math.round(e.interjornadaMinimaMin / 60 * 10) / 10} onChange={(x) => set({ interjornadaMinimaMin: Math.round(numero(x.target.value) * 60) })} /></div>
            <div><span className={css.lb}>Banco (meses) — vazio = empresa</span><input className={css.inp} inputMode="numeric" value={e.bancoPrazoMeses ?? ''} onChange={(x) => set({ bancoPrazoMeses: x.target.value.trim() === '' ? null : numero(x.target.value) })} placeholder="6 ou 12" /></div>
          </div>

          <div className={css.nota}>O intervalo (&gt;6h) segue {e.intervaloMaior6hMin}min. O banco de horas continua ativado na aba Banco de horas — aqui você só define o prazo por convenção.</div>

          <div className={css.acoes}>
            <button className={css.salvar} onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar convenção'}</button>
            <button className={css.cancelar} onClick={() => { setEditando(null); setErro(null); }}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
