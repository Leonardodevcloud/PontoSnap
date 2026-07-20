import { REGRAS_CLT_PADRAO, type RegrasApuracao } from '@ponto/apuracao-clt';

/** Campos da convenção que viram regra de apuração. Nulo = CLT pura. */
export type CctRegras = {
  extraDiaUtilPct: number;
  extraDomingoFeriadoPct: number;
  extraLimiteDiarioMin: number;
  toleranciaDiariaMin: number;
  toleranciaPorMarcacaoMin: number;
  noturnoAdicionalPct: number;
  noturnoReduzida: boolean;
  noturnoInicioMin: number;
  noturnoFimMin: number;
  jornadaSemanalMin: number;
  interjornadaMinimaMin: number;
  intervaloMaior6hMin: number;
} | null | undefined;

/**
 * Monta as regras de apuração de um funcionário a partir da convenção dele.
 * Sem convenção, cai na CLT pura. O que a convenção não define, herda da CLT.
 */
export function regrasDeCct(cct: CctRegras): RegrasApuracao {
  if (!cct) return REGRAS_CLT_PADRAO;
  return {
    ...REGRAS_CLT_PADRAO,
    toleranciaDiariaMin: cct.toleranciaDiariaMin,
    toleranciaPorMarcacaoMin: cct.toleranciaPorMarcacaoMin,
    noturno: {
      ...REGRAS_CLT_PADRAO.noturno,
      reduzida: cct.noturnoReduzida,
      inicioMin: cct.noturnoInicioMin,
      fimMin: cct.noturnoFimMin,
      adicionalPct: cct.noturnoAdicionalPct,
    },
    extra: {
      diaUtilPct: cct.extraDiaUtilPct,
      domingoFeriadoPct: cct.extraDomingoFeriadoPct,
      limiteDiarioMin: cct.extraLimiteDiarioMin,
    },
    intervalo: {
      ...REGRAS_CLT_PADRAO.intervalo,
      faixas: [{ acimaMin: 360, minimoMin: cct.intervaloMaior6hMin }, { acimaMin: 240, minimoMin: 15 }],
    },
    interjornadaMinimaMin: cct.interjornadaMinimaMin,
    jornadaSemanalMin: cct.jornadaSemanalMin,
  };
}
