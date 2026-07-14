import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { fmtDataCurta, fmtHora, hojeSP, rotuloPorIndice } from '../lib/formato';
import type { Batida, MinhasMarcacoes } from '../tipos';
import { Flash } from '../components/Flash';
import { Botao } from '../components/Botao';
import css from './BaterPonto.module.css';

export function BaterPonto() {
  const navegar = useNavigate();
  const [dados, setDados] = useState<MinhasMarcacoes | null>(null);
  const [batendo, setBatendo] = useState(false);
  const [confirmada, setConfirmada] = useState<{ batida: Batida; tipo: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try { setDados(await api.get<MinhasMarcacoes>(`/marcacao/minhas?data=${hojeSP()}`)); }
    catch (e) { setErro((e as Error).message); }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  async function bater() {
    setErro(null);
    setBatendo(true);
    try {
      const qtdAntes = dados?.marcacoes.length ?? 0;
      const batida = await api.post<Batida>('/marcacao', { coletor: 2 });
      setConfirmada({ batida, tipo: rotuloPorIndice(qtdAntes) });
      void carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setBatendo(false);
    }
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
  const marcs = dados?.marcacoes ?? [];

  return (
    <div className="appshell">
      <div className={css.oi}>Oi{primeiroNome ? `, ${primeiroNome}` : ''}</div>
      <div className={css.hoje}>
        {fmtDataCurta()}
        {marcs.length > 0 && ` · você entrou às ${fmtHora(marcs[0].dtMarcacao)}`}
      </div>

      <button className={css.snapbtn} onClick={bater} disabled={batendo}>
        <span className={css.big}>{batendo ? 'Batendo…' : <>Bater<br />ponto</>}</span>
        {!batendo && <span className={css.sm}>toque pra registrar</span>}
      </button>

      {erro && <p className={css.erro}>{erro}</p>}

      <div className={css.sofar}>
        <div className={css.h}>Hoje</div>
        {marcs.length === 0 && <div className={css.vazio}>Nada por aqui ainda. Bate o primeiro ponto do dia?</div>}
        {marcs.map((m, i) => (
          <div key={m.nsr} className={css.row}>
            <span className={css.k}>{rotuloPorIndice(i)}</span>
            <span className={css.t}>{fmtHora(m.dtMarcacao)}</span>
          </div>
        ))}
      </div>

      <div className={css.espaco} />
      <Botao variante="ghost" onClick={() => navegar('/espelho')}>Ver espelho do dia</Botao>
    </div>
  );
}
