import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Feriado } from '../tipos';
import { Botao } from '../components/Botao';
import { Campo } from '../components/Campo';
import css from './Feriados.module.css';

const anoAtual = () => new Date().getFullYear();
const fmtDia = (iso: string) => { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; };
const diaSemana = (iso: string) =>
  ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][new Date(`${iso}T12:00:00-0300`).getUTCDay()];

export function Feriados() {
  const [ano, setAno] = useState(anoAtual());
  const [lista, setLista] = useState<Feriado[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [data, setData] = useState('');
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState('nacional');
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    try { setLista(await api.get<Feriado[]>(`/tratamento/feriados?inicio=${ano}-01-01&fim=${ano}-12-31`)); }
    catch (e) { setErro((e as Error).message); }
  }
  useEffect(() => { void carregar(); }, [ano]);

  async function adicionar() {
    setErro(null); setSalvando(true);
    try {
      await api.post('/tratamento/feriados', { data, nome: nome.trim(), tipo });
      setData(''); setNome(''); setTipo('nacional');
      void carregar();
    } catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }

  async function remover(id: string) {
    await api.del(`/tratamento/feriados/${id}`).catch(() => {});
    void carregar();
  }

  return (
    <div>
      <div className={css.head}><h2>Feriados</h2><p>Calendário que a apuração usa para não contar falta</p></div>

      <div className={css.form}>
        <Campo rotulo="Data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        <Campo rotulo="Nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Independência" />
        <label className={css.sel}>
          <span className={css.lb}>Tipo</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="nacional">Nacional</option>
            <option value="estadual">Estadual</option>
            <option value="municipal">Municipal</option>
          </select>
        </label>
        <Botao variante="coral" className={css.add} onClick={adicionar} disabled={salvando || !data || !nome}>
          {salvando ? 'Salvando…' : '+ Adicionar'}
        </Botao>
      </div>

      {erro && <p className={css.erro}>{erro}</p>}

      <div className={css.anoBar}>
        <button onClick={() => setAno((a) => a - 1)}>‹</button>
        <span>{ano}</span>
        <button onClick={() => setAno((a) => a + 1)}>›</button>
      </div>

      <div className={css.table}>
        {lista?.length === 0 && <div className={css.vazio}>Nenhum feriado cadastrado em {ano}.</div>}
        {lista?.map((f) => (
          <div key={f.id} className={css.row}>
            <span className={css.mono}>{fmtDia(f.data)}</span>
            <span className={css.dsem}>{diaSemana(f.data)}</span>
            <span className={css.nome}>{f.nome}</span>
            <span className={`${css.tipo} ${css['t_' + f.tipo] ?? ''}`}>{f.tipo}</span>
            <button className={css.del} onClick={() => remover(f.id)} aria-label="Remover">remover</button>
          </div>
        ))}
      </div>
    </div>
  );
}
