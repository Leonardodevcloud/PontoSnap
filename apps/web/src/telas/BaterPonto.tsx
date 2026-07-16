import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { fmtDataCurta, fmtHora, hojeSP, rotuloMarcacao, rotuloProxima } from '../lib/formato';
import { capturarPosicao, type ResultadoGeo } from '../lib/geolocalizacao';
import { foraDoRaio } from '@ponto/shared';
import type { Batida, MinhasMarcacoes } from '../tipos';
import { Flash } from '../components/Flash';
import { Botao } from '../components/Botao';
import css from './BaterPonto.module.css';

/** Tempo de pressão para confirmar. Curto o bastante pra não irritar,
 *  longo o bastante pra um toque acidental não registrar ponto. */
const DUR_SEGURAR = 900;
const RAIO = 96;
const VOLTA = 2 * Math.PI * RAIO;

/** Atalhos para quem bate fora do raio — 1 toque em vez de digitar. */
const MOTIVOS = ['Home office', 'Visita a cliente', 'Trabalho externo', 'Outro'];

const formatarDistancia = (m: number) =>
  m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;

export function BaterPonto() {
  const navegar = useNavigate();
  const [dados, setDados] = useState<MinhasMarcacoes | null>(null);
  const [batendo, setBatendo] = useState(false);
  const [confirmada, setConfirmada] = useState<{ batida: Batida; tipo: string; obs?: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [progresso, setProgresso] = useState(0);
  const [geo, setGeo] = useState<ResultadoGeo | null>(null);
  const [motivo, setMotivo] = useState<string>(MOTIVOS[0]);
  const [detalhe, setDetalhe] = useState('');
  const raf = useRef<number | null>(null);
  const inicio = useRef<number>(0);

  const carregar = useCallback(async () => {
    try { setDados(await api.get<MinhasMarcacoes>(`/marcacao/minhas?data=${hojeSP()}`)); }
    catch (e) { setErro((e as Error).message); }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  // Posição só no momento em que a tela é usada — nunca em segundo plano.
  useEffect(() => { void capturarPosicao().then(setGeo); }, []);

  const marcs = dados?.marcacoes ?? [];
  const esperadas = dados?.esperadas ?? 0;
  const proxima = rotuloProxima(marcs.length, esperadas);
  const excedente = esperadas > 0 && marcs.length >= esperadas;

  const posicao = geo?.estado === 'ok' ? geo.posicao : null;
  const { fora, distancia } = foraDoRaio(dados?.local ?? null, posicao);
  const semLocalizacao = geo != null && geo.estado !== 'ok';
  // Só pedimos contexto quando ele ajuda o RH. Empresa sem endereço nunca vê isso.
  const pedirObs = (fora || (semLocalizacao && !!dados?.local)) && !!dados?.local;

  async function bater() {
    setErro(null);
    setBatendo(true);
    try {
      const qtdAntes = marcs.length;
      const obs = pedirObs ? [motivo, detalhe.trim()].filter(Boolean).join(' — ') : undefined;
      const batida = await api.post<Batida>('/marcacao', {
        coletor: 2,
        latitude: posicao?.latitude, longitude: posicao?.longitude,
        observacao: obs,
      });
      setDetalhe('');
      setConfirmada({ batida, tipo: rotuloProxima(qtdAntes, esperadas), obs });
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
        {confirmada.obs && <div className={css.bateuObs}>Anotado: {confirmada.obs}. O RH vai ver.</div>}
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

      {/* Selo de localização: informa, nunca impede. */}
      {dados?.local && geo && (
        <div className={`${css.geo} ${fora ? css.geoFora : semLocalizacao ? css.geoSem : css.geoDentro}`}>
          <span className={css.geoPt} />
          {geo.estado === 'ok'
            ? fora
              ? `Fora do escritório · ${distancia != null ? formatarDistancia(distancia) : ''}`
              : 'No escritório'
            : geo.estado === 'negada' ? 'Sem localização' : 'Localização indisponível'}
        </div>
      )}

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

      {/* Fora do raio: pedimos contexto. O botão continua funcionando de qualquer jeito. */}
      {pedirObs && (
        <div className={css.obs}>
          <div className={css.obsTit}>Onde você está?</div>
          <p className={css.obsSub}>
            {geo?.estado === 'ok'
              ? 'Você está fora do endereço da empresa. Conta pro RH o motivo — leva 1 toque.'
              : 'Não consegui ver sua localização. Se quiser, conta onde você está — mas pode bater sem isso.'}
          </p>
          <div className={css.chips}>
            {MOTIVOS.map((m) => (
              <button
                key={m} type="button"
                className={`${css.chip} ${motivo === m ? css.chipOn : ''}`}
                onClick={() => setMotivo(m)}
              >{m}</button>
            ))}
          </div>
          <input
            className={css.obsIn} value={detalhe} maxLength={150}
            onChange={(e) => setDetalhe(e.target.value)}
            placeholder="Quer detalhar? (opcional)"
          />
        </div>
      )}

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
            <span>
              <span className={css.k}>{rotuloMarcacao(i, esperadas || marcs.length)}</span>
              {m.observacao && <span className={css.rowObs}>{m.observacao}</span>}
            </span>
            <span className={css.t}>{fmtHora(m.dtMarcacao)}</span>
          </div>
        ))}
      </div>

      <div className={css.espaco} />
      <Botao variante="ghost" onClick={() => navegar('/espelho')}>Ver espelho do dia</Botao>
    </div>
  );
}
