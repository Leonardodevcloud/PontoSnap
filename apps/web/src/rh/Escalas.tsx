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
const minParaHhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export function Escalas() {
  const [lista, setLista] = useState<Horario[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [codigo, setCodigo] = useState('');
  const [dias, setDias] = useState<number[]>([1, 2, 3, 4, 5]);
  const [pares, setPares] = useState<ParEntradaSaida[]>([{ entrada: '08:00', saida: '12:00' }, { entrada: '13:00', saida: '17:00' }]);
  const [regime, setRegime] = useState('normal');
  const [salvando, setSalvando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  // Jornada por dia: quando ligado, cada dia pode ter uma carga horária própria.
  const [porDiaLigado, setPorDiaLigado] = useState(false);
  const [jornadaDia, setJornadaDia] = useState<Record<number, string>>({}); // dia(0-6) -> "HH:MM"
  // Contrato de horas: a carga é digitada direto; os horários viram referência.
  const [flexivel, setFlexivel] = useState(false);
  const [cargaFlex, setCargaFlex] = useState('08:00');
  const [recalculados, setRecalculados] = useState<number | null>(null);

  function editar(h: Horario) {
    setEditandoId(h.id);
    setCodigo(h.codigo);
    setDias(h.diasSemana);
    setPares(h.pares.map((p) => ({ entrada: `${p.entrada.slice(0, 2)}:${p.entrada.slice(2)}`, saida: `${p.saida.slice(0, 2)}:${p.saida.slice(2)}` })));
    setRegime(h.regime);
    setFlexivel(!!h.flexivel);
    setCargaFlex(minParaHhmm(h.durJornadaMin));
    if (h.jornadaPorDia && Object.keys(h.jornadaPorDia).length > 0) {
      setPorDiaLigado(true);
      const jd: Record<number, string> = {};
      for (const [d, min] of Object.entries(h.jornadaPorDia)) jd[Number(d)] = minParaHhmm(min);
      setJornadaDia(jd);
    } else {
      setPorDiaLigado(false); setJornadaDia({});
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function cancelarEdicao() {
    setEditandoId(null); setCodigo(''); setDias([1, 2, 3, 4, 5]);
    setPares([{ entrada: '08:00', saida: '12:00' }, { entrada: '13:00', saida: '17:00' }]); setRegime('normal');
    setPorDiaLigado(false); setJornadaDia({}); setFlexivel(false); setCargaFlex('08:00');
  }
  async function excluir(h: Horario) {
    if (!confirm(`Excluir a escala "${h.codigo}"? Só é possível se nenhum funcionário estiver usando.`)) return;
    setErro(null);
    try { await api.del(`/tratamento/horarios/${h.id}`); void carregar(); }
    catch (e) { setErro((e as Error).message); }
  }

  async function carregar() {
    try { setLista(await api.get<Horario[]>('/tratamento/horarios')); }
    catch (e) { setErro((e as Error).message); }
  }
  useEffect(() => { void carregar(); }, []);

  const durPares = pares.reduce((acc, p) => acc + Math.max(0, hhmmParaMin(p.saida) - hhmmParaMin(p.entrada)), 0);
  // Flexível: a carga vem do campo próprio; fixo: é a soma dos períodos.
  const durTotal = flexivel ? hhmmParaMin(cargaFlex || '00:00') : durPares;

  function toggleDia(n: number) {
    setDias((d) => (d.includes(n) ? d.filter((x) => x !== n) : [...d, n]).sort());
  }
  function setPar(i: number, campo: 'entrada' | 'saida', valor: string) {
    setPares((ps) => ps.map((p, idx) => (idx === i ? { ...p, [campo]: valor } : p)));
  }

  async function salvar() {
    setErro(null); setSalvando(true); setRecalculados(null);
    try {
      // No flexível os períodos são opcionais: só entram os preenchidos.
      const paresAfd = pares
        .filter((p) => !flexivel || (p.entrada && p.saida))
        .map((p) => ({ entrada: p.entrada.replace(':', ''), saida: p.saida.replace(':', '') }));
      // Monta jornadaPorDia só com os dias marcados, quando o modo está ligado.
      const jornadaPorDia = porDiaLigado
        ? Object.fromEntries(dias.map((d) => [String(d), hhmmParaMin(jornadaDia[d] ?? minParaHhmm(durTotal))]))
        : null;
      const corpo = { codigo: codigo.trim(), durJornadaMin: durTotal, pares: paresAfd, diasSemana: dias, regime, jornadaPorDia, flexivel };
      if (editandoId) {
        const r = await api.patch<{ funcionariosRecalculados?: number }>(`/tratamento/horarios/${editandoId}`, corpo);
        if (r?.funcionariosRecalculados) setRecalculados(r.funcionariosRecalculados);
      } else {
        await api.post('/tratamento/horarios', corpo);
      }
      setEditandoId(null);
      setCodigo(''); setDias([1, 2, 3, 4, 5]); setPares([{ entrada: '08:00', saida: '12:00' }, { entrada: '13:00', saida: '17:00' }]); setRegime('normal'); setPorDiaLigado(false); setJornadaDia({}); setFlexivel(false); setCargaFlex('08:00');
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

        {!flexivel && (
          <p className={css.hint} style={{ margin: '4px 0 16px' }}>
            <strong>Contrato de horas</strong> (entra e sai em qualquer horário, vale só a carga do dia) agora é escolhido no{' '}
            <strong>perfil de regra</strong>, junto com o banco de horas. Aqui fica só quais dias e quantas horas.
          </p>
        )}
        {flexivel && (
        <div className={css.porDiaBox}>
          <label className={css.porDiaToggle}>
            <input type="checkbox" checked={flexivel} onChange={(e) => setFlexivel(e.target.checked)} />
            <span>
              <strong>Contrato de horas (horário flexível): forma antiga</strong>. Esta escala ainda está marcada assim e continua valendo
              para quem tem perfil sem “Tipo de jornada” definido. O certo agora é escolher <strong>contrato de horas no perfil de regra</strong>;
              depois de mover as pessoas, pode desmarcar aqui.
            </span>
          </label>
          {flexivel && (
            <div className={css.porDiaGrade}>
              <div className={css.porDiaLinha}>
                <span className={css.porDiaNome}>Carga/dia</span>
                <input type="time" className={css.porDiaInput} value={cargaFlex} onChange={(e) => setCargaFlex(e.target.value)} />
                <span className={css.porDiaUn}>de trabalho</span>
              </div>
              <p className={css.hint}>Tolerância, intervalo (Art. 71), interjornada e adicional noturno continuam valendo — só a janela de horário deixa de contar.</p>
            </div>
          )}
        </div>
        )}

        <div className={css.bloco}>
          <span className={css.lb}>{flexivel ? 'Horário de referência (opcional)' : 'Horários de trabalho'}</span>
          <p className={css.hint}>
            {flexivel
              ? 'No contrato de horas isto não gera atraso nem extra. Serve só para lembretes de batida e para o espelho. Pode deixar em branco.'
              : 'Cada linha é um período de trabalho. Use duas para separar manhã e tarde com o almoço no meio — ex.: 08:00→12:00 e 13:00→17:00.'}
          </p>
          {pares.map((p, i) => (
            <div key={i} className={css.par}>
              <input type="time" value={p.entrada} onChange={(e) => setPar(i, 'entrada', e.target.value)} />
              <span>→</span>
              <input type="time" value={p.saida} onChange={(e) => setPar(i, 'saida', e.target.value)} />
              {pares.length > 1 && <button className={css.rm} onClick={() => setPares((ps) => ps.filter((_, idx) => idx !== i))}>×</button>}
            </div>
          ))}
          <button className={css.addPar} onClick={() => setPares((ps) => [...ps, { entrada: '', saida: '' }])}>+ período</button>
        </div>

        <div className={css.porDiaBox}>
          <label className={css.porDiaToggle}>
            <input type="checkbox" checked={porDiaLigado} onChange={(e) => setPorDiaLigado(e.target.checked)} />
            <span><strong>Jornada diferente por dia</strong> — marque quando um dia tem carga horária diferente (ex.: sábado menor).</span>
          </label>
          {porDiaLigado && (
            <div className={css.porDiaGrade}>
              {DIAS.filter((d) => dias.includes(d.n)).map((d) => (
                <div key={d.n} className={css.porDiaLinha}>
                  <span className={css.porDiaNome}>{d.l}</span>
                  <input
                    type="time"
                    className={css.porDiaInput}
                    value={jornadaDia[d.n] ?? minParaHhmm(durTotal)}
                    onChange={(e) => setJornadaDia((jd) => ({ ...jd, [d.n]: e.target.value }))}
                  />
                  <span className={css.porDiaUn}>de trabalho</span>
                </div>
              ))}
              <p className={css.hint}>Defina quanto o funcionário deve trabalhar em cada dia. O horário de almoço real vem das batidas dele — aqui você informa só a carga horária.</p>
            </div>
          )}
        </div>

        {erro && <p className={css.erro}>{erro}</p>}
        {recalculados != null && (
          <p className={css.hint} style={{ color: 'var(--ok-text)', fontWeight: 700 }}>
            Escala salva. {recalculados} funcionário{recalculados === 1 ? '' : 's'} {recalculados === 1 ? 'terá' : 'terão'} a apuração e o banco de horas refeitos com a nova regra (acontece sozinho, na próxima consulta).
          </p>
        )}
        <Botao variante="coral" className={css.salvar} onClick={salvar} disabled={salvando || !codigo || dias.length === 0 || durTotal === 0}>
          {salvando ? 'Salvando…' : editandoId ? 'Salvar alterações' : 'Criar escala'}
        </Botao>
        {editandoId && (
          <Botao variante="ghost" className={css.salvar} onClick={cancelarEdicao} disabled={salvando}>
            Cancelar
          </Botao>
        )}
      </div>

      <div className={css.table}>
        <div className={`${css.row} ${css.thead}`}><span>Código</span><span>Jornada</span><span>Dias</span><span>Regime</span><span></span></div>
        {lista?.length === 0 && <div className={css.vazio}>Nenhuma escala ainda.</div>}
        {lista?.map((h) => (
          <div key={h.id} className={css.row}>
            <span className={css.cod}>{h.codigo}</span>
            <span className={css.mono}>{minutosParaHhMm(h.durJornadaMin)}</span>
            <span className={css.diasTxt}>{DIAS.filter((d) => h.diasSemana.includes(d.n)).map((d) => d.l).join(' · ')}</span>
            <span className={css.regimeTxt}>{h.regime === 'r12x36' ? '12x36' : 'normal'}{h.flexivel ? ' · flexível' : ''}</span>
            <span className={css.acoes}>
              <button type="button" className={css.btnEditar} onClick={() => editar(h)}>Editar</button>
              <button type="button" className={css.btnExcluir} onClick={() => excluir(h)}>Excluir</button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
