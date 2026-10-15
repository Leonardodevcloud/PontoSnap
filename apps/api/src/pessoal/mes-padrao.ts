/**
 * Qual mês as telas de fechamento abrem por padrão.
 *
 * O fechamento de um mês acontece nos primeiros dias do mês seguinte (o RH
 * fecha outubro entre 1 e 5 de novembro). Nesses dias, abrir no mês corrente
 * mostraria uma página vazia. Então: até o dia DIA_LIMITE_FECHAMENTO, se o mês
 * anterior ainda não foi fechado, ele é o padrão; depois disso (ou se já fechou),
 * vale o mês corrente.
 */
export const DIA_LIMITE_FECHAMENTO = 10;

export interface MesPadrao {
  /** YYYY-MM que a tela deve abrir. */
  competencia: string;
  /** true = é o mês anterior, ainda em fechamento. */
  emFechamento: boolean;
  hoje: string;
}

export function compAnterior(comp: string): string {
  const [a, m] = comp.split('-').map(Number) as [number, number];
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
}

/** hoje = YYYY-MM-DD no fuso da empresa. */
export function mesPadrao(hoje: string, anteriorFechado: boolean): MesPadrao {
  const atual = hoje.slice(0, 7);
  const dia = Number(hoje.slice(8, 10));
  if (dia <= DIA_LIMITE_FECHAMENTO && !anteriorFechado) return { competencia: compAnterior(atual), emFechamento: true, hoje };
  return { competencia: atual, emFechamento: false, hoje };
}
