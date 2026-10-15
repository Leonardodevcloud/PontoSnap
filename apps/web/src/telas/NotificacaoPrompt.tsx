import { useEffect, useState } from 'react';
import { pushSuportado, estadoPermissao, temSubscriptionAtiva, ativarNotificacoes, sincronizarSubscription } from '../lib/push';
import css from './NotificacaoPrompt.module.css';

const CHAVE_DESCARTOU = 'pontosnap.push.descartou';

const TEXTO_PADRAO = {
  titulo: 'Quer receber lembretes de ponto?',
  descricao: 'A gente te avisa se você esquecer de bater o ponto, quando o RH aprovar seus ajustes, e mais. Você escolhe o que receber.',
};

export function NotificacaoPrompt({ titulo = TEXTO_PADRAO.titulo, descricao = TEXTO_PADRAO.descricao }: { titulo?: string; descricao?: string } = {}) {
  const [visivel, setVisivel] = useState(false);
  const [ativando, setAtivando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!pushSuportado()) return;
    // Já ativado neste aparelho: confirma com o servidor (em silêncio).
    void sincronizarSubscription();
    if (localStorage.getItem(CHAVE_DESCARTOU)) return;
    if (estadoPermissao() === 'denied') return;

    temSubscriptionAtiva().then((ativa) => {
      if (!ativa) setVisivel(true);
    });
  }, []);

  if (!visivel) return null;

  async function ativar() {
    setAtivando(true);
    setErro(null);
    const res = await ativarNotificacoes();
    setAtivando(false);
    if (res.ok) {
      setVisivel(false);
    } else {
      setErro(res.erro ?? 'Não foi possível ativar.');
    }
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
          <div className={css.tit}>{titulo}</div>
          <div className={css.desc}>{descricao}</div>
          {erro && <div className={css.erro}>{erro}</div>}
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
