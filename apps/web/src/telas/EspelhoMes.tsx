import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { fmtHora, hojeSP, minutosParaHhMm } from '../lib/formato';
import type { ApuracaoResp, TipoAfastamento } from '../tipos';
import css from './EspelhoMes.module.css';

/** Primeiro e último dia da competência YYYY-MM, no calendário de Brasília. */
function limitesDoMes(comp: string) {
  const [a, m] = comp.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { inicio: `${comp}-01`, fim: `${comp}-${String(ultimo).padStart(2, '0')}` };
}

const competenciaDe = (dataStr: string) => dataStr.slice(0, 7);

function deslocarMes(comp: string, meses: number): string {
  const [a, m] = comp.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + meses, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const rotuloMes = (comp: string) =>
  new Date(`${comp}-01T12:00:00-0300`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const ROTULO_AFAST: Record<TipoAfastamento, string> = {
  FERIAS: 'Férias', INSS: 'Afastamento (INSS)', MATERNIDADE: 'Licença-maternidade',
  PATERNIDADE: 'Licença-paternidade', SUSPENSAO: 'Suspensão', OUTRO: 'Afastamento',
};

/** Saldo com sinal, do jeito que se lê num espelho de ponto. */
function comSinal(min: number): string {
  if (min === 0) return '—';
  const s = minutosParaHhMm(Math.abs(min));
  return `${min > 0 ? '+' : '−'}${s}`;
}

export function EspelhoMes() {
  const navegar = useNavigate();
  const [comp, setComp] = useState(competenciaDe(hojeSP()));
  const [dados, setDados] = useState<ApuracaoResp | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async (c: string) => {
    setCarregando(true);
    setErro(null);
    try {
      const { inicio, fim } = limitesDoMes(c);
      setDados(await api.get<ApuracaoResp>(`/marcacao/minha-apuracao?inicio=${inicio}&fim=${fim}`));
    } catch (e) { setErro((e as Error).message); }
    finally { setCarregando(false); }
  }, []);

  useEffect(() => { void carregar(comp); }, [carregar, comp]);

  const r = dados?.resultado;

  /** Que afastamento cobre este dia, se algum. */
  const motivoDoDia = (data: string): string | null => {
    const a = (dados?.afastamentos ?? []).find((x) => data >= x.dataInicio && data <= x.dataFim);
    return a ? ROTULO_AFAST[a.tipo] : null;
  };
  const ehMesAtual = comp === competenciaDe(hojeSP());
  // Dias futuros não são "falta": o mês ainda não aconteceu.
  const dias = (r?.dias ?? []).filter((d) => d.data <= hojeSP()).reverse();

  return (
    <div className="appshell">
      <div className={css.h}>Meu espelho</div>
      <div className={css.s}>Toque num dia pra ver as batidas e baixar os comprovantes.</div>

      <div className={css.nav}>
        <button onClick={() => setComp((c) => deslocarMes(c, -1))} aria-label="Mês anterior">‹</button>
        <span>{rotuloMes(comp)}</span>
        <button onClick={() => setComp((c) => deslocarMes(c, 1))} disabled={ehMesAtual} aria-label="Próximo mês">›</button>
      </div>

      {erro && <p className={css.erro}>{erro}</p>}
      {carregando && !r && <div className={css.vazio}>Carregando…</div>}

      {r && (
        <>
          <div className={css.resumo}>
            <div className={css.rL}>Saldo do mês</div>
            <div className={css.rV}>{comSinal(r.saldoPeriodoMin)}</div>
            <div className={css.mini}>
              <div>
                <div className={css.mL}>Trabalhado</div>
                <div className={css.mV}>{minutosParaHhMm(r.totalTrabalhadoMin)}</div>
              </div>
              <div>
                <div className={css.mL}>Previsto</div>
                <div className={css.mV}>{minutosParaHhMm(r.totalContratadoMin)}</div>
              </div>
              <div>
                <div className={css.mL}>Faltas</div>
                <div className={css.mV}>{r.totalFaltaMin > 0 ? minutosParaHhMm(r.totalFaltaMin) : '0'}</div>
              </div>
            </div>
          </div>

          {dias.length === 0 && <div className={css.vazio}>Nenhum dia apurado neste mês.</div>}

          {dias.map((d) => {
            const dia = new Date(`${d.data}T12:00:00-0300`);
            const motivo = motivoDoDia(d.data);
            const folga = (d.ehDescansoDia || !!motivo) && d.marcacoes.length === 0;
            return (
              <button
                key={d.data}
                className={`${css.dia} ${folga ? css.folga : ''} ${d.paresIncompletos ? css.alerta : ''}`}
                onClick={() => navegar(`/espelho/dia?data=${d.data}`)}
              >
                <span className={css.dN}>
                  {String(dia.getDate()).padStart(2, '0')}
                  <small>{DIAS[dia.getDay()]}</small>
                </span>
                <span className={css.dM}>
                  {d.marcacoes.length > 0
                    ? d.marcacoes.map((m) => fmtHora(String(m))).join(' · ')
                    : motivo ?? (folga ? 'Descanso' : 'Sem batidas')}
                  {d.paresIncompletos && <span className={`${css.tag} ${css.tagF}`}>Em aberto</span>}
                  {d.faltaInjustificada && <span className={`${css.tag} ${css.tagF}`}>Falta</span>}
                </span>
                <span className={`${css.dS} ${d.saldoMin > 0 ? css.pos : d.saldoMin < 0 ? css.neg : ''}`}>
                  {d.paresIncompletos ? '—' : d.marcacoes.length > 0 ? comSinal(d.saldoMin) : '—'}
                </span>
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
