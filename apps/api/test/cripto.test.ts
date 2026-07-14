import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { CriptoService } from '../src/common/cripto.service';

describe('CriptoService (AES-256-GCM)', () => {
  let svc: CriptoService;
  beforeAll(() => {
    process.env.APP_CRYPTO_KEY = randomBytes(32).toString('base64');
    svc = new CriptoService();
  });

  it('faz o round-trip cifra/decifra', () => {
    const segredo = 'senha-do-certificado-A1';
    const cifrado = svc.cifrar(segredo);
    expect(cifrado).not.toContain(segredo);
    expect(svc.decifrar(cifrado)).toBe(segredo);
  });

  it('cifra a mesma entrada com IVs diferentes', () => {
    expect(svc.cifrar('x')).not.toBe(svc.cifrar('x'));
  });

  it('detecta adulteração (auth tag do GCM)', () => {
    const cifrado = svc.cifrar('dado');
    const [iv, tag, enc] = cifrado.split(':');
    const adulterado = `${iv}:${tag}:${Buffer.from('outro-dado').toString('base64')}`;
    expect(() => svc.decifrar(adulterado)).toThrow();
    void enc;
  });
});
