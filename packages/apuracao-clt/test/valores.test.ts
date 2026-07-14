import { describe, it, expect } from 'vitest';
import { valorizarPeriodo, REGRAS_CLT_PADRAO, type ResultadoPeriodo } from '../src/index.js';

const periodoBase = (over: Partial<ResultadoPeriodo> = {}): ResultadoPeriodo => ({
  dias: [], totalTrabalhadoMin: 0, totalContratadoMin: 0, totalExtrasMin: 0,
  extrasPorAdicional: {}, totalNoturnoLegalMin: 0, totalFaltaMin: 0, totalAtrasoMin: 0,
  saldoPeriodoMin: 0, bancoDeHorasMin: 0, reflexoDsrMin: 0, dsrPerdidoSemanas: 0, diasComViolacao: [], ...over,
});

describe('valorização em R$', () => {
  // salário R$ 2.200,00 / 220h = R$ 10,00/hora = 1000 centavos
  const p = { salarioMensalCentavos: 220000, horasMensaisFolha: 220 };

  it('valor-hora é salário / divisor', () => {
    const v = valorizarPeriodo(periodoBase(), p, REGRAS_CLT_PADRAO);
    expect(v.valorHoraCentavos).toBe(1000);
  });

  it('1h extra a 50% vale a hora + 50%', () => {
    const v = valorizarPeriodo(periodoBase({ extrasPorAdicional: { '50': 60 } }), p, REGRAS_CLT_PADRAO);
    expect(v.extrasCentavos).toBe(1500); // R$ 15,00
  });

  it('adicional noturno é 20% sobre as horas noturnas legais', () => {
    const v = valorizarPeriodo(periodoBase({ totalNoturnoLegalMin: 60 }), p, REGRAS_CLT_PADRAO);
    expect(v.adicionalNoturnoCentavos).toBe(200); // 20% de R$ 10,00
  });

  it('falta desconta a hora cheia', () => {
    const v = valorizarPeriodo(periodoBase({ totalFaltaMin: 480 }), p, REGRAS_CLT_PADRAO);
    expect(v.descontoFaltasCentavos).toBe(8000); // 8h × R$ 10,00
  });

  it('DSR perdido desconta um dia de salário por semana', () => {
    const v = valorizarPeriodo(periodoBase({ dsrPerdidoSemanas: 1 }), p, REGRAS_CLT_PADRAO);
    expect(v.descontoDsrPerdidoCentavos).toBe(Math.round(220000 / 30)); // 1 dia
  });
});
