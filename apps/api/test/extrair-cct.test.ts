import { describe, it, expect } from 'vitest';
import { mapearGeminiParaCct } from '../src/cct/extrair-cct';

describe('mapearGeminiParaCct', () => {
  it('mapeia uma resposta boa e mantém as citações', () => {
    const out = mapearGeminiParaCct({
      nome: 'Motoristas Carga RS', uf: 'rs', vigencia: '2025/2026',
      extraDiaUtilPct: 60, extraDomingoFeriadoPct: 100, noturnoAdicionalPct: 30,
      jornadaSemanalMin: 2640, bancoPrazoMeses: 12,
      citacoes: [{ campo: 'Extra dia útil', texto: 'Cláusula 12ª — 60%' }],
    });
    expect(out.valores.extraDiaUtilPct).toBe(60);
    expect(out.valores.uf).toBe('RS'); // normaliza pra maiúsculo
    expect(out.valores.bancoPrazoMeses).toBe(12);
    expect(out.citacoes).toHaveLength(1);
  });

  it('faz clamp de valores absurdos', () => {
    const out = mapearGeminiParaCct({ extraDiaUtilPct: 9999, bancoPrazoMeses: 99, toleranciaPorMarcacaoMin: -5 });
    expect(out.valores.extraDiaUtilPct).toBe(300); // teto
    expect(out.valores.bancoPrazoMeses).toBe(12);  // teto do banco
    expect(out.valores.toleranciaPorMarcacaoMin).toBe(0); // piso
  });

  it('ignora campos não numéricos e lixo, sem quebrar', () => {
    const out = mapearGeminiParaCct({ extraDiaUtilPct: 'sei lá', jornadaSemanalMin: null, citacoes: 'não é lista' });
    expect(out.valores.extraDiaUtilPct).toBeUndefined();
    expect(out.valores.jornadaSemanalMin).toBeUndefined();
    expect(out.citacoes).toEqual([]);
  });

  it('descarta citação sem campo ou sem texto', () => {
    const out = mapearGeminiParaCct({ citacoes: [{ campo: 'X', texto: '' }, { texto: 'sem campo' }, { campo: 'Y', texto: 'ok' }] });
    expect(out.citacoes).toEqual([{ campo: 'Y', texto: 'ok' }]);
  });

  it('não inventa nada com entrada vazia', () => {
    const out = mapearGeminiParaCct({});
    expect(out.valores).toEqual({});
    expect(out.citacoes).toEqual([]);
  });
});
