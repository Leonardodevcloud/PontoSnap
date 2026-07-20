/** Rascunho que a IA devolve pro RH conferir (nunca salvo direto). */
export type ExtracaoCct = {
  valores: {
    nome?: string; uf?: string | null; vigencia?: string | null;
    extraDiaUtilPct?: number; extraDomingoFeriadoPct?: number;
    toleranciaDiariaMin?: number; toleranciaPorMarcacaoMin?: number;
    noturnoAdicionalPct?: number; jornadaSemanalMin?: number;
    interjornadaMinimaMin?: number; intervaloMaior6hMin?: number;
    bancoPrazoMeses?: number | null;
  };
  citacoes: { campo: string; texto: string }[];
};

const num = (v: unknown, min: number, max: number): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, Math.round(n)));
};
const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

/**
 * Converte a resposta crua do Gemini num rascunho seguro: aplica limites,
 * ignora lixo e mantém só citações bem formadas. É uma função pura de propósito
 * — dá pra testar sem chamar a IA.
 */
export function mapearGeminiParaCct(bruto: unknown): ExtracaoCct {
  const o = (bruto ?? {}) as Record<string, unknown>;
  const valores: ExtracaoCct['valores'] = {};

  const nome = str(o.nome, 120); if (nome) valores.nome = nome;
  const uf = str(o.uf, 2); if (uf) valores.uf = uf.toUpperCase();
  const vig = str(o.vigencia, 60); if (vig) valores.vigencia = vig;

  const set = (k: keyof ExtracaoCct['valores'], v: number | undefined) => {
    if (v !== undefined) (valores as Record<string, unknown>)[k] = v;
  };
  set('extraDiaUtilPct', num(o.extraDiaUtilPct, 0, 300));
  set('extraDomingoFeriadoPct', num(o.extraDomingoFeriadoPct, 0, 300));
  set('toleranciaDiariaMin', num(o.toleranciaDiariaMin, 0, 120));
  set('toleranciaPorMarcacaoMin', num(o.toleranciaPorMarcacaoMin, 0, 60));
  set('noturnoAdicionalPct', num(o.noturnoAdicionalPct, 0, 200));
  set('jornadaSemanalMin', num(o.jornadaSemanalMin, 0, 60 * 60));
  set('interjornadaMinimaMin', num(o.interjornadaMinimaMin, 0, 24 * 60));
  set('intervaloMaior6hMin', num(o.intervaloMaior6hMin, 0, 24 * 60));
  const banco = num(o.bancoPrazoMeses, 1, 12);
  if (banco !== undefined) valores.bancoPrazoMeses = banco;

  const citacoes: ExtracaoCct['citacoes'] = [];
  if (Array.isArray(o.citacoes)) {
    for (const c of o.citacoes) {
      const campo = str((c as Record<string, unknown>)?.campo, 60);
      const texto = str((c as Record<string, unknown>)?.texto, 300);
      if (campo && texto) citacoes.push({ campo, texto });
    }
  }
  return { valores, citacoes };
}
