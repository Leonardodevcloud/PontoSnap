import type { ReactNode } from 'react';
import css from './Ajuda.module.css';

/**
 * Peças para desenhar "telas de mentira" nos artigos: uma janela com o
 * caminho da tela, opções e caixas no visual do sistema e marcas laranja
 * (a, b, c) apontando onde clicar. Só ilustração — nada aqui é clicável.
 */
export function Tela({ caminho, children }: { caminho: string; children: ReactNode }) {
  return (
    <figure className={css.tela} aria-label={`Simulação da tela ${caminho}`}>
      <figcaption className={css.telaTb}><i /><i /><i /><span>{caminho}</span></figcaption>
      <div className={css.telaPan}>{children}</div>
    </figure>
  );
}
export function Marca({ l }: { l: string }) { return <span className={css.marca} aria-label={`marca ${l}`}>{l}</span>; }

export function Opcao({ titulo, sub, on, marca, radio = true }: { titulo: string; sub?: string; on?: boolean; marca?: string; radio?: boolean }) {
  return (
    <div className={`${css.sOp} ${on ? css.sOpOn : ''} ${marca ? css.sHl : ''}`}>
      <span className={radio ? css.sRd : css.sCk} aria-hidden="true" />
      <span><b>{titulo}</b>{sub && <small>{sub}</small>}</span>
      {marca && <Marca l={marca} />}
    </div>
  );
}
export function Campo({ rotulo, valor, marca }: { rotulo: string; valor: string; marca?: string }) {
  return (
    <div className={`${css.sCampo} ${marca ? css.sHl : ''}`}>
      <small>{rotulo}</small><span>{valor}</span>{marca && <Marca l={marca} />}
    </div>
  );
}
export function Botao({ children, marca, sec }: { children: ReactNode; marca?: string; sec?: boolean }) {
  return <span className={`${sec ? css.sBtn2 : css.sBtn} ${marca ? css.sHl : ''}`}>{children}{marca && <Marca l={marca} />}</span>;
}
export function Grade({ n = 2, children }: { n?: number; children: ReactNode }) {
  return <div className={css.sGrade} style={{ gridTemplateColumns: `repeat(${n}, minmax(0,1fr))` }}>{children}</div>;
}
/** Legenda das marcas, logo abaixo da tela. */
export function Legenda({ itens }: { itens: [string, ReactNode][] }) {
  return <ul className={css.legenda}>{itens.map(([l, t]) => <li key={l}><Marca l={l} /><span>{t}</span></li>)}</ul>;
}

/** A semana de exemplo (carga 8h): 9h · 7h · 8h30 · 7h30 · 8h. */
export const SEMANA_EX = [
  { d: 'Seg', h: '9h00', s: 60 }, { d: 'Ter', h: '7h00', s: -60 }, { d: 'Qua', h: '8h30', s: 30 }, { d: 'Qui', h: '7h30', s: -30 }, { d: 'Sex', h: '8h00', s: 0 },
];
const sal = (m: number) => m === 0 ? '0' : `${m > 0 ? '+' : '−'}${Math.floor(Math.abs(m) / 60)}h${String(Math.abs(m) % 60).padStart(2, '0')}`;

export function TabelaSemana() {
  return (
    <div className={css.tabWrap}>
      <table className={css.semana}>
        <caption className={css.srOnly}>Mesma semana com e sem compensação</caption>
        <thead><tr><th>Dia</th><th>Trabalhou</th><th className={css.r}>Saldo do dia</th><th>Sem compensar</th><th>Compensando (semana, mês ou banco)</th></tr></thead>
        <tbody>
          {SEMANA_EX.map((x, i) => (
            <tr key={x.d}>
              <td>{x.d}</td><td>{x.h}</td><td className={`${css.r} ${x.s > 0 ? css.pos : x.s < 0 ? css.neg : ''}`}>{sal(x.s)}</td>
              <td>{x.s > 0 ? `${sal(x.s).slice(1)} de extra paga (+50%)` : x.s < 0 ? `${sal(x.s).slice(1)} de atraso descontado` : '—'}</td>
              {i === 0 && <td rowSpan={5} className={css.junta}>Os saldos se anulam.<br /><b>Nada pago, nada descontado.</b></td>}
            </tr>
          ))}
          <tr className={css.tot}><td>Semana</td><td>40h00</td><td className={css.r}>0</td><td className={css.neg}>paga 1h30 e desconta 1h30</td><td className={css.pos}>zerado</td></tr>
        </tbody>
      </table>
    </div>
  );
}

export function Aviso({ tipo = 'info', children }: { tipo?: 'info' | 'aviso' | 'ok' | 'erro'; children: ReactNode }) {
  return <div className={`${css.caixa} ${css[`cx-${tipo}`]}`}>{children}</div>;
}
