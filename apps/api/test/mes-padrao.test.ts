import { describe, expect, it } from 'vitest';
import { mesPadrao, compAnterior } from '../src/pessoal/mes-padrao';

describe('mesPadrao — em qual mês as telas de fechamento abrem', () => {
  it('começo do mês com o anterior aberto → anterior (em fechamento)', () => {
    expect(mesPadrao('2026-11-03', false)).toEqual({ competencia: '2026-10', emFechamento: true, hoje: '2026-11-03' });
  });
  it('dia 10 ainda conta como fechamento', () => {
    expect(mesPadrao('2026-11-10', false).competencia).toBe('2026-10');
  });
  it('depois do dia 10 → mês corrente, mesmo com o anterior aberto', () => {
    expect(mesPadrao('2026-10-15', false)).toMatchObject({ competencia: '2026-10', emFechamento: false });
  });
  it('anterior já fechado → mês corrente', () => {
    expect(mesPadrao('2026-11-02', true).competencia).toBe('2026-11');
  });
  it('virada de ano', () => {
    expect(mesPadrao('2027-01-04', false).competencia).toBe('2026-12');
    expect(compAnterior('2027-01')).toBe('2026-12');
  });
});
