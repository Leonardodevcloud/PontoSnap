import { describe, it, expect } from 'vitest';
import { resolverBatida } from '../src/offline';

const SERVIDOR = new Date('2026-07-16T12:00:00-0300');

describe('resolverBatida', () => {
  it('online comum: sem hora de aparelho, usa a do servidor', () => {
    const r = resolverBatida({}, SERVIDOR);
    expect(r.dtMarcacao).toEqual(SERVIDOR);
    expect(r.onlineOffline).toBe(0);
    expect(r.suspeita).toBe(false);
  });

  it('offline: a hora do aparelho vira a hora da marcação', () => {
    const aparelho = new Date('2026-07-16T08:00:00-0300'); // 4h antes de sincronizar
    const r = resolverBatida({ dtAparelho: aparelho, declaradoOffline: true }, SERVIDOR);
    expect(r.dtMarcacao).toEqual(aparelho);
    expect(r.dtGravacao).toEqual(SERVIDOR);
    expect(r.onlineOffline).toBe(1);
    expect(r.defasagemSeg).toBe(4 * 3600);
  });

  it('offline com pouca defasagem não é suspeito (perdeu o sinal um instante)', () => {
    const aparelho = new Date(SERVIDOR.getTime() - 30_000);
    const r = resolverBatida({ dtAparelho: aparelho, declaradoOffline: true }, SERVIDOR);
    expect(r.suspeita).toBe(false);
  });

  it('offline com muita defasagem é suspeito — mas ENTRA do mesmo jeito', () => {
    const aparelho = new Date('2026-07-16T08:00:00-0300');
    const r = resolverBatida({ dtAparelho: aparelho, declaradoOffline: true }, SERVIDOR);
    expect(r.suspeita).toBe(true);
    expect(r.dtMarcacao).toEqual(aparelho); // nunca recusa
  });

  it('diz online mas o relógio do aparelho está adiantado: online + suspeita', () => {
    // aparelho 10 min à frente do servidor
    const aparelho = new Date(SERVIDOR.getTime() + 600_000);
    const r = resolverBatida({ dtAparelho: aparelho, declaradoOffline: false }, SERVIDOR);
    expect(r.onlineOffline).toBe(0);
    expect(r.dtMarcacao).toEqual(SERVIDOR); // online confia no servidor
    expect(r.suspeita).toBe(true);
    expect(r.defasagemSeg).toBe(-600);
  });

  it('online com relógio dentro da latência de rede não é suspeito', () => {
    const aparelho = new Date(SERVIDOR.getTime() - 3_000); // 3s
    const r = resolverBatida({ dtAparelho: aparelho, declaradoOffline: false }, SERVIDOR);
    expect(r.suspeita).toBe(false);
  });

  it('a hora de gravação é sempre a do servidor', () => {
    const aparelho = new Date('2020-01-01T00:00:00-0300'); // relógio absurdo
    const r = resolverBatida({ dtAparelho: aparelho, declaradoOffline: true }, SERVIDOR);
    expect(r.dtGravacao).toEqual(SERVIDOR);
  });
});
