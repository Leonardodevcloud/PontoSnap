import { describe, it, expect } from 'vitest';
import { alternarDia, corpoDias, datasIniciais, diasPrevistos, listaDatas, type SemanaDias } from '../src/lib/diasMotorista';

// Semana 26/10 (seg) a 31/10 (sáb) de 2026 — recortada no mês, como vem da API.
const POSS = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'];
const sem = (x: Partial<SemanaDias> = {}): SemanaDias => ({ inicio: '2026-10-26', diasAuto: 6, dias: 6, diasPossiveis: POSS, diasDatas: null, feriados: [], ...x });

describe('dias previstos', () => {
  it('seg–sáb: 6; seg–sex: 5; feriado da cidade sai', () => {
    expect(diasPrevistos(sem(), 'SEG_SAB')).toHaveLength(6);
    expect(diasPrevistos(sem(), 'SEG_SEX')).toEqual(POSS.slice(0, 5));
    expect(diasPrevistos(sem({ feriados: ['2026-10-28'] }), 'SEG_SAB')).not.toContain('2026-10-28');
  });
  it('domingo nunca é previsto', () => {
    expect(diasPrevistos(sem({ diasPossiveis: [...POSS, '2026-11-01'] }), 'SEG_SAB')).not.toContain('2026-11-01');
  });
});

describe('chips batem com a quantidade', () => {
  it('sem ajuste: os 6 previstos aparecem marcados', () => {
    expect(datasIniciais(sem(), 'SEG_SAB')).toEqual(POSS);
  });
  it('datas salvas: são elas', () => {
    expect(datasIniciais(sem({ dias: 2, diasDatas: ['2026-10-29', '2026-10-26'] }), 'SEG_SAB')).toEqual(['2026-10-26', '2026-10-29']);
  });
  it('quantidade mudada à mão sem datas: não inventa quais dias', () => {
    expect(datasIniciais(sem({ dias: 5 }), 'SEG_SAB')).toBeNull();
  });
  it('zero dias: nada marcado', () => {
    expect(datasIniciais(sem({ dias: 0 }), 'SEG_SAB')).toEqual([]);
  });
});

describe('o que vai para a API', () => {
  it('rodou só 5: desmarca o sábado → manda as 5 datas', () => {
    const s = sem();
    const datas = alternarDia(datasIniciais(s, 'SEG_SAB'), '2026-10-31');
    expect(datas).toHaveLength(5);
    expect(corpoDias(s, 'SEG_SAB', datas, 0)).toEqual({ diasDatas: POSS.slice(0, 5) });
  });
  it('não mexeu: nada a salvar', () => {
    const s = sem({ dias: 5, diasDatas: POSS.slice(0, 5) });
    expect(corpoDias(s, 'SEG_SAB', datasIniciais(s, 'SEG_SAB'), 0)).toBeNull();
  });
  it('desmarcou tudo: dias 0 (não fica com o número antigo)', () => {
    expect(corpoDias(sem(), 'SEG_SAB', [], 0)).toEqual({ dias: 0 });
  });
  it('voltou exatamente aos previstos: volta ao automático', () => {
    const s = sem({ dias: 5 }); // estava 5 à mão
    expect(corpoDias(s, 'SEG_SAB', POSS, 0)).toEqual({ dias: null });
  });
  it('só a quantidade, sem datas', () => {
    expect(corpoDias(sem(), 'SEG_SAB', null, 4)).toEqual({ dias: 4 });
    expect(corpoDias(sem({ dias: 4 }), 'SEG_SAB', null, 6)).toEqual({ dias: null });
    expect(corpoDias(sem({ dias: 4 }), 'SEG_SAB', null, 4)).toBeNull();
  });
});

it('lista de datas da nota', () => {
  expect(listaDatas(['2026-10-26', '2026-10-27', '2026-10-29'])).toBe('26/10, 27/10 e 29/10');
  expect(listaDatas(['2026-10-26'])).toBe('26/10');
});
