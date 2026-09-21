import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { rotuloMarcacao } from '../lib/formato';
import css from './BatidasFaltando.module.css';

interface BatidaFaltando { hora: string; nsr: number | null; id: string }
interface DiaFaltando { data: string; batidas: BatidaFaltando[]; esperadas: number }
interface GrupoFaltando { nome: string; dias: DiaFaltando[] }
interface Resp { total: number; grupos: GrupoFaltando[] }

export function BatidasFaltando() {
  const nav = useNavigate();
  const [dados, setDados] = useState<Resp | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [notificando, setNotificando] = useState(false);

  const carregar = useCallback(async () => {
    try { setDados(await api.get<Resp>('/tratamento/batidas-faltando')); }
    catch (e) { setErro((e as Error).message); }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  async function notificar() {
    setNotificando(true); setMsg(null);
    try {
      const r = await api.post<{ enviados: number; funcionarios: number }>('/tratamento/batidas-faltando/notificar');
      setMsg(`Notificação enviada para ${r.funcionarios} funcionário${r.funcionarios > 1 ? 's' : ''}.`);
    } catch (e) { setMsg((e as Error).message); }
    finally { setNotificando(false); }
  }

  if (erro) return <div className="appshell"><p style={{ color: 'var(--coral)', padding: 24 }}>{erro}</p></div>;
  if (!dados) return <div className="appshell"><p style={{ padding: 24 }}>Carregando…</p></div>;

  return (
    <div className="appshell">
      <button className={css.voltar} onClick={() => nav('/rh')}>← Voltar ao painel</button>

      <div className={css.topo}>
        <div>
          <h1 className={css.h}>Batidas faltando</h1>
          <p className={css.sub}>Dias com marcação em aberto ou ímpar. Clique pra ajustar direto.</p>
        </div>
        <button className={css.notifBtn} onClick={notificar} disabled={notificando || dados.total === 0}>
          {notificando ? 'Enviando…' : '🔔 Notificar funcionários'}
        </button>
      </div>

      {msg && <div className={css.msgOk}>{msg}</div>}

      <div className={css.statBar}>
        <span className={css.statNum}>{dados.total}</span>
        <span className={css.statTxt}><b>dias pendentes</b> de {dados.grupos.length} funcionário{dados.grupos.length > 1 ? 's' : ''}</span>
      </div>

      {dados.grupos.length === 0 && (
        <div className={css.vazio}>Nenhuma batida faltando. Tudo certo! 🎉</div>
      )}

      {dados.grupos.map((g) => (
        <div key={g.nome} className={css.grupo}>
          <div className={css.grupoHead}>
            <span className={css.grupoNome}>{g.nome}</span>
            <span className={css.grupoBadge}>{g.dias.length} dia{g.dias.length > 1 ? 's' : ''}</span>
          </div>
          {g.dias.map((d) => {
            const chips: Array<{ label: string; status: 'ok' | 'miss' | 'open' }> = [];
            for (let i = 0; i < Math.max(d.esperadas, d.batidas.length); i++) {
              const b = d.batidas[i];
              if (b) {
                chips.push({ label: `${b.hora}`, status: 'ok' });
              } else {
                chips.push({ label: `${rotuloMarcacao(i, d.esperadas)} ?`, status: 'miss' });
              }
            }
            if (d.batidas.length > 0 && d.batidas.length % 2 !== 0 && d.batidas.length < d.esperadas) {
              // Já tem chips miss
            } else if (d.batidas.length % 2 !== 0) {
              chips.push({ label: 'Em aberto', status: 'open' });
            }

            const [, m, dia] = d.data.split('-') as [string, string, string];
            const dow = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(`${d.data}T12:00:00-0300`).getDay()];

            return (
              <div key={d.data} className={css.diaRow}>
                <div className={css.diaData}>{dia}/{m}<small>{dow}</small></div>
                <div className={css.diaBatidas}>
                  {chips.map((c, i) => (
                    <span key={i} className={`${css.chip} ${css[`chip_${c.status}`]}`}>{c.label}</span>
                  ))}
                </div>
                <button className={css.diaAcao} onClick={() => {
                  // Navega pro ajuste pré-preenchido
                  nav(`/rh/ajustes?data=${d.data}`);
                }}>Ajustar</button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
