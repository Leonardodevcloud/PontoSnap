import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { fmtDataCurta, fmtHora, hojeSP, rotuloMarcacao, rotuloProxima } from '../lib/formato';
import type { Batida, MinhasMarcacoes } from '../tipos';
import { Flash } from '../components/Flash';
import { Botao } from '../components/Botao';
import css from './BaterPonto.module.css';

/** Tempo de pressão para confirmar. Curto o bastante pra não irritar,
 *  longo o bastante pra um toque acidental não registrar ponto. */
const DUR_SEGURAR = 900;
const RAIO = 96;
const VOLTA = 2 * Math.PI * RAIO;

export function BaterPonto() {
  const navegar = useNavigate();
  const [dados, setDados] = useState<MinhasMarcacoes | null>(null);
  const [batendo, setBatendo] = useState(false);
  const [confirmada, setConfirmada] = useState<{ batida: Batida; tipo: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [progresso, setProgresso] = useState(0);
  const raf = useRef<number | null>(null);
  const inicio = useRef<number>(0);

  const carregar = useCallback(async () => {
    try { setDados(await api.get<MinhasMarcacoes>(`/marcacao/minhas?data=${hojeSP()}`)); }
    catch (e) { setErro((e as Error).message); }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  const marcs = dados?.marcacoes ?? [];
  const esperadas = dados?.esperadas ?? 0;
  const proxima = rotuloProxima(marcs.length, esperadas);
  const excedente = esperadas > 0 && marcs.length >= esperadas;

  async function bater() {
    setErro(null);
    setBatendo(true);
    try {
      const qtdAntes = marcs.length;
      const batida = await api.post<Batida>('/marcacao', { coletor: 2 });
      setConfirmada({ batida, tipo: rotuloProxima(qtdAntes, esperadas) });
      void carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setBatendo(false);
      setProgresso(0);
    }
  }

  // ----- segurar para registrar -----
  function passo() {
    const p = Math.min(1, (performance.now() - inicio.current) / DUR_SEGURAR);
    setProgresso(p);
    if (p >= 1) { raf.current = null; void bater(); return; }
    raf.current = requestAnimationFrame(passo);
  }
  function aoSegurar(e: React.PointerEvent) {
    if (batendo) return;
    e.preventDefault();
    inicio.current = performance.now();
    raf.current = requestAnimationFrame(passo);
  }
  function aoSoltar() {
    if (raf.current) { cancelAnimationFrame(raf.current); raf.current = null; }
    setProgresso(0);
  }

  // ----- Tela "Bateu!" -----
  if (confirmada) {
    return (
      <div className={`appshell ${css.conf}`}>
        <Flash tamanho={92} cor="var(--peach)" girando className={css.confFlash} />
        <div className={css.check} aria-hidden="true">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
            <path d="M4 12.5 L9.5 18 L20 6" stroke="#FFF8EE" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className={css.bateu}>Bateu!</div>
        <div className={css.bateuSub}>
          {confirmada.tipo} registrada às <span className={css.tm}>{fmtHora(confirmada.batida.dtMarcacao)}</span>
        </div>
        <div className={css.espaco} />
        <Botao variante="lime" onClick={() => navegar('/espelho')}>Ver espelho do dia</Botao>
        <Botao variante="ghost" onClick={() => setConfirmada(null)}>Voltar</Botao>
      </div>
    );
  }

  // ----- Home / bater -----
  const primeiroNome = dados?.nome?.split(' ')[0] ?? '';

  return (
    <div className="appshell">
      <div className={css.oi}>Oi{primeiroNome ? `, ${primeiroNome}` : ''}</div>
      <div className={css.hoje}>
        {fmtDataCurta()}
        {marcs.length > 0 && ` · você entrou às ${fmtHora(marcs[0].dtMarcacao)}`}
      </div>

      <div className={css.btnzona}>
        <button
          className={css.snapbtn}
          onPointerDown={aoSegurar}
          onPointerUp={aoSoltar}
          onPointerLeave={aoSoltar}
          onPointerCancel={aoSoltar}
          onContextMenu={(e) => e.preventDefault()}
          disabled={batendo}
          aria-label={batendo ? 'Registrando' : `Segure para registrar a ${proxima.toLowerCase()}`}
        >
          <svg className={css.anel} viewBox="0 0 200 200" aria-hidden="true">
            <circle
              cx="100" cy="100" r={RAIO}
              strokeDasharray={VOLTA}
              strokeDashoffset={VOLTA * (1 - progresso)}
            />
          </svg>
          <span className={css.big}>{batendo ? 'Batendo…' : <>Bater<br />ponto</>}</span>
          {!batendo && (
            <span className={css.sm}>
              segure pra registrar<br />a {proxima.toLowerCase()}
            </span>
          )}
        </button>
      </div>

      {/* A lei proíbe restringir marcação: nunca bloqueamos, só avisamos. */}
      {excedente && (
        <p className={css.aviso}>
          Você já registrou as {esperadas} marcações previstas para hoje.
          Pode bater de novo — o RH vai ver esta marcação a mais.
        </p>
      )}

      {erro && <p className={css.erro}>{erro}</p>}

      <div className={css.sofar}>
        <div className={css.h}>Hoje</div>
        {marcs.length === 0 && <div className={css.vazio}>Nada por aqui ainda. Bate o primeiro ponto do dia?</div>}
        {marcs.map((m, i) => (
          <div key={m.nsr} className={css.row}>
            <span className={css.k}>{rotuloMarcacao(i, esperadas || marcs.length)}</span>
            <span className={css.t}>{fmtHora(m.dtMarcacao)}</span>
          </div>
        ))}
      </div>

      <div className={css.espaco} />
      <Botao variante="ghost" onClick={() => navegar('/espelho')}>Ver espelho do dia</Botao>
    </div>
  );
}
