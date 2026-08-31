import { useEffect, useState } from 'react';
import { pushSuportado, estadoPermissao, temSubscriptionAtiva, ativarNotificacoes } from '../lib/push';
import css from './NotificacaoPrompt.module.css';

const CHAVE_DESCARTOU = 'pontosnap.push.descartou';

/**
 * Prompt de ativação de notificações. Aparece uma vez pra quem nunca ativou
 * e nunca descartou. Mostra no rodapé, não como modal bloqueante.
 */
export function NotificacaoPrompt() {
  const [visivel, setVisivel] = useState(false);
  const [ativando, setAtivando] = useState(false);

  useEffect(() => {
    if (!pushSuportado()) return;
    if (localStorage.getItem(CHAVE_DESCARTOU)) return;
    if (estadoPermissao() === 'denied') return;

    temSubscriptionAtiva().then((ativa) => {
      if (!ativa) setVisivel(true);
    });
  }, []);

  if (!visivel) return null;

  async function ativar() {
    setAtivando(true);
    const ok = await ativarNotificacoes();
    setAtivando(false);
    if (ok) setVisivel(false);
  }

  function descartar() {
    localStorage.setItem(CHAVE_DESCARTOU, '1');
    setVisivel(false);
  }

  return (
    <div className={css.wrap}>
      <div className={css.card}>
        <div className={css.ico}>🔔</div>
        <div className={css.corpo}>
          <div className={css.tit}>Quer receber lembretes de ponto?</div>
          <div className={css.desc}>
            A gente te avisa se você esquecer de bater o ponto, quando o RH aprovar seus ajustes, e mais. Você escolhe o que receber.
          </div>
          <div className={css.acoes}>
            <button className={css.btn} onClick={ativar} disabled={ativando}>
              {ativando ? 'Ativando…' : 'Ativar notificações'}
            </button>
            <button className={css.skip} onClick={descartar}>Agora não</button>
          </div>
        </div>
      </div>
    </div>
  );
}
