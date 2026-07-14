import { describe, it, expect } from 'vitest';
import { hashSenha, verificarSenha } from '../src/auth/senha';

describe('hash de senha (bcrypt)', () => {
  it('verifica a senha correta e rejeita a errada', async () => {
    const hash = await hashSenha('SenhaForte123');
    expect(hash).not.toBe('SenhaForte123');       // nunca em texto puro
    expect(await verificarSenha('SenhaForte123', hash)).toBe(true);
    expect(await verificarSenha('senhaerrada', hash)).toBe(false);
  });
  it('gera hashes diferentes para a mesma senha (salt)', async () => {
    expect(await hashSenha('x123456789')).not.toBe(await hashSenha('x123456789'));
  });
});
