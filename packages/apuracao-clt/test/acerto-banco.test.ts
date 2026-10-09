import { describe, it, expect } from 'vitest';
import { valorizarAcertoBanco, REGRAS_CLT_PADRAO, type ResultadoPeriodo } from '../src/index.js';

const periodo = (extras: Array<{ min: number; adicionalPct: number; motivo?: string }>, reflexoDsrMin = 0): ResultadoPeriodo => ({
  dias: [{ extras: extras.map((e) => ({ motivo: 'extra', ...e })) } as never],
  totalTrabalhadoMin: 0, totalContratadoMin: 0, totalExtrasMin: extras.reduce((s, e) => s + e.min, 0),
  extrasPorAdicional: {}, totalNoturnoLegalMin: 0, totalFaltaMin: 0, totalAtrasoMin: 0,
  saldoPeriodoMin: 0, bancoDeHorasMin: 0, reflexoDsrMin, dsrPerdidoSemanas: 0, diasComViolacao: [], diasPendentes: [],
});

describe('acerto do banco que compensa no mês, em R$ (hora de R$ 10,00)', () => {
  it('sobra paga pelo adicional mais alto primeiro', () => {
    // extras do mês: 1h a 100% (domingo) e 3h a 50%; sobrou 2h
    const v = valorizarAcertoBanco(periodo([{ min: 60, adicionalPct: 100 }, { min: 180, adicionalPct: 50 }]), 1000, 120, REGRAS_CLT_PADRAO);
    expect(v.porAdicionalMin).toEqual({ '100': 60, '50': 60 });
    expect(v.extrasCentavos).toBe(2000 + 1500);
    expect(v.descontoCentavos).toBe(0);
  });
  it('sobra maior que as extras do mês vai pelo adicional de dia útil', () => {
    const v = valorizarAcertoBanco(periodo([]), 1000, 90, REGRAS_CLT_PADRAO);
    expect(v.porAdicionalMin).toEqual({ '50': 90 });
    expect(v.extrasCentavos).toBe(2250);
  });
  it('indenização de intervalo não entra na conta da sobra', () => {
    const v = valorizarAcertoBanco(periodo([{ min: 60, adicionalPct: 50, motivo: 'indenização intervalo' }]), 1000, 60, REGRAS_CLT_PADRAO);
    expect(v.extrasCentavos).toBe(1500);
    expect(v.reflexoDsrCentavos).toBe(0);
  });
  it('reflexo no DSR proporcional à parte paga', () => {
    const v = valorizarAcertoBanco(periodo([{ min: 240, adicionalPct: 50 }], 60), 1000, 120, REGRAS_CLT_PADRAO);
    expect(v.reflexoDsrCentavos).toBe(500); // metade de 1h de reflexo
  });
  it('devendo é descontado pela hora, sem adicional', () => {
    const v = valorizarAcertoBanco(periodo([]), 1000, -90, REGRAS_CLT_PADRAO);
    expect(v.descontoCentavos).toBe(1500);
    expect(v.extrasCentavos).toBe(0);
  });
});
