import { describe, it, expect } from 'vitest';
import { valorizarPeriodo, REGRAS_CLT_PADRAO, type ResultadoPeriodo } from '../src/index.js';

const periodoBase = (over: Partial<ResultadoPeriodo> = {}): ResultadoPeriodo => ({
  dias: [], totalTrabalhadoMin: 0, totalContratadoMin: 0, totalExtrasMin: 0,
  extrasPorAdicional: {}, totalNoturnoLegalMin: 0, totalFaltaMin: 0, totalAtrasoMin: 0,
  saldoPeriodoMin: 0, bancoDeHorasMin: 0, reflexoDsrMin: 0, dsrPerdidoSemanas: 0, diasComViolacao: [], diasPendentes: [], ...over,
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

  it('com banco ativo, a extra comum não é paga (vai pro banco); indenização é', () => {
    const dia = (extras: Array<{ min: number; adicionalPct: number; motivo: string }>) => ({
      data: '2026-07-13', marcacoes: [], minutosTrabalhados: 0, minutosContratados: 0, minutosNoturnosReais: 0,
      minutosNoturnosLegais: 0, extras, extrasTotalMin: extras.reduce((a, e) => a + e.min, 0), faltaMin: 0,
      faltaInjustificada: false, ehDescansoDia: false, atrasoMin: 0, saldoMin: 0, intervaloGozadoMin: 0,
      penalidadeIntervaloMin: 0, penalidadeInterjornadaMin: 0, violacaoInterjornada: false, paresIncompletos: false,
      pendente: false, observacoes: [],
    });
    const r = periodoBase({
      dias: [dia([{ min: 60, adicionalPct: 50, motivo: 'hora extra' }, { min: 30, adicionalPct: 50, motivo: 'indenização de intervalo' }])],
      totalExtrasMin: 90, extrasPorAdicional: { '50': 90 },
    });
    const semBanco = valorizarPeriodo(r, p, REGRAS_CLT_PADRAO);
    const comBanco = valorizarPeriodo(r, p, REGRAS_CLT_PADRAO, { extrasNoBanco: true });
    expect(semBanco.extrasCentavos).toBe(2250); // 1,5h × R$10 × 1,5
    expect(comBanco.extrasCentavos).toBe(750);  // só os 30min de indenização
    expect(comBanco.extrasNoBancoMin).toBe(60);
  });

  it('falta/atraso com destinação banco não viram desconto em R$', () => {
    const r = periodoBase({ totalFaltaMin: 480, totalAtrasoMin: 60, dsrPerdidoSemanas: 1 });
    const v = valorizarPeriodo(r, p, REGRAS_CLT_PADRAO, { descontaFaltas: false, descontaAtrasos: false });
    expect(v.descontoFaltasCentavos).toBe(0);
    expect(v.descontoAtrasosCentavos).toBe(0);
    expect(v.descontoDsrPerdidoCentavos).toBe(0);
  });
});
