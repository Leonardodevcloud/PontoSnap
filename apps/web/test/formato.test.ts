import { describe, it, expect } from 'vitest';
import { rotuloMarcacao, rotuloProxima } from '../src/lib/formato';

const doDia = (total: number) => Array.from({ length: total }, (_, i) => rotuloMarcacao(i, total));

describe('rótulo das marcações', () => {
  it('dia normal (2 pares = 4 marcações)', () => {
    expect(doDia(4)).toEqual(['Entrada', 'Saída descanso', 'Retorno descanso', 'Saída']);
  });

  it('sábado (1 par = 2 marcações) não inventa descanso', () => {
    expect(doDia(2)).toEqual(['Entrada', 'Saída']);
  });

  it('três pares (6 marcações)', () => {
    expect(doDia(6)).toEqual([
      'Entrada', 'Saída descanso', 'Retorno descanso', 'Saída descanso', 'Retorno descanso', 'Saída',
    ]);
  });

  it('marcação excedente não some nem quebra o rótulo', () => {
    // esperava 4, bateu 6 (hora extra à noite): as 2 extras alternam
    const rots = Array.from({ length: 6 }, (_, i) => rotuloMarcacao(i, 4));
    expect(rots).toEqual(['Entrada', 'Saída descanso', 'Retorno descanso', 'Saída', 'Entrada', 'Saída']);
  });

  it('sem horário contratual, rotula pelo que já foi batido', () => {
    expect(doDia(1)).toEqual(['Entrada']);
    expect(doDia(3)).toEqual(['Entrada', 'Saída descanso', 'Saída']);
  });

  it('próxima marcação: o botão diz o que vai gravar', () => {
    expect(rotuloProxima(0, 4)).toBe('Entrada');
    expect(rotuloProxima(1, 4)).toBe('Saída descanso');
    expect(rotuloProxima(2, 4)).toBe('Retorno descanso');
    expect(rotuloProxima(3, 4)).toBe('Saída');
    expect(rotuloProxima(4, 4)).toBe('Entrada'); // excedente: voltou pra hora extra
  });

  it('próxima sem horário definido não promete descanso', () => {
    expect(rotuloProxima(0, 0)).toBe('Entrada');
    expect(rotuloProxima(1, 0)).toBe('Saída');
    expect(rotuloProxima(2, 0)).toBe('Retorno descanso');
  });
});
