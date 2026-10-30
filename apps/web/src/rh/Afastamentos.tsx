import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { hojeSP } from '../lib/formato';
import { Botao } from '../components/Botao';
import { Campo } from '../components/Campo';
import { Explica } from '../components/Explica';
import type { Afastamento, Empregado, TipoAfastamento } from '../tipos';
import css from './Afastamentos.module.css';

const fmtData = (d: string) => new Date(`${d}T12:00:00-0300`).toLocaleDateString('pt-BR');

const TIPOS: { v: TipoAfastamento; t: string }[] = [
  { v: 'FERIAS', t: 'Férias' },
  { v: 'INSS', t: 'Afastamento (INSS)' },
  { v: 'MATERNIDADE', t: 'Licença-maternidade' },
  { v: 'PATERNIDADE', t: 'Licença-paternidade' },
  { v: 'SUSPENSAO', t: 'Suspensão' },
  { v: 'OUTRO', t: 'Outro' },
];
const ROTULO = Object.fromEntries(TIPOS.map((t) => [t.v, t.t])) as Record<TipoAfastamento, string>;

/** Quantos dias corridos o período cobre. */
const dias = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000) + 1;

export function Afastamentos() {
  const [lista, setLista] = useState<Afastamento[]>([]);
  const [emps, setEmps] = useState<Empregado[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [emp, setEmp] = useState('');
  const [tipo, setTipo] = useState<TipoAfastamento>('FERIAS');
  const [inicio, setInicio] = useState(hojeSP());
  const [fim, setFim] = useState(hojeSP());
  const [obs, setObs] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try { setLista(await api.get<Afastamento[]>('/afastamentos')); }
    catch (e) { setErro((e as Error).message); }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => {
    (async () => {
      try { setEmps(await api.get<Empregado[]>('/empregados')); }
      catch { /* secundário */ }
    })();
  }, []);

  async function salvar() {
    setErro(null); setMsg(null); setSalvando(true);
    try {
      await api.post('/afastamentos', {
        empregadoId: emp, tipo, dataInicio: inicio, dataFim: fim,
        observacao: obs.trim() || undefined,
      });
      setObs('');
      setMsg('Lançado. Esses dias deixam de contar como falta.');
      await carregar();
      setTimeout(() => setMsg(null), 4000);
    } catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }

  async function remover(id: string) {
    setErro(null);
    try { await api.del(`/afastamentos/${id}`); await carregar(); }
    catch (e) { setErro((e as Error).message); }
  }

  return (
    <div className={css.tela}>
      <div className={css.tituloLinha}>
        <h2 className={css.h}>Férias e afastamentos</h2>
        <Explica>
          Sem isso, quem sai de férias aparece com <strong>um mês inteiro de falta</strong> na apuração.
          Lançar aqui faz o dia deixar de ser esperado — não vira falta nem saldo negativo.
        </Explica>
      </div>

      {erro && <p className={css.erro}>{erro}</p>}
      {msg && <p className={css.ok}>{msg}</p>}

      <div className={css.bloco}>
        <div className={css.blocoH}>Lançar</div>

        <select className={css.select} aria-label="Funcionário" value={emp} onChange={(e) => setEmp(e.target.value)}>
          <option value="">Escolha o funcionário…</option>
          {emps.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>

        <div className={css.chips} role="group" aria-label="Tipo de afastamento">
          {TIPOS.map((t) => (
            <button
              key={t.v} type="button" aria-pressed={tipo === t.v} className={`${css.chip} ${tipo === t.v ? css.chipOn : ''}`}
              onClick={() => setTipo(t.v)}
            >{t.t}</button>
          ))}
        </div>

        <div className={css.datas}>
          <Campo rotulo="De" type="date" value={inicio}
            onChange={(e) => { setInicio(e.target.value); if (e.target.value > fim) setFim(e.target.value); }} />
          <Campo rotulo="Até" type="date" value={fim} min={inicio}
            onChange={(e) => setFim(e.target.value)} />
        </div>
        {inicio <= fim && (
          <p className={css.dica}>{dias(inicio, fim)} dia(s) corridos.</p>
        )}

        <Campo rotulo="Observação (opcional)" value={obs} onChange={(e) => setObs(e.target.value)}
          placeholder="Férias 2026 · 1º período" />

        <Botao variante="coral" onClick={salvar} disabled={salvando || !emp || fim < inicio}>
          {salvando ? 'Lançando…' : 'Lançar'}
        </Botao>
      </div>

      <div className={css.blocoH} style={{ marginTop: 22 }}>Lançados</div>
      {lista.length === 0 && <p className={css.vazio}>Nenhum afastamento lançado.</p>}
      {lista.map((a) => (
        <div key={a.id} className={css.item}>
          <div className={css.itemTxt}>
            <div className={css.itemN} title={a.nome}>{a.nome}</div>
            <div className={css.itemD} title={a.observacao ?? undefined}>
              {ROTULO[a.tipo] ?? a.tipo} · {fmtData(a.dataInicio)} a {fmtData(a.dataFim)} · {dias(a.dataInicio, a.dataFim)} dias
              {a.observacao && <span className={css.obs}> · {a.observacao}</span>}
            </div>
          </div>
          <button type="button" className={css.remover} aria-label={`Apagar afastamento de ${a.nome}`} onClick={() => remover(a.id)}>Apagar</button>
        </div>
      ))}
    </div>
  );
}
