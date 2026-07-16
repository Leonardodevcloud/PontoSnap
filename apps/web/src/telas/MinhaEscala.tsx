import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { hojeSP, minutosParaHhMm } from '../lib/formato';
import type { MinhaEscalaResp } from '../tipos';
import css from './MinhaEscala.module.css';

const DIAS_CURTO = ['d', 's', 't', 'q', 'q', 's', 's'];
const DIAS_NOME = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function limitesDoMes(comp: string) {
  const [a, m] = comp.split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { inicio: `${comp}-01`, fim: `${comp}-${String(ultimo).padStart(2, '0')}`, ultimo };
}

function deslocarMes(comp: string, meses: number): string {
  const [a, m] = comp.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + meses, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const rotuloMes = (comp: string) =>
  new Date(`${comp}-01T12:00:00-0300`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

/** "Segunda a sexta" quando os dias são seguidos; senão lista. */
function descreverDias(dias: number[]): string {
  if (dias.length === 0) return 'Nenhum dia definido';
  const ord = [...dias].sort((a, b) => a - b);
  const seguidos = ord.every((d, i) => i === 0 || d === ord[i - 1] + 1);
  if (seguidos && ord.length > 2) return `${DIAS_NOME[ord[0]]} a ${DIAS_NOME[ord[ord.length - 1]]}`;
  return ord.map((d) => DIAS_NOME[d]).join(', ');
}

export function MinhaEscala() {
  const [comp, setComp] = useState(hojeSP().slice(0, 7));
  const [dados, setDados] = useState<MinhaEscalaResp | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async (c: string) => {
    setErro(null);
    try {
      const { inicio, fim } = limitesDoMes(c);
      setDados(await api.get<MinhaEscalaResp>(`/marcacao/minha-escala?inicio=${inicio}&fim=${fim}`));
    } catch (e) { setErro((e as Error).message); }
  }, []);

  useEffect(() => { void carregar(comp); }, [carregar, comp]);

  const h = dados?.horario ?? null;
  const feriados = new Map((dados?.feriados ?? []).map((f) => [f.data, f.nome]));
  const porEscala = new Set(dados?.escala ?? []);
  const { ultimo } = limitesDoMes(comp);
  const primeiroDiaSemana = new Date(`${comp}-01T12:00:00-0300`).getDay();

  /** Trabalha nesse dia? Escala gerada manda; senão, os dias da semana do contrato. */
  function trabalha(data: string, diaSemana: number): boolean {
    if (porEscala.size > 0) return porEscala.has(data);
    return h ? h.diasSemana.includes(diaSemana) : false;
  }

  const celulas: (null | { n: number; data: string; ds: number })[] = [];
  for (let i = 0; i < primeiroDiaSemana; i++) celulas.push(null);
  for (let n = 1; n <= ultimo; n++) {
    const data = `${comp}-${String(n).padStart(2, '0')}`;
    celulas.push({ n, data, ds: new Date(`${data}T12:00:00-0300`).getDay() });
  }

  return (
    <div className="appshell">
      <div className={css.h}>Minha escala</div>
      <div className={css.s}>O que está combinado no seu contrato.</div>

      {erro && <p className={css.erro}>{erro}</p>}

      {h ? (
        <div className={css.jornada}>
          <div className={css.jH}>Sua jornada</div>
          <div className={css.jV}>
            {descreverDias(h.diasSemana)}
            <br />
            {h.pares.map((p) => `${p.entrada}–${p.saida}`).join(' · ')}
          </div>
          <div className={css.jP}>
            {minutosParaHhMm(h.durJornadaMin)} por dia · horário {h.codigo}
          </div>
        </div>
      ) : (
        <div className={css.semHorario}>
          <b>Sem horário cadastrado</b>
          <p>O RH da sua empresa ainda não definiu sua jornada. Fale com eles.</p>
        </div>
      )}

      <div className={css.nav}>
        <button onClick={() => setComp((c) => deslocarMes(c, -1))} aria-label="Mês anterior">‹</button>
        <span>{rotuloMes(comp)}</span>
        <button onClick={() => setComp((c) => deslocarMes(c, 1))} aria-label="Próximo mês">›</button>
      </div>

      <div className={css.cal}>
        {DIAS_CURTO.map((d, i) => <div key={i} className={css.calH}>{d}</div>)}
        {celulas.map((c, i) => {
          if (!c) return <div key={`v${i}`} />;
          const fer = feriados.get(c.data);
          const trab = trabalha(c.data, c.ds) && !fer;
          return (
            <div
              key={c.data}
              className={`${css.calD} ${fer ? css.fer : trab ? css.trab : css.folgaD} ${c.data === hojeSP() ? css.hoje : ''}`}
              title={fer ?? (trab ? 'Trabalha' : 'Folga')}
            >
              {c.n}
            </div>
          );
        })}
      </div>

      <div className={css.legenda}>
        <span><i className={`${css.lp} ${css.lpT}`} />Trabalha</span>
        <span><i className={`${css.lp} ${css.lpF}`} />Folga</span>
        <span><i className={`${css.lp} ${css.lpH}`} />Feriado</span>
      </div>

      {dados && dados.feriados.length > 0 && (
        <div className={css.feriados}>
          <div className={css.jH}>Feriados do mês</div>
          {dados.feriados.map((f) => (
            <div key={f.data} className={css.fer1}>
              <span className={css.ferD}>{f.data.slice(8)}</span>
              <span>{f.nome}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
