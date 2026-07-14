import { describe, it, expect } from 'vitest';
import { apurarJornada } from '../src/tratamento/apuracao';

const d = (iso: string) => new Date(iso);

describe('motor de apuração', () => {
  it('jornada 8h cheia: saldo zero, sem noturno', () => {
    const r = apurarJornada([
      d('2026-07-13T08:00:00-0300'), d('2026-07-13T12:00:00-0300'),
      d('2026-07-13T13:00:00-0300'), d('2026-07-13T17:00:00-0300'),
    ], 480);
    expect(r.minutosTrabalhados).toBe(480);
    expect(r.saldoMinutos).toBe(0);
    expect(r.minutosNoturnos).toBe(0);
    expect(r.paresIncompletos).toBe(false);
  });

  it('conta horas extras (saldo positivo)', () => {
    const r = apurarJornada([d('2026-07-13T08:00:00-0300'), d('2026-07-13T18:00:00-0300')], 480);
    expect(r.minutosTrabalhados).toBe(600);
    expect(r.saldoMinutos).toBe(120); // 2h extras
  });

  it('conta minutos noturnos na janela 22h–05h', () => {
    const r = apurarJornada([d('2026-07-13T21:00:00-0300'), d('2026-07-13T23:00:00-0300')], 480);
    expect(r.minutosTrabalhados).toBe(120);
    expect(r.minutosNoturnos).toBe(60); // só 22:00–23:00
  });

  it('detecta número ímpar de batidas', () => {
    const r = apurarJornada([
      d('2026-07-13T08:00:00-0300'), d('2026-07-13T12:00:00-0300'), d('2026-07-13T13:00:00-0300'),
    ], 480);
    expect(r.paresIncompletos).toBe(true);
  });
});
