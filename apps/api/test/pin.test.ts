import { describe, it, expect } from 'vitest';
import { pinValido, hashPin, verificarPin } from '../src/auth/pin';

describe('PIN do quiosque', () => {
  it('valida formato (4 a 8 dígitos)', () => {
    expect(pinValido('4712')).toBe(true);
    expect(pinValido('123')).toBe(false);
    expect(pinValido('12ab')).toBe(false);
  });
  it('rejeita PIN de formato inválido no hash', async () => {
    await expect(hashPin('12')).rejects.toThrow();
  });
  it('faz o round-trip de verificação', async () => {
    const hash = await hashPin('4712');
    expect(await verificarPin('4712', hash)).toBe(true);
    expect(await verificarPin('0000', hash)).toBe(false);
  });
});
