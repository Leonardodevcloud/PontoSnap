import { REGRAS_CLT_PADRAO, type RegrasApuracao } from '@ponto/apuracao-clt';

export type ConfigExtra = { extraDiaUtilPct: number; extraDomingoFeriadoPct: number; extraLimiteDiarioMin: number };
export type ConfigTolerancia = { toleranciaDiariaMin: number; toleranciaPorMarcacaoMin: number;
  /** Supressão de intervalo até este limite não indeniza (Art. 71 §4º, de minimis). */
  toleranciaIntervaloMin?: number };
export type ConfigNoturno = { noturnoAdicionalPct: number; noturnoReduzida: boolean; noturnoInicioMin: number; noturnoFimMin: number };
export type ConfigJornada = { jornadaSemanalMin: number; interjornadaMinimaMin: number; intervaloMaior6hMin: number };
export type ConfigBanco = { bancoModo: 'HERDA' | 'ATIVO' | 'INATIVO'; bancoTipoAcordo: 'INDIVIDUAL' | 'COLETIVO' | null; bancoPrazoMeses: number | null; formaCalculo: 'BANCO_HORAS' | 'INTRA_MES';
  /** Só no INTRA_MES: mês que fecha devendo desconta na folha (padrão) ou passa pro seguinte. */
  negativoMes?: 'DESCONTA' | 'CARREGA';
  /**
   * Horas trabalhadas em domingo/feriado: BANCO (padrão, como as outras extras)
   * ou PAGA (vão para a folha com o adicional de domingo/feriado e não entram no
   * banco — quando a convenção manda pagar o feriado trabalhado).
   */
  domingoFeriado?: 'BANCO' | 'PAGA' };
/**
 * Tipo de jornada (perfil). CONTRATO_HORAS = sem horário fixo: vale só a carga
 * do dia da escala. Nulo = segue o que a escala diz (legado: escala "flexível").
 */
export type ConfigContrato = { tipoJornada: 'FIXO' | 'CONTRATO_HORAS' };
export type ConfigDestinacao = { destinacaoFaltas: 'DESCONTA' | 'BANCO' | 'ABONA'; destinacaoAtrasos: 'DESCONTA' | 'BANCO' | 'TOLERA' };

/** Os 6 itens já resolvidos (nulo = usa o padrão CLT daquele item). */
export interface ItensResolvidos {
  extra?: ConfigExtra | null;
  tolerancia?: ConfigTolerancia | null;
  noturno?: ConfigNoturno | null;
  jornada?: ConfigJornada | null;
  banco?: ConfigBanco | null;
  destinacao?: ConfigDestinacao | null;
  contrato?: ConfigContrato | null;
}

export const BANCO_CLT: ConfigBanco = { bancoModo: 'HERDA', bancoTipoAcordo: null, bancoPrazoMeses: null, formaCalculo: 'BANCO_HORAS' };
export const DESTINACAO_CLT: ConfigDestinacao = { destinacaoFaltas: 'DESCONTA', destinacaoAtrasos: 'BANCO' };

/**
 * A jornada do dia é flexível (contrato de horas)? Quem define é a ESCALA
 * (configurada junto com os dias e a carga). Perfis antigos que marcaram
 * "contrato de horas" continuam valendo (compatibilidade).
 */
export function jornadaFlexivel(it: ItensResolvidos, escala?: { flexivel?: boolean | null } | null): boolean {
  return !!escala?.flexivel || it.contrato?.tipoJornada === 'CONTRATO_HORAS';
}

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
    intervalo: {
      ...base.intervalo,
      faixas: it.jornada
        ? [{ acimaMin: 360, minimoMin: it.jornada.intervaloMaior6hMin }, { acimaMin: 240, minimoMin: 15 }]
        : base.intervalo.faixas,
      toleranciaMin: it.tolerancia?.toleranciaIntervaloMin ?? base.intervalo.toleranciaMin,
    },
    interjornadaMinimaMin: it.jornada?.interjornadaMinimaMin ?? base.interjornadaMinimaMin,
    jornadaSemanalMin: it.jornada?.jornadaSemanalMin ?? base.jornadaSemanalMin,
  };
}
