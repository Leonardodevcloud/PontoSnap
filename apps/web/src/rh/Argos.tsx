import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { Empregado } from '../tipos';
import css from './Argos.module.css';

interface Resposta { resposta: string; fontes: string[]; pessoa: string | null; empregadoId: string | null; mes: string }
interface Turno { pergunta: string; resposta: string; fontes: string[]; pessoa: string | null }

const mesHoje = () => new Date().toISOString().slice(0, 7);

/** Argos — assistente que explica o ponto (apuração + regras + CLT/CCT). */
export function Argos() {
  const [ativo, setAtivo] = useState<boolean | null>(null);
  const [emps, setEmps] = useState<Empregado[]>([]);
  const [empregadoId, setEmpregadoId] = useState('');
  const [mes, setMes] = useState(mesHoje());
  const [pergunta, setPergunta] = useState('');
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [pensando, setPensando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<{ ativo: boolean }>('/argos/status').then((r) => setAtivo(r.ativo)).catch(() => setAtivo(false));
    api.get<Empregado[]>('/empregados').then((r) => setEmps(r.filter((e) => e.ativo))).catch(() => {});
  }, []);
  useEffect(() => { fim.current?.scrollIntoView({ behavior: 'smooth' }); }, [turnos, pensando]);

  async function enviar() {
    const q = pergunta.trim();
    if (!q || pensando) return;
    setPergunta(''); setErro(null); setPensando(true);
    const historico = turnos.slice(-4).map((t) => ({ pergunta: t.pergunta, resposta: t.resposta }));
    try {
      const r = await api.post<Resposta>('/argos/perguntar', { pergunta: q, empregadoId: empregadoId || null, mes, historico });
      setTurnos((ts) => [...ts, { pergunta: q, resposta: r.resposta, fontes: r.fontes, pessoa: r.pessoa }]);
    } catch (e) {
      setErro((e as Error).message);
      setPergunta(q);
    } finally { setPensando(false); }
  }

  const exemplos = useMemo(() => [
    'Por que essa pessoa ficou com essas horas extras no mês?',
    'Esse intervalo curto está correto? Qual a base legal?',
    'Como funciona a tolerância de atraso aqui?',
    'Esse desconto de falta e DSR está certo?',
  ], []);

  return (
    <div className={css.pagina}>
      <header className={css.cab}>
        <div className={css.esfera} aria-hidden="true"><span /></div>
        <div>
          <h1>Argos</h1>
          <p>Pergunte sobre o ponto: por que deu X hora extra, se um intervalo está certo, a base na CLT. Ele lê a apuração real e as regras da pessoa.</p>
        </div>
      </header>

      {ativo === false && (
        <div className={css.aviso}>O Argos ainda não está ligado: falta a chave <b>DEEPSEEK_CHAVE</b> no serviço da API. Ele já responde assim que a chave for configurada.</div>
      )}

      <div className={css.ctx}>
        <label>Sobre quem
          <select value={empregadoId} onChange={(e) => setEmpregadoId(e.target.value)}>
            <option value="">Detectar pelo nome na pergunta</option>
            {emps.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </label>
        <label>Mês
          <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
        </label>
      </div>

      <div className={css.conversa}>
        {turnos.length === 0 && !pensando && (
          <div className={css.inicio}>
            <p>Comece escolhendo a pessoa e o mês (ou cite o nome na pergunta). Exemplos:</p>
            <div className={css.exemplos}>
              {exemplos.map((x) => <button key={x} onClick={() => setPergunta(x)}>{x}</button>)}
            </div>
          </div>
        )}
        {turnos.map((t, i) => (
          <div key={i} className={css.turno}>
            <div className={css.pergunta}>{t.pergunta}</div>
            <div className={css.resposta}>
              {t.pessoa && <div className={css.sobre}>sobre {t.pessoa}</div>}
              {t.resposta.split('\n').filter(Boolean).map((p, j) => <p key={j}>{p}</p>)}
              {t.fontes.length > 0 && (
                <div className={css.fontes}>{t.fontes.map((f) => <span key={f} className={css.fonte}>{f}</span>)}</div>
              )}
            </div>
          </div>
        ))}
        {pensando && <div className={css.pensando}>Argos está lendo a apuração e as regras…</div>}
        {erro && <div className={css.erro} role="alert">{erro}</div>}
        <div ref={fim} />
      </div>

      <div className={css.barra}>
        <textarea
          value={pergunta} onChange={(e) => setPergunta(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void enviar(); } }}
          placeholder="Pergunte ao Argos…" rows={1} disabled={ativo === false}
        />
        <button onClick={() => void enviar()} disabled={pensando || !pergunta.trim() || ativo === false}>Enviar</button>
      </div>
    </div>
  );
}
