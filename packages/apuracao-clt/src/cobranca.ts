/**
 * Cálculo do valor de uma mensalidade e do vencimento.
 *
 * Função pura: recebe o que a assinatura resolve (modo + valor, já com
 * override aplicado) e a contagem de funcionários, devolve o valor a cobrar.
 * Isolar isto do banco deixa a regra de preço testável e auditável — numa
 * cobrança, "por que esse valor?" tem que ter resposta exata.
 */

export type ModoCobranca = 'FIXO' | 'POR_FUNCIONARIO';

export interface BaseCobranca {
  modo: ModoCobranca;
  /** FIXO: mensalidade cheia. POR_FUNCIONARIO: preço por funcionário ativo. */
  valor: number;
}

/**
 * Valor da mensalidade.
 * - FIXO: o próprio valor, independente de quantos funcionários.
 * - POR_FUNCIONARIO: valor × funcionários ativos (mínimo de 1 para não zerar
 *   uma empresa que ficou temporariamente sem ativos num vira-mês).
 */
export function calcularMensalidade(base: BaseCobranca, qtdFuncionarios: number): number {
  if (base.modo === 'FIXO') return arredondar(base.valor);
  const qtd = Math.max(1, qtdFuncionarios);
  return arredondar(base.valor * qtd);
}

/** Duas casas, sem os erros de ponto flutuante que geram R$ 320,0000001. */
function arredondar(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/**
 * Data de vencimento de uma competência.
 *
 * @param competencia  'AAAA-MM'
 * @param diaVencimento 1–28 (limitado a 28 para existir em fevereiro também)
 * @returns 'AAAA-MM-DD'
 */
export function vencimentoDaCompetencia(competencia: string, diaVencimento: number): string {
  const [ano, mes] = competencia.split('-');
  const dia = Math.min(Math.max(diaVencimento, 1), 28);
  return `${ano}-${mes}-${String(dia).padStart(2, '0')}`;
}

/**
 * Resolve modo e valor efetivos de uma assinatura, aplicando os overrides.
 * Override vazio herda do plano; override preenchido manda. Sem plano e sem
 * override é um erro de configuração (a assinatura não sabe cobrar).
 */
export function resolverBase(
  plano: { modo: ModoCobranca; valor: number } | null,
  override: { modo?: ModoCobranca | null; valor?: number | null },
): BaseCobranca {
  const modo = override.modo ?? plano?.modo;
  const valor = override.valor ?? plano?.valor;
  if (!modo || valor == null) {
    throw new Error('Assinatura sem plano nem valor definido');
  }
  return { modo, valor };
}

/** Uma cobrança está atrasada se passou do vencimento e não foi paga. */
export function estaAtrasada(vencimento: string, status: string, hoje: Date = new Date()): boolean {
  if (status === 'PAGA' || status === 'CANCELADA') return false;
  const venc = new Date(`${vencimento}T23:59:59-0300`);
  return hoje > venc;
}

/** Dias de atraso (0 se em dia). Para o aviso "atrasada há X dias". */
export function diasDeAtraso(vencimento: string, hoje: Date = new Date()): number {
  const venc = new Date(`${vencimento}T23:59:59-0300`);
  if (hoje <= venc) return 0;
  return Math.floor((hoje.getTime() - venc.getTime()) / 86_400_000);
}
