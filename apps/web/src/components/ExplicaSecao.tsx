import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Explica } from './Explica';

/**
 * "?" da tela que mora numa seção com abas (Ponto do mês, Pedidos, Relatórios):
 * vai para a linha das abas, ao lado do título. Sem a barra de abas, fica onde está.
 */
export function ExplicaSecao({ children }: { children: ReactNode }) {
  const [alvo, setAlvo] = useState<HTMLElement | null>(null);
  useEffect(() => { setAlvo(document.getElementById('explica-secao')); }, []);
  const el = <Explica>{children}</Explica>;
  return alvo ? createPortal(el, alvo) : el;
}
