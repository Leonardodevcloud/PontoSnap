import { describe, it, expect } from 'vitest';
import { crc16Kermit } from '../src/afd/index.js';

describe('CRC-16/KERMIT', () => {
  it('gera 2189 para "123456789" (vetor oficial da Portaria)', () => {
    expect(crc16Kermit('123456789')).toBe('2189');
  });
  it('sempre retorna 4 caracteres hexadecimais', () => {
    expect(crc16Kermit('a')).toHaveLength(4);
    expect(crc16Kermit('')).toBe('0000');
  });
});
