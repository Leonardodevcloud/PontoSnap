import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { fmtHora, hojeSP, minutosParaHhMm, rotuloPorIndice } from '../lib/formato';
import type { Empregado, EspelhoResp } from '../tipos';
import css from './Espelhos.module.css';

export function Espelhos() {
  const [emps, setEmps] = useState<Empregado[]>([]);
  const [empregadoId, setEmpregadoId] = useState('');
  const [data, setData] = useState(hojeSP());
  const [esp, setEsp] = useState<EspelhoResp | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    api.get<Empregado[]>('/empregados')
      .then((l) => { const ativos = l.filter((e) => e.ativo); setEmps(ativos); if (ativos[0]) setEmpregadoId(ativos[0].id); })
      .catch((e) => setErro((e as Error).message));
  }, []);

  useEffect(() => {
    if (!empregadoId) return;
    setCarregando(true); setErro(null);
    api.get<EspelhoResp>(`/tratamento/espelho?empregadoId=${empregadoId}&data=${data}`)
      .then(setEsp)
      .catch((e) => { setErro((e as Error).message); setEsp(null); })
      .finally(() => setCarregando(false));
  }, [empregadoId, data]);

  const r = esp?.resumo;

  return (
    <div>
      <div className={css.head}><h2>Espelhos</h2><p>Jornada apurada por funcionário</p></div>

      <div className={css.controles}>
        <label className={css.sel}>
          <span className={css.lb}>Funcionário</span>
          <select value={empregadoId} onChange={(e) => setEmpregadoId(e.target.value)}>
            {emps.length === 0 && <option value="">— nenhum funcionário —</option>}
            {emps.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </label>
        <label className={css.sel}>
          <span className={css.lb}>Dia</span>
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </label>
      </div>

      {erro && <p className={css.erro}>{erro}</p>}

      {esp && (
        <div className={css.grid}>
          <div className={css.timeline}>
            <div className={css.tHead}>Batidas de {esp.nome.split(' ')[0]}</div>
            {esp.marcacoes.length === 0 && <div className={css.vazio}>Nenhuma batida nesse dia.</div>}
            {esp.marcacoes.map((m, i) => (
              <div key={m.nsr} className={css.row}>
                <span className={`${css.dot} ${i % 2 === 0 ? css.e : css.s}`} />
                <span className={css.k}>{rotuloPorIndice(i)}</span>
                <span className={css.t}>{fmtHora(m.dtMarcacao)}</span>
                <span className={css.nsr}>NSR #{String(m.nsr).padStart(5, '0')}</span>
              </div>
            ))}
            {r?.paresIncompletos && <div className={css.aviso}>Batida em aberto — falta uma saída/entrada.</div>}
          </div>

          <div className={css.resumo}>
            <div className={css.rHead}>Resumo do dia</div>
            <div className={css.metric}><span className={css.mL}>Trabalhado</span><span className={css.mV}>{minutosParaHhMm(r!.minutosTrabalhados)}</span></div>
            <div className={css.metric}><span className={css.mL}>Contratado</span><span className={css.mVsub}>{minutosParaHhMm(r!.minutosContratados)}</span></div>
            <div className={css.metric}>
              <span className={css.mL}>Saldo</span>
              <span className={`${css.mV} ${r!.saldoMinutos >= 0 ? css.pos : css.neg}`}>
                {r!.saldoMinutos > 0 ? '+' : ''}{minutosParaHhMm(r!.saldoMinutos)}
              </span>
            </div>
            <div className={css.metric}><span className={css.mL}>Noturno (22h–05h)</span><span className={css.mVsub}>{minutosParaHhMm(r!.minutosNoturnos)}</span></div>
            <div className={css.disclaimer}>Base: horas trabalhadas, extras e noturnas. DSR, feriados e banco de horas entram no motor de apuração completo.</div>
          </div>
        </div>
      )}
      {carregando && !esp && <div className={css.vazio}>Carregando…</div>}
    </div>
  );
}
