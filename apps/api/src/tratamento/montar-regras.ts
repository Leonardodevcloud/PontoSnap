import { REGRAS_CLT_PADRAO, type RegrasApuracao } from '@ponto/apuracao-clt';

export type ConfigExtra = { extraDiaUtilPct: number; extraDomingoFeriadoPct: number; extraLimiteDiarioMin: number };
export type ConfigTolerancia = { toleranciaDiariaMin: number; toleranciaPorMarcacaoMin: number };
export type ConfigNoturno = { noturnoAdicionalPct: number; noturnoReduzida: boolean; noturnoInicioMin: number; noturnoFimMin: number };
export type ConfigJornada = { jornadaSemanalMin: number; interjornadaMinimaMin: number; intervaloMaior6hMin: number };
export type ConfigBanco = { bancoModo: 'HERDA' | 'ATIVO' | 'INATIVO'; bancoTipoAcordo: 'INDIVIDUAL' | 'COLETIVO' | null; bancoPrazoMeses: number | null; formaCalculo: 'BANCO_HORAS' | 'INTRA_MES' };
export type ConfigDestinacao = { destinacaoFaltas: 'DESCONTA' | 'BANCO' | 'ABONA'; destinacaoAtrasos: 'DESCONTA' | 'BANCO' | 'TOLERA' };

/** Os 6 itens já resolvidos (nulo = usa o padrão CLT daquele item). */
export interface ItensResolvidos {
  extra?: ConfigExtra | null;
  tolerancia?: ConfigTolerancia | null;
  noturno?: ConfigNoturno | null;
  jornada?: ConfigJornada | null;
  banco?: ConfigBanco | null;
  destinacao?: ConfigDestinacao | null;
}

export const BANCO_CLT: ConfigBanco = { bancoModo: 'HERDA', bancoTipoAcordo: null, bancoPrazoMeses: null, formaCalculo: 'BANCO_HORAS' };
export const DESTINACAO_CLT: ConfigDestinacao = { destinacaoFaltas: 'DESCONTA', destinacaoAtrasos: 'BANCO' };

/** Monta as regras de apuração combinando as peças escolhidas (o que faltar, CLT). */
export function montarRegrasApuracao(it: ItensResolvidos): RegrasApuracao {
  const base = REGRAS_CLT_PADRAO;
  return {
    ...base,
    toleranciaDiariaMin: it.tolerancia?.toleranciaDiariaMin ?? base.toleranciaDiariaMin,
    toleranciaPorMarcacaoMin: it.tolerancia?.toleranciaPorMarcacaoMin ?? base.toleranciaPorMarcacaoMin,
    noturno: it.noturno
      ? { ...base.noturno, reduzida: it.noturno.noturnoReduzida, inicioMin: it.noturno.noturnoInicioMin, fimMin: it.noturno.noturnoFimMin, adicionalPct: it.noturno.noturnoAdicionalPct }
      : base.noturno,
    extra: it.extra
      ? { diaUtilPct: it.extra.extraDiaUtilPct, domingoFeriadoPct: it.extra.extraDomingoFeriadoPct, limiteDiarioMin: it.extra.extraLimiteDiarioMin }
      : base.extra,
    intervalo: it.jornada
      ? { ...base.intervalo, faixas: [{ acimaMin: 360, minimoMin: it.jornada.intervaloMaior6hMin }, { acimaMin: 240, minimoMin: 15 }] }
      : base.intervalo,
    interjornadaMinimaMin: it.jornada?.interjornadaMinimaMin ?? base.interjornadaMinimaMin,
    jornadaSemanalMin: it.jornada?.jornadaSemanalMin ?? base.jornadaSemanalMin,
  };
}
