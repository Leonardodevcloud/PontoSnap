/**
 * Regra "compensa no mês e paga a diferença" (formaCalculo INTRA_MES).
 *
 * No fechamento de cada mês o saldo (o que veio devendo + o mês + lançamentos
 * avulsos) é acertado:
 *  - positivo → pago na folha como hora extra, e o banco zera;
 *  - negativo → descontado na folha (DESCONTA) ou passa para o mês seguinte (CARREGA).
 *
 * Funções puras, usadas pelo BancoService (fechamento) e pela apuração (prévia).
 */

export type NegativoMes = 'DESCONTA' | 'CARREGA';

/** Descrição fixa do saldo de abertura (migração de outro sistema). */
export const DESC_ABERTURA = 'Saldo importado do sistema anterior';
/** Sufixo das baixas de saldo de abertura, pra lista de lote saber o que já saiu. */
export const SUFIXO_BAIXA_ABERTURA = '(saldo de abertura)';

/** Movimento gerado pela apuração dos dias (o "lançado" do mês). */
export const ehDaApuracao = (m: { competencia?: string | null; tipo: string }): boolean =>
  m.competencia != null && (m.tipo === 'CREDITO' || m.tipo === 'DEBITO');

/** Movimento de acerto gerado pelo fechamento do mês (pagamento/desconto). */
export const ehAcertoDoMes = (m: { competencia?: string | null; tipo: string }): boolean =>
  m.competencia != null && !ehDaApuracao(m);

/** "2026-09" → "set/2026". */
export function rotuloComp(comp: string): string {
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const [a, m] = comp.split('-');
  return `${meses[Number(m) - 1] ?? m}/${a}`;
}

/** O que o fechamento faz com o saldo final do mês. */
export function acertoDoMes(totalMin: number, negativo: NegativoMes): { acertoMin: number; passaMin: number } {
  if (totalMin > 0) return { acertoMin: totalMin, passaMin: 0 };
  if (totalMin < 0) return negativo === 'DESCONTA' ? { acertoMin: totalMin, passaMin: 0 } : { acertoMin: 0, passaMin: totalMin };
  return { acertoMin: 0, passaMin: 0 };
}

/**
 * Primeiro dia da "janela" do banco que compensa no mês: o início do primeiro
 * mês fechado já com acerto. Antes disso (fechamentos antigos, sem acerto)
 * nada passava de um mês pro outro — então nada de lá entra na conta.
 * Sem nenhum mês com acerto, a janela é o próprio mês de referência.
 */
export function inicioJanela(compsComAcerto: string[], compReferencia: string): string {
  const anteriores = compsComAcerto.filter((c) => c < compReferencia).sort();
  return `${anteriores[0] ?? compReferencia}-01`;
}
