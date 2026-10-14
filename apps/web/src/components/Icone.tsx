/** Ícones de traço do menu e da central (24×24, herdam a cor do texto). */
export type NomeIcone =
  | 'inicio' | 'calendario' | 'caixa' | 'sol' | 'relogio' | 'dinheiro' | 'documento' | 'pessoas'
  | 'grade' | 'ajustes' | 'engrenagem' | 'sino' | 'busca' | 'mais' | 'alerta' | 'check' | 'lapis' | 'sair' | 'x' | 'seta';

const P: Record<NomeIcone, JSX.Element> = {
  inicio: <><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></>,
  calendario: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  caixa: <><path d="M4 13l2-8h12l2 8v6H4z" /><path d="M4 13h5l1 2h4l1-2h5" /></>,
  sol: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" /></>,
  relogio: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2M9 2h6" /></>,
  dinheiro: <><rect x="2" y="6" width="20" height="12" rx="3" /><circle cx="12" cy="12" r="2.5" /></>,
  documento: <><path d="M6 2h9l4 4v16H6z" /><path d="M14 2v5h5M9 13h7M9 17h5" /></>,
  pessoas: <><circle cx="9" cy="8" r="3.5" /><path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6" /><path d="M16 4.5a3.5 3.5 0 010 7M18 14c2.4.6 4 2.8 4 6" /></>,
  grade: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 10h18M9 10v10" /></>,
  ajustes: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
  sino: <><path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 004 0" /></>,
  engrenagem: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></>,
  busca: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>,
  mais: <><circle cx="5" cy="12" r="1.6" fill="currentColor" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><circle cx="19" cy="12" r="1.6" fill="currentColor" /></>,
  alerta: <><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.01" /></>,
  check: <path d="M5 12l5 5 9-10" />,
  lapis: <path d="M4 20h4L19 9l-4-4L4 16z" />,
  sair: <><path d="M15 4h4v16h-4" /><path d="M10 8l-4 4 4 4M6 12h10" /></>,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  seta: <path d="M9 6l6 6-6 6" />,
};

export function Icone({ nome, tamanho = 18, className }: { nome: NomeIcone; tamanho?: number; className?: string }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className}>
      {P[nome]}
    </svg>
  );
}
