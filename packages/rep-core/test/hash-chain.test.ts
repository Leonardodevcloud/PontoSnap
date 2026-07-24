import { describe, it, expect } from 'vitest';
import { proximaMarcacao, verificarCadeia } from '../src/hash-chain/index.js';
import { Coletor, OnlineOffline } from '@ponto/shared';
import type { MarcacaoGravada } from '@ponto/shared';

function montarCadeia(): MarcacaoGravada[] {
  const base = [
    '2026-07-10T08:00:00-0300',
    '2026-07-10T12:00:00-0300',
    '2026-07-10T13:00:00-0300',
    '2026-07-10T17:00:00-0300',
  ];
  const cadeia: MarcacaoGravada[] = [];
  let anterior: { nsr: number; hashRegistro: string } | null = null;
  for (const dt of base) {
    const m = proximaMarcacao({
      cpf: '43461292850', dtMarcacao: new Date(dt), dtGravacao: new Date(dt),
      coletor: Coletor.MOBILE, onlineOffline: OnlineOffline.ONLINE,
    }, anterior, '-0300');
    cadeia.push(m);
    anterior = { nsr: m.nsr, hashRegistro: m.hashRegistro };
  }
  return cadeia;
}

describe('cadeia de hash', () => {
  it('NSR é sequencial e o 1º hashAnterior é null', () => {
    const c = montarCadeia();
    expect(c.map((m) => m.nsr)).toEqual([1, 2, 3, 4]);
    expect(c[0]!.hashAnterior).toBeNull();
    expect(c[1]!.hashAnterior).toBe(c[0]!.hashRegistro);
  });

  it('cadeia íntegra é verificada como íntegra', () => {
    expect(verificarCadeia(montarCadeia())).toEqual({ integro: true, nsrQuebrado: null });
  });

  it('adulterar uma marcação quebra a cadeia', () => {
    const c = montarCadeia();
    c[1]!.dtMarcacao = new Date('2026-07-10T11:59:00-0300'); // fraude
    const r = verificarCadeia(c);
    expect(r.integro).toBe(false);
    expect(r.nsrQuebrado).toBe(2);
  });
});
