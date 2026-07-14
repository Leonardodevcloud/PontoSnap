import { describe, it, expect } from 'vitest';
import { podeAcessar } from '../src/common/rbac';
import { Perfil } from '@ponto/shared';

describe('RBAC — podeAcessar', () => {
  it('lista vazia libera qualquer autenticado', () => {
    expect(podeAcessar('COLABORADOR', [])).toBe(true);
  });
  it('permite quando o perfil está na lista', () => {
    expect(podeAcessar('RH', [Perfil.RH, Perfil.ADMIN_CLIENTE])).toBe(true);
  });
  it('bloqueia quando o perfil não está na lista', () => {
    expect(podeAcessar('COLABORADOR', [Perfil.RH, Perfil.ADMIN_CLIENTE])).toBe(false);
    expect(podeAcessar('RH', [Perfil.MASTER])).toBe(false);
  });
});
