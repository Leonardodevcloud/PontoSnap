import { describe, expect, it } from 'vitest';
import { feriadoValePara, localEfetivo, ufDoMunicipio } from '../src';
import { MUNICIPIOS } from '../src/municipios-br';

const SSA = { uf: 'BA', municipioIbge: 2927408 }, LAURO = { uf: 'BA', municipioIbge: 2919207 }, MCZ = { uf: 'AL', municipioIbge: 2704302 };
describe('feriados por região', () => {
  it('nacional vale para todos (até sem local)', () => {
    expect(feriadoValePara({ tipo: 'nacional', uf: null, municipioIbge: null }, null)).toBe(true);
  });
  it('estadual: só a UF', () => {
    const f = { tipo: 'estadual', uf: 'BA', municipioIbge: null };
    expect(feriadoValePara(f, SSA)).toBe(true);
    expect(feriadoValePara(f, LAURO)).toBe(true);
    expect(feriadoValePara(f, MCZ)).toBe(false);
    expect(feriadoValePara(f, null)).toBe(false);
  });
  it('municipal: só a cidade', () => {
    const f = { tipo: 'municipal', uf: 'BA', municipioIbge: 2927408 };
    expect(feriadoValePara(f, SSA)).toBe(true);
    expect(feriadoValePara(f, LAURO)).toBe(false);
  });
  it('antigo sem região vale para todos (como antes)', () => {
    expect(feriadoValePara({ tipo: 'municipal', uf: null, municipioIbge: null }, MCZ)).toBe(true);
    expect(feriadoValePara({ tipo: 'estadual', uf: null, municipioIbge: null }, null)).toBe(true);
  });
  it('local da pessoa, senão o da empresa', () => {
    expect(localEfetivo({ uf: null, municipioIbge: null }, SSA)).toBe(SSA);
    expect(localEfetivo(LAURO, SSA)).toBe(LAURO);
    expect(localEfetivo(null, null)).toBe(null);
  });
  it('UF pelo código IBGE e base completa', () => {
    expect(ufDoMunicipio(2927408)).toBe('BA');
    expect(ufDoMunicipio(123)).toBe(null);
    expect(Object.keys(MUNICIPIOS).length).toBe(27);
    expect(MUNICIPIOS.BA!.find(([, n]) => n === 'Salvador')?.[0]).toBe(2927408);
    expect(Object.entries(MUNICIPIOS).every(([uf, l]) => l.every(([i]) => ufDoMunicipio(i) === uf))).toBe(true);
  });
});
