import { useEffect, useState } from 'react';
import { Flash } from './Flash';
import css from './PromptInstalar.module.css';

/** O evento que o Chrome/Edge disparam quando o app é instalável. */
interface PromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const CHAVE_DISPENSADO = 'pontosnap.instalar-dispensado';

/** Já está rodando como app instalado? Então não oferece instalar. */
function estaInstalado(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

/** Safari no iPhone/iPad — que não tem instalação programática (só manual). */
function ehIOSSafari(): boolean {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
}

/**
 * Banner de instalação do PWA. No Android/desktop usa o prompt nativo do
 * navegador; no iPhone mostra o passo a passo (o iOS não deixa instalar por
 * botão). É dispensável e não volta a incomodar depois de fechado.
 */
export function PromptInstalar() {
  const [evento, setEvento] = useState<PromptEvent | null>(null);
  const [visivel, setVisivel] = useState(false);
  const [iosDica, setIosDica] = useState(false);

  useEffect(() => {
    if (estaInstalado() || localStorage.getItem(CHAVE_DISPENSADO)) return;

    if (ehIOSSafari()) { setIosDica(true); setVisivel(true); return; }

    const aoPrompt = (e: Event) => {
      e.preventDefault();               // impede o mini-banner padrão do Chrome
      setEvento(e as PromptEvent);
      setVisivel(true);
    };
    const aoInstalar = () => { setVisivel(false); localStorage.setItem(CHAVE_DISPENSADO, '1'); };
    window.addEventListener('beforeinstallprompt', aoPrompt);
    window.addEventListener('appinstalled', aoInstalar);
    return () => {
      window.removeEventListener('beforeinstallprompt', aoPrompt);
      window.removeEventListener('appinstalled', aoInstalar);
    };
  }, []);

  function dispensar() {
    setVisivel(false);
    localStorage.setItem(CHAVE_DISPENSADO, '1');
  }

  async function instalar() {
    if (!evento) return;
    await evento.prompt();
    await evento.userChoice;
    setEvento(null);
    setVisivel(false);
  }

  if (!visivel) return null;

  return (
    <div className={css.banner}>
      <Flash tamanho={22} cor="var(--coral)" />
      <div className={css.txt}>
        {iosDica
          ? <>Instale o PontoSnap: toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.</>
          : <>
              Instale o PontoSnap no seu celular — bater ponto fica a um toque.
              <span className={css.nota}>Se o Android mostrar um aviso, é normal: toque em <b>Instalar mesmo assim</b>.</span>
            </>}
      </div>
      {!iosDica && <button className={css.instalar} onClick={instalar}>Instalar</button>}
      <button className={css.fechar} onClick={dispensar} aria-label="Dispensar">×</button>
    </div>
  );
}
