import { useEffect, useRef, useState } from 'react';
import { fmtDataCurta, fmtHora } from '../lib/formato';
import { marcarQuiosque, obterDeviceToken, definirDeviceToken } from '../lib/kiosk';
import { Flash } from '../components/Flash';
import { Teclado } from './Teclado';
import css from './Quiosque.module.css';

type Etapa = 'matricula' | 'pin' | 'confirmado';

export function Quiosque() {
  const [pareado, setPareado] = useState(!!obterDeviceToken());
  if (!pareado) return <Pareamento onPareado={() => setPareado(true)} />;
  return <Fluxo onDespareado={() => setPareado(false)} />;
}

/** Relógio ao vivo (HH:MM). */
function useRelogio() {
  const [agora, setAgora] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 1000 * 20);
    return () => clearInterval(id);
  }, []);
  return agora;
}

function Topbar() {
  const agora = useRelogio();
  return (
    <div className={css.topbar}>
      <div className={css.wm}>Ponto<span className={css.snap}>Snap</span></div>
      <div className={css.clock}>
        <div className={css.h}>{fmtHora(agora.toISOString())}</div>
        <div className={css.d}>{fmtDataCurta(agora)}</div>
      </div>
    </div>
  );
}

function Fluxo({ onDespareado }: { onDespareado: () => void }) {
  const [etapa, setEtapa] = useState<Etapa>('matricula');
  const [matricula, setMatricula] = useState('');
  const [pin, setPin] = useState('');
  const [nome, setNome] = useState('');
  const [hora, setHora] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const timer = useRef<number | null>(null);

  function reiniciar() {
    setEtapa('matricula'); setMatricula(''); setPin(''); setErro(null);
  }

  // Auto-reset após a confirmação.
  useEffect(() => {
    if (etapa !== 'confirmado') return;
    timer.current = window.setTimeout(reiniciar, 4000);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [etapa]);

  async function bater() {
    setErro(null); setEnviando(true);
    try {
      const r = await marcarQuiosque(matricula, pin);
      setNome(r.empregado.nome);
      setHora(fmtHora(r.marcacao.dtMarcacao));
      setEtapa('confirmado');
    } catch (e) {
      setErro((e as Error).message);
      setPin('');
    } finally {
      setEnviando(false);
    }
  }

  if (etapa === 'confirmado') {
    return (
      <div className={`${css.screen} ${css.conf}`}>
        <Flash tamanho={96} cor="var(--peach)" girando className={css.confFlash} />
        <div className={css.check} aria-hidden="true">
          <svg width="66" height="66" viewBox="0 0 24 24" fill="none">
            <path d="M4 12.5 L9.5 18 L20 6" stroke="#FFF8EE" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className={css.bateu}>Bateu, {nome.split(' ')[0]}!</div>
        <div className={css.bateuSub}>Ponto registrado às <span className={css.tm}>{hora}</span></div>
        <button className={css.voltando} onClick={reiniciar}>voltando pra tela inicial… · toque pra já</button>
      </div>
    );
  }

  const naMatricula = etapa === 'matricula';

  return (
    <div className={css.screen}>
      <Topbar />
      <div className={css.center}>
        <div className={css.prompt}>
          {naMatricula ? 'Bate o ponto' : 'Agora o seu PIN'}
          <small>{naMatricula ? 'Digite sua matrícula' : `matrícula ${matricula}`}</small>
        </div>

        {naMatricula
          ? <div className={css.entered}>{matricula.split('').join(' ') || '\u00A0'}</div>
          : <div className={css.dots}>{Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
              <i key={i} className={i < pin.length ? css.on : ''} />
            ))}</div>}

        {erro && <p className={css.erro}>{erro}</p>}

        <Teclado
          onDigito={(d) => naMatricula
            ? setMatricula((m) => (m + d).slice(0, 10))
            : setPin((p) => (p + d).slice(0, 8))}
          onApagar={() => naMatricula ? setMatricula((m) => m.slice(0, -1)) : setPin((p) => p.slice(0, -1))}
          onOk={() => {
            if (naMatricula) { if (matricula) { setErro(null); setEtapa('pin'); } }
            else if (pin.length >= 4 && !enviando) void bater();
          }}
          okLabel={naMatricula ? 'continuar →' : (enviando ? '...' : 'bater →')}
          okDesabilitado={naMatricula ? !matricula : pin.length < 4 || enviando}
        />

        {!naMatricula && <button className={css.voltar} onClick={reiniciar}>← trocar matrícula</button>}
      </div>
      <button className={css.trocarDisp} onClick={() => { definirDeviceToken(null); onDespareado(); }}>trocar dispositivo</button>
    </div>
  );
}

function Pareamento({ onPareado }: { onPareado: () => void }) {
  const [token, setToken] = useState('');
  return (
    <div className={css.screen}>
      <Topbar />
      <div className={css.center}>
        <div className={css.prompt}>Parear este tablet<small>Cole o token gerado pelo RH em Quiosques</small></div>
        <input className={css.tokenInput} value={token} onChange={(e) => setToken(e.target.value.trim())}
          placeholder="cole o token do dispositivo" />
        <button className={css.ativar} disabled={!token} onClick={() => { definirDeviceToken(token); onPareado(); }}>
          Ativar quiosque
        </button>
      </div>
    </div>
  );
}
