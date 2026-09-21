import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { rotuloMarcacao } from '../lib/formato';
import css from './BatidasFaltando.module.css';

interface BatFalt { hora: string; nsr: number | null; id: string }
interface DiaFalt { data: string; batidas: BatFalt[]; esperadas: number; pares: { entrada: string; saida: string }[] }
interface Grupo { nome: string; empregadoId: string; dias: DiaFalt[] }
interface Resp { total: number; grupos: Grupo[] }

export function BatidasFaltando() {
  const nav = useNavigate();
  const [dados, setDados] = useState<Resp | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [notificando, setNotificando] = useState(false);

  // Modal de ajuste rápido
  const [ajuste, setAjuste] = useState<{ grupo: Grupo; dia: DiaFalt } | null>(null);
  const [hora, setHora] = useState('');
  const [tpLabel, setTpLabel] = useState('Entrada');
  const [obs, setObs] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [ajErro, setAjErro] = useState<string | null>(null);

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

  function abrirAjuste(grupo: Grupo, dia: DiaFalt) {
    // Pré-preenche com o horário do slot que tá faltando
    const faltando = (dia.pares ?? []).flatMap((p, i) => {
      const slots = [
        { h: p.entrada, label: i === 0 ? 'Entrada' : 'Retorno (almoço)' },
        { h: p.saida, label: i === (dia.pares ?? []).length - 1 ? 'Saída' : 'Saída (almoço)' },
      ];
      return slots;
    });
    const slotFaltando = faltando[dia.batidas.length];
    setHora(slotFaltando?.h ?? '');
    setTpLabel(slotFaltando?.label ?? 'Entrada');
    setObs(''); setAjErro(null);
    setAjuste({ grupo, dia });
  }

  async function lancar() {
    if (!ajuste) return;
    if (!/^\d{2}:\d{2}$/.test(hora)) { setAjErro('Informe a hora (HH:MM).'); return; }
    if (obs.trim().length < 3) { setAjErro('Escreva o motivo.'); return; }
    setEnviando(true); setAjErro(null);
    try {
      const tpMarc = tpLabel.includes('Entrada') || tpLabel.includes('Retorno') ? 'E' : 'S';
      await api.post('/ajustes/lancar', {
        empregadoId: ajuste.grupo.empregadoId,
        tipo: 'INCLUSAO', data: ajuste.dia.data,
        hora, tpMarc, observacao: obs.trim(),
      });
      setAjuste(null);
      setMsg(`Ajuste lançado — ${ajuste.grupo.nome.split(' ')[0]} ${fmtDia(ajuste.dia.data)}`);
      void carregar();
    } catch (e) { setAjErro((e as Error).message); }
    finally { setEnviando(false); }
  }

  if (erro) return <div className="appshell"><p style={{ color: 'var(--coral)', padding: 24 }}>{erro}</p></div>;
  if (!dados) return <div className="appshell"><p style={{ padding: 24 }}>Carregando…</p></div>;

  return (
    <div className="appshell">
      <button className={css.voltar} onClick={() => nav('/rh')}>← Voltar ao painel</button>
      <div className={css.topo}>
        <div>
          <h1 className={css.h}>Batidas faltando</h1>
          <p className={css.sub}>Dias com marcação em aberto. Clique pra ajustar direto.</p>
        </div>
        <button className={css.notifBtn} onClick={notificar} disabled={notificando || dados.total === 0}>
          {notificando ? 'Enviando…' : '🔔 Notificar funcionários'}
        </button>
      </div>

      {msg && <div className={css.msgOk}>✓ {msg}</div>}

      <div className={css.statBar}>
        <span className={css.statNum}>{dados.total}</span>
        <span className={css.statTxt}><b>dias pendentes</b> de {dados.grupos.length} funcionário{dados.grupos.length > 1 ? 's' : ''}</span>
      </div>

      {dados.grupos.length === 0 && <div className={css.vazio}>Nenhuma batida faltando. Tudo certo! 🎉</div>}

      {dados.grupos.map((g) => (
        <div key={g.empregadoId} className={css.grupo}>
          <div className={css.grupoHead}>
            <span className={css.grupoNome}>{g.nome}</span>
            <span className={css.grupoBadge}>{g.dias.length}</span>
          </div>
          {g.dias.map((d) => (
            <div key={d.data} className={css.diaRow}>
              <div className={css.diaData}>{fmtDia(d.data)}<small>{dow(d.data)}</small></div>
              <div className={css.diaBatidas}>
                {d.batidas.map((b, i) => <span key={i} className={`${css.chip} ${css.chipOk}`}>{b.hora}</span>)}
                {d.batidas.length < d.esperadas && Array.from({ length: d.esperadas - d.batidas.length }, (_, i) => (
                  <span key={`m${i}`} className={`${css.chip} ${css.chipMiss}`}>
                    {rotuloMarcacao(d.batidas.length + i, d.esperadas)} ?
                  </span>
                ))}
                {d.batidas.length % 2 !== 0 && d.batidas.length >= d.esperadas && (
                  <span className={`${css.chip} ${css.chipOpen}`}>Em aberto</span>
                )}
              </div>
              <button className={css.diaAcao} onClick={() => abrirAjuste(g, d)}>Ajustar</button>
            </div>
          ))}
        </div>
      ))}

      {/* Modal de ajuste rápido */}
      {ajuste && (
        <div className={css.overlay} onClick={() => setAjuste(null)}>
          <div className={css.modal} onClick={(e) => e.stopPropagation()}>
            <div className={css.modalHead}>
              <h2 className={css.modalH}>Ajuste rápido</h2>
              <button className={css.modalX} onClick={() => setAjuste(null)}>✕</button>
            </div>
            <p className={css.modalNome}>{ajuste.grupo.nome}</p>
            <p className={css.modalSub}>
              {dow(ajuste.dia.data)}, {fmtDia(ajuste.dia.data)}
              {(ajuste.dia.pares ?? []).length > 0 && ` · ${(ajuste.dia.pares ?? []).map((p) => `${p.entrada}–${p.saida}`).join(' / ')}`}
            </p>

            <div className={css.slots}>
              {(ajuste.dia.pares ?? []).flatMap((p, pi) => [
                { h: p.entrada, lb: pi === 0 ? 'Entrada' : 'Retorno' },
                { h: p.saida, lb: pi === (ajuste.dia.pares ?? []).length - 1 ? 'Saída' : 'Almoço' },
              ]).map((s, i) => {
                const bat = ajuste.dia.batidas[i];
                return (
                  <div key={i} className={`${css.slot} ${bat ? css.slotOk : css.slotMiss}`}>
                    <span className={css.slotLb}>{s.lb}</span>
                    <span className={css.slotV}>{bat ? bat.hora : s.h}</span>
                    <span className={bat ? css.slotTagOk : css.slotTagMiss}>{bat ? 'batido' : 'faltando'}</span>
                  </div>
                );
              })}
            </div>

            <label className={css.campo}>
              <span className={css.campoLb}>Horário</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className={css.campoInput} type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
                <select className={css.campoSelect} value={tpLabel} onChange={(e) => setTpLabel(e.target.value)}>
                  <option>Entrada</option>
                  <option>Saída (almoço)</option>
                  <option>Retorno (almoço)</option>
                  <option>Saída</option>
                </select>
              </div>
            </label>

            <label className={css.campo}>
              <span className={css.campoLb}>Motivo</span>
              <textarea className={css.campoTa} value={obs} onChange={(e) => setObs(e.target.value)}
                placeholder="Ex.: funcionário confirmou que saiu às 17h" />
            </label>

            {ajErro && <p className={css.ajErro}>{ajErro}</p>}

            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button className={css.btnCoral} onClick={lancar} disabled={enviando}>
                {enviando ? 'Lançando…' : 'Lançar ajuste'}
              </button>
              <button className={css.btnGhost} onClick={() => setAjuste(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function fmtDia(iso: string) { const [, m, d] = iso.split('-'); return `${d}/${m}`; }
function dow(iso: string) { return ['dom','seg','ter','qua','qui','sex','sáb'][new Date(`${iso}T12:00:00-0300`).getDay()]; }
