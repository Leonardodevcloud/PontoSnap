/**
 * Banco de horas — contabilidade de crédito com prazo.
 *
 * A CLT não deixa o saldo positivo viver para sempre: o que não for compensado
 * dentro do prazo do acordo VIRA HORA EXTRA E DEVE SER PAGO em dinheiro, com
 * adicional (Art. 59). Por isso cada crédito é um lote com vencimento próprio,
 * e a compensação consome sempre o lote MAIS VELHO primeiro (FIFO) — é o que
 * dá mais chance de a hora ser gozada antes de expirar.
 *
 * Prazos (base CLT — acordo coletivo prevalece):
 *  - acordo individual escrito: 6 meses
 *  - convenção/acordo coletivo: 12 meses
 */

export type TipoMovBanco =
  | 'CREDITO'    // hora extra que entrou no banco
  | 'DEBITO'     // folga/compensação que consumiu o banco
  | 'PAGAMENTO'  // saldo quitado em dinheiro (inclusive vencido)
  | 'AJUSTE';    // correção manual do RH, sempre justificada

export interface MovimentoBanco {
  data: string;          // YYYY-MM-DD
  minutos: number;       // > 0 credita | < 0 debita
  tipo: TipoMovBanco;
  descricao?: string;
}

export interface LoteBanco {
  /** Dia em que o crédito nasceu. */
  data: string;
  minutosRestantes: number;
  venceEm: string;
  vencido: boolean;
}

export interface SaldoBanco {
  /** Saldo líquido: crédito vivo menos o que o empregado deve. */
  saldoMin: number;
  creditadoMin: number;
  compensadoMin: number;
  pagoMin: number;
  /** O empregado deve estas horas (compensou mais do que tinha). */
  devedorMin: number;
  /** Já passou do prazo: a empresa PRECISA pagar como extra. */
  vencidoMin: number;
  /** Vence nos próximos 30 dias — hora de avisar. */
  aVencerMin: number;
  proximoVencimento: string | null;
  lotes: LoteBanco[];
}

/** Soma meses a uma data YYYY-MM-DD, respeitando fim de mês (31/01 + 1 = 28/02). */
export function somarMeses(dataStr: string, meses: number): string {
  const p = dataStr.split('-').map(Number);
  const a = p[0] ?? 1970, m = p[1] ?? 1, d = p[2] ?? 1;
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  const dia = Math.min(d, ultimoDia);
  return `${alvo.getUTCFullYear()}-${String(alvo.getUTCMonth() + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

const diasEntre = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/**
 * Fecha o saldo do banco a partir do extrato.
 *
 * @param movimentos extrato completo, em qualquer ordem
 * @param prazoMeses prazo do acordo (6 individual, 12 coletivo)
 * @param hoje       data de referência YYYY-MM-DD
 */
export function calcularBanco(
  movimentos: MovimentoBanco[], prazoMeses: number, hoje: string,
): SaldoBanco {
  const ordem = [...movimentos].sort((x, y) => x.data.localeCompare(y.data));

  const lotes: LoteBanco[] = [];
  let creditadoMin = 0, compensadoMin = 0, pagoMin = 0, devedorMin = 0;

  /** Consome dos lotes mais velhos. Devolve o que não coube em lote nenhum. */
  function consumir(minutos: number): number {
    let falta = minutos;
    for (const lote of lotes) {
      if (falta <= 0) break;
      const tira = Math.min(lote.minutosRestantes, falta);
      lote.minutosRestantes -= tira;
      falta -= tira;
    }
    return falta;
  }

  for (const mov of ordem) {
    if (mov.minutos > 0) {
      // AJUSTE positivo também vira lote: crédito é crédito, e vence igual.
      creditadoMin += mov.minutos;
      // Primeiro abate o que o empregado devia — não faz sentido guardar
      // crédito com prazo enquanto existe débito em aberto.
      const abate = Math.min(devedorMin, mov.minutos);
      devedorMin -= abate;
      const sobra = mov.minutos - abate;
      if (sobra > 0) {
        lotes.push({
          data: mov.data,
          minutosRestantes: sobra,
          venceEm: somarMeses(mov.data, prazoMeses),
          vencido: false,
        });
      }
    } else if (mov.minutos < 0) {
      const querTirar = -mov.minutos;
      if (mov.tipo === 'PAGAMENTO') pagoMin += querTirar;
      else compensadoMin += querTirar;
      const sobrou = consumir(querTirar);
      // Compensou mais do que tinha: vira dívida do empregado.
      if (sobrou > 0) devedorMin += sobrou;
    }
  }

  const vivos = lotes.filter((l) => l.minutosRestantes > 0);
  for (const l of vivos) l.vencido = l.venceEm < hoje;

  const vencidoMin = vivos.filter((l) => l.vencido).reduce((s, l) => s + l.minutosRestantes, 0);
  const aVencerMin = vivos
    .filter((l) => !l.vencido && diasEntre(hoje, l.venceEm) <= 30)
    .reduce((s, l) => s + l.minutosRestantes, 0);
  const proximo = vivos.filter((l) => !l.vencido).sort((a, b) => a.venceEm.localeCompare(b.venceEm))[0];

  return {
    saldoMin: vivos.reduce((s, l) => s + l.minutosRestantes, 0) - devedorMin,
    creditadoMin, compensadoMin, pagoMin, devedorMin, vencidoMin, aVencerMin,
    proximoVencimento: proximo?.venceEm ?? null,
    lotes: vivos,
  };
}
