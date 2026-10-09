import { describe, it, expect } from 'vitest';
import { acertoDoMes, inicioJanela, rotuloComp, ehDaApuracao, ehAcertoDoMes } from '../src/banco/acerto-mes';

describe('acerto do banco que compensa no mês', () => {
  it('sobra positiva é paga e não passa', () => {
    expect(acertoDoMes(300, 'DESCONTA')).toEqual({ acertoMin: 300, passaMin: 0 });
    expect(acertoDoMes(300, 'CARREGA')).toEqual({ acertoMin: 300, passaMin: 0 });
  });
  it('devendo: desconta ou passa conforme a regra', () => {
    expect(acertoDoMes(-90, 'DESCONTA')).toEqual({ acertoMin: -90, passaMin: 0 });
    expect(acertoDoMes(-90, 'CARREGA')).toEqual({ acertoMin: 0, passaMin: -90 });
    expect(acertoDoMes(0, 'CARREGA')).toEqual({ acertoMin: 0, passaMin: 0 });
  });
  it('janela começa no primeiro mês fechado com acerto anterior à referência', () => {
    expect(inicioJanela([], '2026-10')).toBe('2026-10-01');
    expect(inicioJanela(['2026-09', '2026-08'], '2026-10')).toBe('2026-08-01');
    expect(inicioJanela(['2026-10', '2026-11'], '2026-10')).toBe('2026-10-01');
  });
  it('rótulo e classificação de movimentos', () => {
    expect(rotuloComp('2026-09')).toBe('set/2026');
    expect(ehDaApuracao({ competencia: '2026-09', tipo: 'CREDITO' })).toBe(true);
    expect(ehDaApuracao({ competencia: '2026-09', tipo: 'PAGAMENTO' })).toBe(false);
    expect(ehAcertoDoMes({ competencia: '2026-09', tipo: 'PAGAMENTO' })).toBe(true);
    expect(ehAcertoDoMes({ competencia: null, tipo: 'PAGAMENTO' })).toBe(false);
  });
});
