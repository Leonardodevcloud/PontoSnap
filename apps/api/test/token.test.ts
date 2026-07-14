import { describe, it, expect } from 'vitest';
import { TokenService } from '../src/auth/token';

const svc = new TokenService({
  segredoAcesso: 'a-secret', segredoRefresh: 'r-secret',
  expiraAcesso: '15m', expiraRefresh: '7d',
});

describe('TokenService (JWT)', () => {
  it('assina e verifica o access token com as claims', () => {
    const t = svc.assinarAcesso({ sub: 'u1', tenantId: 'ten1', perfil: 'RH' });
    const p = svc.verificarAcesso(t);
    expect(p.sub).toBe('u1');
    expect(p.tenantId).toBe('ten1');
    expect(p.perfil).toBe('RH');
  });
  it('rejeita token adulterado', () => {
    const t = svc.assinarAcesso({ sub: 'u1', tenantId: null, perfil: 'MASTER' });
    expect(() => svc.verificarAcesso(t + 'x')).toThrow();
  });
  it('não valida um refresh como se fosse access (segredos distintos)', () => {
    const r = svc.assinarRefresh('u1');
    expect(() => svc.verificarAcesso(r)).toThrow();
    expect(svc.verificarRefresh(r).sub).toBe('u1');
  });
});
