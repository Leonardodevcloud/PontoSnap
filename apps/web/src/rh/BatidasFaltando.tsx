import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { rotuloMarcacao } from '../lib/formato';
import { Avatar } from '../components/Avatar';
import { Explica } from '../components/Explica';
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
      const r = await api.post<{ enviados: number; funcionarios: number; comPendencia?: number }>('/tratamento/batidas-faltando/notificar');
      const total = r.comPendencia ?? r.funcionarios;
      setMsg(r.funcionarios === total
        ? `Notificação entregue para ${r.funcionarios} funcionário${r.funcionarios === 1 ? '' : 's'}.`
        : `Entregue para ${r.funcionarios} de ${total}. Quem não recebeu está sem notificação ativa no celular (veja em Configurações › Notificações do app).`);
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

  if (erro) return <div className={css.tela}><p style={{ color: 'var(--erro-text)', padding: 24 }}>{erro}</p></div>;
  if (!dados) return <div className={css.tela}><p style={{ padding: 24 }}>Carregando…</p></div>;

  return (
    <div className={css.tela}>
      <button className={css.voltar} onClick={() => nav('/rh')}>← Voltar ao painel</button>
      <div className={css.topo}>
        <div>
          <div className={css.tituloLinha}>
            <h1 className={css.h}>Batidas faltando</h1>
            <Explica>Dias com marcação em aberto. Clique em “Ajustar” pra lançar a batida que faltou, ou notifique os funcionários pra eles mesmos pedirem o ajuste.</Explica>
          </div>
          {dados.total > 0 && (
            <p className={css.sub}>
              <b>{dados.total}</b> {dados.total === 1 ? 'dia pendente' : 'dias pendentes'} de {dados.grupos.length} funcionário{dados.grupos.length > 1 ? 's' : ''}
            </p>
          )}
        </div>
        <button className={css.notifBtn} onClick={notificar} disabled={notificando || dados.total === 0}>
          {notificando ? 'Enviando…' : 'Notificar funcionários'}
        </button>
      </div>

      {msg && <div className={css.msgOk}>{msg}</div>}

      {dados.grupos.length === 0 && <div className={css.vazio}>Nenhuma batida faltando. Tudo certo.</div>}

      {dados.grupos.map((g) => (
        <div key={g.empregadoId} className={css.grupo}>
          <div className={css.grupoHead}>
            <Avatar id={g.empregadoId} nome={g.nome} tamanho={32} />
            <span className={css.grupoNome} title={g.nome}>{g.nome}</span>
            <span className={css.grupoCont}>{g.dias.length} {g.dias.length === 1 ? 'dia' : 'dias'}</span>
          </div>
          {g.dias.map((d) => (
            <div key={d.data} className={css.diaRow}>
              <div className={css.diaData}>{fmtDia(d.data)}<small>{dow(d.data)}</small></div>
              {(() => {
                const faltam = d.batidas.length < d.esperadas
                  ? Array.from({ length: d.esperadas - d.batidas.length }, (_, i) => rotuloMarcacao(d.batidas.length + i, d.esperadas))
                  : [];
                return (
                  <div className={css.diaBatidas}>
                    <span className={css.horas}>{d.batidas.length ? d.batidas.map((b) => b.hora).join(' · ') : 'sem batidas'}</span>
                    {faltam.length > 0 && (
                      <span className={`${css.chip} ${css.chipMiss}`} title={`Faltando: ${faltam.join(', ')}`}>
                        falta {faltam[0]!.toLowerCase()}{faltam.length > 1 ? ` +${faltam.length - 1}` : ''}
                      </span>
                    )}
                    {faltam.length === 0 && d.batidas.length % 2 !== 0 && (
                      <span className={`${css.chip} ${css.chipOpen}`}>em aberto</span>
                    )}
                  </div>
                );
              })()}
              <button className={css.diaAcao} onClick={() => abrirAjuste(g, d)}>Ajustar</button>
            </div>
          ))}
        </div>
      ))}

      {/* Modal de ajuste rápido */}
      {ajuste && (
        <div className={css.overlay} onClick={() => setAjuste(null)}>
          <div className={css.modal} role="dialog" aria-label="Ajuste rápido" onClick={(e) => e.stopPropagation()}>
            <div className={css.modalHead}>
              <h2 className={css.modalH}>Ajuste rápido</h2>
              <button className={css.modalX} onClick={() => setAjuste(null)} aria-label="Fechar">✕</button>
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
