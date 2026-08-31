import { useCallback, useEffect, useState } from 'react';

type Tema = 'light' | 'dark';
const CHAVE = 'pontosnap.tema';

function aplicar(tema: Tema) {
  document.documentElement.setAttribute('data-theme', tema);
}

/** Lê o tema salvo ou retorna 'light' como padrão. */
function lerTema(): Tema {
  const salvo = localStorage.getItem(CHAVE);
  if (salvo === 'dark') return 'dark';
  return 'light';
}

export function useTema() {
  const [tema, setTemaState] = useState<Tema>(lerTema);

  useEffect(() => { aplicar(tema); }, [tema]);

  const alternar = useCallback(() => {
    const novo: Tema = tema === 'light' ? 'dark' : 'light';
    localStorage.setItem(CHAVE, novo);
    setTemaState(novo);
  }, [tema]);

  return { tema, alternar };
}
