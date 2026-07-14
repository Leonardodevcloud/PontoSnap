import { describe, it, expect } from 'vitest';
import { minutosNoturnosReais, noturnoLegal, REGRAS_CLT_PADRAO } from '../src/index.js';

const d = (iso: string) => new Date(iso);

describe('hora noturna', () => {
  it('conta minutos de relógio na janela 22h–05h (cruzando meia-noite)', () => {
    const r = minutosNoturnosReais(d('2026-07-13T22:00:00-0300'), d('2026-07-14T05:00:00-0300'), REGRAS_CLT_PADRAO);
    expect(r).toBe(420); // 7h de relógio
  });

  it('não conta fora da janela', () => {
    const r = minutosNoturnosReais(d('2026-07-13T18:00:00-0300'), d('2026-07-13T22:00:00-0300'), REGRAS_CLT_PADRAO);
    expect(r).toBe(0);
  });

  it('aplica a hora reduzida: 7h de relógio = 8h legais', () => {
    expect(noturnoLegal(420, true)).toBe(480);
    expect(noturnoLegal(420, false)).toBe(420);
  });
});
