import { describe, it, expect } from 'vitest';
import { distanciaMetros, foraDoRaio } from '../src/geo';

const ESCRITORIO = { latitude: -12.9777, longitude: -38.5016 };

describe('distância', () => {
  it('mesmo ponto dá zero', () => {
    expect(distanciaMetros(ESCRITORIO, ESCRITORIO)).toBe(0);
  });

  it('bate com referência conhecida (Salvador → Feira de Santana, ~94 km em linha reta)', () => {
    // Atenção: os ~110 km conhecidos são de ESTRADA. Haversine mede linha reta.
    const feira = { latitude: -12.2664, longitude: -38.9663 };
    const d = distanciaMetros(ESCRITORIO, feira);
    expect(d).toBeGreaterThan(90_000);
    expect(d).toBeLessThan(97_000);
  });

  it('poucos metros de diferença são detectados', () => {
    const aoLado = { latitude: -12.9777, longitude: -38.5006 };
    const d = distanciaMetros(ESCRITORIO, aoLado);
    expect(d).toBeGreaterThan(90);
    expect(d).toBeLessThan(120);
  });
});

describe('fora do raio', () => {
  const local = { ...ESCRITORIO, raioMetros: 200 };

  it('dentro do raio não é fora', () => {
    expect(foraDoRaio(local, { latitude: -12.9778, longitude: -38.5017 }).fora).toBe(false);
  });

  it('longe é fora e informa a distância', () => {
    const r = foraDoRaio(local, { latitude: -12.9900, longitude: -38.4600 });
    expect(r.fora).toBe(true);
    expect(r.distancia).toBeGreaterThan(200);
  });

  it('sem local cadastrado nunca é fora (empresa remota)', () => {
    expect(foraDoRaio(null, ESCRITORIO)).toEqual({ fora: false, distancia: null });
  });

  it('sem raio definido nunca é fora', () => {
    expect(foraDoRaio({ ...ESCRITORIO, raioMetros: null }, { latitude: 0, longitude: 0 }).fora).toBe(false);
  });

  it('sem localização da batida nunca é fora (permissão negada)', () => {
    expect(foraDoRaio(local, null)).toEqual({ fora: false, distancia: null });
  });
});
