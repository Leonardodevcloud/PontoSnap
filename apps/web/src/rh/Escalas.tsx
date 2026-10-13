import { useEffect, useState } from 'react';
import { PainelLateral } from '../components/PainelLateral';
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
  // Compensa na semana: a carga vale pela semana, não por dia.
  const [compensa, setCompensa] = useState(false);
  const [formAberto, setFormAberto] = useState(false);

  function editar(h: Horario) {
    setEditandoId(h.id);
    setCodigo(h.codigo);
    setDias(h.diasSemana);
    setPares(h.pares.map((p) => ({ entrada: `${p.entrada.slice(0, 2)}:${p.entrada.slice(2)}`, saida: `${p.saida.slice(0, 2)}:${p.saida.slice(2)}` })));
    setRegime(h.regime);
    setFlexivel(!!h.flexivel);
    setCompensa(!!h.compensaSemana);
    setCargaFlex(minParaHhmm(h.durJornadaMin));
    if (h.jornadaPorDia && Object.keys(h.jornadaPorDia).length > 0) {
      setPorDiaLigado(true);
      const jd: Record<number, string> = {};
      for (const [d, min] of Object.entries(h.jornadaPorDia)) jd[Number(d)] = minParaHhmm(min);
      setJornadaDia(jd);
    } else {
      setPorDiaLigado(false); setJornadaDia({});
    }
    setErro(null); setRecalculados(null); setFormAberto(true);
  }
  function novaEscala() {
    cancelarEdicao(); setErro(null); setRecalculados(null); setFormAberto(true);
  }
  function cancelarEdicao() {
    setFormAberto(false);
    setEditandoId(null); setCodigo(''); setDias([1, 2, 3, 4, 5]);
    setPares([{ entrada: '08:00', saida: '12:00' }, { entrada: '13:00', saida: '17:00' }]); setRegime('normal');
    setPorDiaLigado(false); setJornadaDia({}); setFlexivel(false); setCargaFlex('08:00'); setCompensa(false);
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
  // Carga da semana: soma da carga de cada dia marcado (com jornada por dia, se houver).
  const cargaSemana = dias.reduce((a, d) => a + (porDiaLigado && jornadaDia[d] ? hhmmParaMin(jornadaDia[d]!) : durTotal), 0);

  function toggleDia(n: number) {
    setDias((d) => (d.includes(n) ? d.filter((x) => x !== n) : [...d, n]).sort());
  }
  function setPar(i: number, campo: 'entrada' | 'saida', valor: string) {
    setPares((ps) => ps.map((p, idx) => (idx === i ? { ...p, [campo]: valor } : p)));
  }

  async function salvar() {
    if (!codigo.trim()) { setErro('Dê um nome à escala no campo Código (ex.: 6x1 compensa sábado).'); return; }
    if (dias.length === 0) { setErro('Marque pelo menos um dia de trabalho.'); return; }
    if (durTotal === 0) { setErro(flexivel ? 'Informe a carga de trabalho por dia.' : 'Preencha os horários de trabalho (entrada e saída).'); return; }
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
      const corpo = { codigo: codigo.trim(), durJornadaMin: durTotal, pares: paresAfd, diasSemana: dias, regime, jornadaPorDia, flexivel, compensaSemana: regime === 'normal' && compensa };
      if (editandoId) {
        const r = await api.patch<{ funcionariosRecalculados?: number }>(`/tratamento/horarios/${editandoId}`, corpo);
        if (r?.funcionariosRecalculados) setRecalculados(r.funcionariosRecalculados);
      } else {
        await api.post('/tratamento/horarios', corpo);
      }
      setEditandoId(null); setFormAberto(false);
      setCodigo(''); setDias([1, 2, 3, 4, 5]); setPares([{ entrada: '08:00', saida: '12:00' }, { entrada: '13:00', saida: '17:00' }]); setRegime('normal'); setPorDiaLigado(false); setJornadaDia({}); setFlexivel(false); setCargaFlex('08:00'); setCompensa(false);
      void carregar();
    } catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }

  return (
    <div>
      <div className={css.headLinha}>
        <div className={css.head}><h2>Escalas</h2><p>Dias de trabalho, carga e horários que a apuração usa para cada funcionário</p></div>
        <Botao variante="coral" className={css.btnAuto} onClick={novaEscala}>+ Nova escala</Botao>
      </div>

      {recalculados != null && (
        <p className={css.okMsg} role="status">
          Escala salva. {recalculados} funcionário{recalculados === 1 ? '' : 's'} {recalculados === 1 ? 'terá' : 'terão'} a apuração e o banco de horas refeitos com a nova regra (acontece sozinho, na próxima consulta).
        </p>
      )}
      {erro && !formAberto && <p className={css.erro}>{erro}</p>}

      <div className={css.table}>
        <div className={`${css.row} ${css.thead}`}><span>Escala</span><span>Carga/dia</span><span>Dias</span><span>Como conta</span><span></span></div>
        {lista?.length === 0 && (
          <div className={css.vazio}>
            Nenhuma escala ainda. Crie a primeira para dizer ao sistema os dias e as horas de trabalho.
            <div style={{ marginTop: 12 }}><Botao variante="coral" className={css.btnAuto} onClick={novaEscala}>+ Nova escala</Botao></div>
          </div>
        )}
        {lista?.map((h) => (
          <div key={h.id} className={css.row}>
            <span className={css.cod}>{h.codigo}</span>
            <span className={css.mono}>{minutosParaHhMm(h.durJornadaMin)}</span>
            <span className={css.diasTxt}>{DIAS.filter((d) => h.diasSemana.includes(d.n)).map((d) => d.l).join(' · ')}</span>
            <span className={css.regimeTxt}>{h.regime === 'r12x36' ? '12x36' : h.flexivel ? 'contrato de horas' : 'horário fixo'}{h.compensaSemana ? ' · compensa na semana' : ''}</span>
            <span className={css.acoes}>
              <button type="button" className={css.btnEditar} onClick={() => editar(h)}>Editar</button>
              <button type="button" className={css.btnExcluir} onClick={() => excluir(h)}>Excluir</button>
            </span>
          </div>
        ))}
      </div>

      <PainelLateral aberto={formAberto} onFechar={cancelarEdicao} largura={600}
        titulo={editandoId ? `Editar escala ${codigo}` : 'Nova escala'}
        subtitulo={editandoId ? 'Mudar a escala refaz a apuração de quem usa' : 'Os dias, a carga e como o dia é contado'}
        rodape={<>
          <Botao variante="ghost" className={css.btnAuto} onClick={cancelarEdicao} disabled={salvando}>Cancelar</Botao>
          <Botao variante="coral" className={css.btnAuto} onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : editandoId ? 'Salvar alterações' : 'Criar escala'}</Botao>
        </>}>
        <div className={css.formLateral}>
          {erro && <p className={css.erro} role="alert" style={{ margin: '0 0 14px' }}>{erro}</p>}
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

        {regime === 'normal' && (
          <div className={css.bloco}>
            <span className={css.lb}>Tipo de jornada</span>
            <div className={css.tipoJ} role="radiogroup" aria-label="Tipo de jornada">
              <button type="button" role="radio" aria-checked={!flexivel} className={!flexivel ? css.tipoJOn : ''} onClick={() => setFlexivel(false)}>
                <b>Horário fixo</b><span>Tem hora para entrar e sair. Chegar depois é atraso, sair depois é extra.</span>
              </button>
              <button type="button" role="radio" aria-checked={flexivel} className={flexivel ? css.tipoJOn : ''} onClick={() => { setFlexivel(true); if (!flexivel) setCargaFlex(minParaHhmm(durPares || 480)); }}>
                <b>Contrato de horas</b><span>Entra e sai na hora que quiser. Vale só a carga do dia: extra acima dela, atraso abaixo.</span>
              </button>
            </div>
            {flexivel && (
              <div className={css.porDiaGrade} style={{ marginTop: 10 }}>
                <div className={css.porDiaLinha}>
                  <span className={css.porDiaNome} style={{ width: 'auto', minWidth: 72 }}>Carga/dia</span>
                  <input type="time" aria-label="Carga de trabalho por dia" className={css.porDiaInput} value={cargaFlex} onChange={(e) => setCargaFlex(e.target.value)} />
                  <span className={css.porDiaUn}>de trabalho</span>
                </div>
                <p className={css.hint}>Tolerância, intervalo (Art. 71), interjornada e adicional noturno continuam valendo; só a janela de horário deixa de contar. O que fazer com o saldo (acumular no banco ou pagar) segue o banco de horas da empresa ou do perfil do funcionário.</p>
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
              <input type="time" value={p.entrada} aria-label={`Entrada do período ${i + 1}`} onChange={(e) => setPar(i, 'entrada', e.target.value)} />
              <span aria-hidden="true">→</span>
              <input type="time" value={p.saida} aria-label={`Saída do período ${i + 1}`} onChange={(e) => setPar(i, 'saida', e.target.value)} />
              {pares.length > 1 && <button className={css.rm} aria-label={`Remover o período ${i + 1}`} title="Remover período" onClick={() => setPares((ps) => ps.filter((_, idx) => idx !== i))}>×</button>}
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
                    aria-label={`Carga de ${d.l}`}
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

        {regime === 'normal' && (
          <div className={`${css.porDiaBox} ${compensa ? css.compOn : ''}`}>
            <label className={css.porDiaToggle}>
              <input type="checkbox" checked={compensa} onChange={(e) => setCompensa(e.target.checked)} />
              <span>
                <strong>Compensa na semana</strong>: a pessoa pode trabalhar mais em alguns dias para não vir em outros
                (estica a semana e folga o sábado, ou vem no sábado e sai mais cedo). Conta o <strong>total da semana</strong>.
              </span>
            </label>
            {compensa && (
              <div className={css.porDiaGrade}>
                <div className={css.compKpis}>
                  <div><small>Carga da semana</small><b>{minutosParaHhMm(cargaSemana)}</b><em>soma dos dias da escala</em></div>
                  <div><small>Semana vai de</small><b>seg → dom</b><em>fecha no domingo</em></div>
                  <div><small>Teto por dia</small><b>10h00</b><em>acima disso é extra no dia</em></div>
                </div>
                <ul className={css.compRegras}>
                  <li>Dia sem batida <b>não é falta</b> se a semana fechar a carga.</li>
                  <li>No fim da semana: passou da carga → <b>hora extra</b> (ou banco, pela regra do perfil). Ficou abaixo → <b>atraso</b>.</li>
                  <li>Só vira <b>falta</b> quando a semana fica devendo um dia inteiro (falta tira cesta e DSR).</li>
                  <li>Domingo e feriado trabalhados continuam extra 100%, fora da conta da semana. Feriado e atestado tiram a carga daquele dia da semana.</li>
                  <li>A semana que vira o mês é apurada inteira e fecha no mês em que termina.</li>
                </ul>
              </div>
            )}
          </div>
        )}

        </div>
      </PainelLateral>
    </div>
  );
}
