import type { RegrasApuracao } from './tipos.js';

/**
 * Regras-base da CLT (sem acordo coletivo específico). Serve de ponto de
 * partida; cada cliente/categoria sobrescreve o que a CCT/ACT determinar.
 */
export const REGRAS_CLT_PADRAO: RegrasApuracao = {
  toleranciaDiariaMin: 10,
  toleranciaPorMarcacaoMin: 5,
  noturno: { reduzida: true, inicioMin: 22 * 60, fimMin: 5 * 60, adicionalPct: 20, prorrogacao: true },
  extra: { diaUtilPct: 50, domingoFeriadoPct: 100, limiteDiarioMin: 120 },
  intervalo: { penalidade: true, faixas: [{ acimaMin: 360, minimoMin: 60 }, { acimaMin: 240, minimoMin: 15 }] },
  interjornadaMinimaMin: 11 * 60,
  bancoDeHoras: false,
  compensarAtrasoComExtra: true,
  jornadaSemanalMin: 44 * 60,
};
