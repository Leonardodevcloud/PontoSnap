import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { minutosParaHhMm } from '../lib/formato';
import type { Horario, ParEntradaSaida } from '../tipos';
import { Botao } from '../components/Botao';
import { Campo } from '../components/Campo';
import css from './Escalas.module.css';

const DIAS = [
  { n: 1, l: 'Seg' }, { n: 2, l: 'Ter' }, { n: 3, l: 'Qua' }, { n: 4, l: 'Qui' },
  { n: 5, l: 'Sex' }, { n: 6, l: 'Sáb' }, { n: 0, l: 'Dom' },
];
const hhmmParaMin = (v: string) => { const [h, m] = v.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0); };

export function Escalas() {
  const [lista, setLista] = useState<Horario[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [codigo, setCodigo] = useState('');
  const [dias, setDias] = useState<number[]>([1, 2, 3, 4, 5]);
  const [pares, setPares] = useState<ParEntradaSaida[]>([{ entrada: '08:00', saida: '12:00' }, { entrada: '13:00', saida: '17:00' }]);
  const [regime, setRegime] = useState('normal');
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    try { setLista(await api.get<Horario[]>('/tratamento/horarios')); }
    catch (e) { setErro((e as Error).message); }
  }
  useEffect(() => { void carregar(); }, []);

  const durTotal = pares.reduce((acc, p) => acc + Math.max(0, hhmmParaMin(p.saida) - hhmmParaMin(p.entrada)), 0);

  function toggleDia(n: number) {
    setDias((d) => (d.includes(n) ? d.filter((x) => x !== n) : [...d, n]).sort());
  }
  function setPar(i: number, campo: 'entrada' | 'saida', valor: string) {
    setPares((ps) => ps.map((p, idx) => (idx === i ? { ...p, [campo]: valor } : p)));
  }

  async function salvar() {
    setErro(null); setSalvando(true);
    try {
      const paresAfd = pares.map((p) => ({ entrada: p.entrada.replace(':', ''), saida: p.saida.replace(':', '') }));
      await api.post('/tratamento/horarios', { codigo: codigo.trim(), durJornadaMin: durTotal, pares: paresAfd, diasSemana: dias, regime });
      setCodigo(''); setDias([1, 2, 3, 4, 5]); setPares([{ entrada: '08:00', saida: '12:00' }, { entrada: '13:00', saida: '17:00' }]); setRegime('normal');
      void carregar();
    } catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }

  return (
    <div>
      <div className={css.head}><h2>Escalas</h2><p>Jornada e dias úteis que a apuração usa por funcionário</p></div>

      <div className={css.form}>
        <div className={css.linha1}>
          <Campo rotulo="Código" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ex.: CH-COMERCIAL" />
          <div className={css.dur}><span className={css.lb}>Jornada/dia</span><strong>{minutosParaHhMm(durTotal)}</strong></div>
        </div>

        <div className={css.bloco}>
          <span className={css.lb}>Dias úteis</span>
          <div className={css.chips}>
            {DIAS.map((d) => (
              <button key={d.n} type="button"
                className={`${css.chip} ${dias.includes(d.n) ? css.chipOn : ''}`}
                onClick={() => toggleDia(d.n)}>{d.l}</button>
            ))}
          </div>
        </div>

        <div className={css.bloco}>
          <span className={css.lb}>Regime</span>
          <select className={css.regime} value={regime} onChange={(e) => setRegime(e.target.value)}>
            <option value="normal">Normal</option>
            <option value="r12x36">12x36</option>
          </select>
        </div>

        <div className={css.bloco}>
          <span className={css.lb}>Pares entrada/saída</span>
          {pares.map((p, i) => (
            <div key={i} className={css.par}>
              <input type="time" value={p.entrada} onChange={(e) => setPar(i, 'entrada', e.target.value)} />
              <span>→</span>
              <input type="time" value={p.saida} onChange={(e) => setPar(i, 'saida', e.target.value)} />
              {pares.length > 1 && <button className={css.rm} onClick={() => setPares((ps) => ps.filter((_, idx) => idx !== i))}>×</button>}
            </div>
          ))}
          <button className={css.addPar} onClick={() => setPares((ps) => [...ps, { entrada: '', saida: '' }])}>+ par</button>
        </div>

        {erro && <p className={css.erro}>{erro}</p>}
        <Botao variante="coral" className={css.salvar} onClick={salvar} disabled={salvando || !codigo || dias.length === 0 || durTotal === 0}>
          {salvando ? 'Salvando…' : 'Criar escala'}
        </Botao>
      </div>

      <div className={css.table}>
        <div className={`${css.row} ${css.thead}`}><span>Código</span><span>Jornada</span><span>Dias</span><span>Regime</span></div>
        {lista?.length === 0 && <div className={css.vazio}>Nenhuma escala ainda.</div>}
        {lista?.map((h) => (
          <div key={h.id} className={css.row}>
            <span className={css.cod}>{h.codigo}</span>
            <span className={css.mono}>{minutosParaHhMm(h.durJornadaMin)}</span>
            <span className={css.diasTxt}>{DIAS.filter((d) => h.diasSemana.includes(d.n)).map((d) => d.l).join(' · ')}</span>
            <span className={css.regimeTxt}>{h.regime === 'r12x36' ? '12x36' : 'normal'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
