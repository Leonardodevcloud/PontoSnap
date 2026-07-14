import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { fmtHora } from '../lib/formato';
import type { PainelResp } from '../tipos';
import css from './PainelRH.module.css';

const COLETOR: Record<number, string> = { 1: 'App', 2: 'Navegador', 3: 'Desktop', 4: 'Quiosque', 5: 'Outro' };

export function PainelRH() {
  const [p, setP] = useState<PainelResp | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api.get<PainelResp>('/tratamento/painel').then(setP).catch((e) => setErro((e as Error).message));
  }, []);

  const pct = p && p.ativos > 0 ? Math.round((p.presentes / p.ativos) * 100) : 0;
  const circ = 2 * Math.PI * 52;

  return (
    <div>
      <div className={css.head}><h2>Painel</h2><p>Visão do dia · {p ? fmtDataExtenso(p.data) : '—'}</p></div>
      {erro && <p className={css.erro}>{erro}</p>}

      <div className={css.stats}>
        <Stat k="Funcionários ativos" v={p?.ativos ?? '—'} />
        <Stat k="Presentes hoje" v={p?.presentes ?? '—'} destaque />
        <Stat k="Ausentes hoje" v={p?.ausentes ?? '—'} alerta={!!p && p.ausentes > 0} />
        <Stat k="Marcações hoje" v={p?.marcacoesHoje ?? '—'} />
      </div>

      <div className={css.painel}>
        <div className={css.bloco}>
          <h3>Presença</h3>
          <div className={css.donutWrap}>
            <svg viewBox="0 0 120 120" className={css.donut}>
              <circle cx="60" cy="60" r="52" fill="none" stroke="var(--peach)" strokeWidth="14" />
              <circle cx="60" cy="60" r="52" fill="none" stroke="var(--coral)" strokeWidth="14" strokeLinecap="round"
                strokeDasharray={`${(pct / 100) * circ} ${circ}`} transform="rotate(-90 60 60)" />
              <text x="60" y="56" textAnchor="middle" className={css.donutPct}>{pct}%</text>
              <text x="60" y="74" textAnchor="middle" className={css.donutLb}>presentes</text>
            </svg>
            <div className={css.legenda}>
              <div><span className={css.dotOn} /> {p?.presentes ?? 0} presentes</div>
              <div><span className={css.dotOff} /> {p?.ausentes ?? 0} ausentes</div>
            </div>
          </div>
        </div>

        <div className={css.bloco}>
          <div className={css.blocoHead}><h3>Últimas batidas</h3><Link to="/rh/espelhos" className={css.verLink}>espelhos →</Link></div>
          {p && p.ultimas.length === 0 && <p className={css.vazio}>Nenhuma batida hoje ainda.</p>}
          <div className={css.lista}>
            {p?.ultimas.map((m, i) => (
              <div key={i} className={css.item}>
                <span className={css.itemNome}>{m.nome}</span>
                <span className={css.itemHora}>{fmtHora(m.dt)}</span>
                <span className={css.itemTag}>{COLETOR[m.coletor] ?? '—'}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={css.bloco}>
          <div className={css.blocoHead}><h3>Ausentes hoje</h3><Link to="/rh/funcionarios" className={css.verLink}>funcionários →</Link></div>
          {p && p.listaAusentes.length === 0 && <p className={css.vazio}>Todo mundo bateu ponto. 🎉</p>}
          <div className={css.lista}>
            {p?.listaAusentes.map((a, i) => (
              <div key={i} className={css.item}>
                <span className={css.itemNome}>{a.nome}</span>
                <span className={css.itemMat}>{a.matricula ?? '—'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ k, v, destaque, alerta }: { k: string; v: number | string; destaque?: boolean; alerta?: boolean }) {
  return (
    <div className={`${css.stat} ${destaque ? css.statDestaque : ''} ${alerta ? css.statAlerta : ''}`}>
      <span className={css.statK}>{k}</span>
      <span className={css.statV}>{v}</span>
    </div>
  );
}

function fmtDataExtenso(iso: string) {
  const [a, m, d] = iso.split('-');
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${d} de ${meses[Number(m) - 1]}. ${a}`;
}
