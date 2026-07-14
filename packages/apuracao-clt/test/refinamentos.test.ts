import { describe, it, expect } from 'vitest';
import { apurarDia, apurarPeriodo, minutosNoturnosReais, REGRAS_CLT_PADRAO, type EntradaDia } from '../src/index.js';

const d = (iso: string) => new Date(iso);
const base = (over: Partial<EntradaDia>): EntradaDia => ({ data: '2026-07-13', marcacoes: [], jornadaContratadaMin: 480, ...over });

describe('prorrogação da jornada noturna (Súmula 60 II)', () => {
  it('hora após as 05h no mesmo turno continua noturna', () => {
    // 22:00 → 07:00 = 9h; noturno 22–05 (7h=420) + prorrogação 05–07 (2h=120) = 540
    const r = minutosNoturnosReais(d('2026-07-13T22:00:00-0300'), d('2026-07-14T07:00:00-0300'), REGRAS_CLT_PADRAO);
    expect(r).toBe(540);
  });
  it('sem prorrogação, conta só a janela', () => {
    const r = minutosNoturnosReais(d('2026-07-13T22:00:00-0300'), d('2026-07-14T07:00:00-0300'),
      { ...REGRAS_CLT_PADRAO, noturno: { ...REGRAS_CLT_PADRAO.noturno, prorrogacao: false } });
    expect(r).toBe(420);
  });
});

describe('intervalo por faixa (Art. 71 §1º)', () => {
  const dh = (hm: string) => new Date(`2026-07-13T${hm}:00-0300`);
  it('jornada de 4–6h sem intervalo indeniza 15min', () => {
    // 08:00–13:00 = 5h corridas, sem intervalo → deve 15min
    const r = apurarDia(base({ marcacoes: [dh('08:00'), dh('13:00')], jornadaContratadaMin: 300 }), REGRAS_CLT_PADRAO);
    expect(r.penalidadeIntervaloMin).toBe(15);
  });
  it('jornada de até 4h não exige intervalo', () => {
    const r = apurarDia(base({ marcacoes: [dh('08:00'), dh('12:00')], jornadaContratadaMin: 240 }), REGRAS_CLT_PADRAO);
    expect(r.penalidadeIntervaloMin).toBe(0);
  });
});

describe('regime 12x36 (Art. 59-A)', () => {
  const dh = (hm: string, dia = '13') => new Date(`2026-07-${dia}T${hm}:00-0300`);
  it('feriado trabalhado é dia normal (sem 100%)', () => {
    const r = apurarDia(base({ regime: 'r12x36', ehFeriado: true, jornadaContratadaMin: 720,
      marcacoes: [dh('07:00'), dh('13:00'), dh('14:00'), dh('20:00')] }), REGRAS_CLT_PADRAO);
    expect(r.minutosContratados).toBe(720);       // dia normal, não descanso
    expect(r.extras.some((e) => e.adicionalPct === 100)).toBe(false); // feriado não paga 100% no 12x36
  });
  it('não aplica interjornada de 11h', () => {
    const r = apurarDia(base({ regime: 'r12x36', jornadaContratadaMin: 720,
      saidaDiaAnterior: dh('19:00', '12'), marcacoes: [dh('07:00'), dh('19:00')] }), REGRAS_CLT_PADRAO);
    expect(r.violacaoInterjornada).toBe(false);
  });
});

describe('perda de DSR por falta injustificada (Lei 605/49)', () => {
  const dh = (data: string, hm: string) => new Date(`${data}T${hm}:00-0300`);
  it('semana com falta injustificada perde 1 DSR', () => {
    const dias: EntradaDia[] = [
      { data: '2026-07-13', jornadaContratadaMin: 480, marcacoes: [dh('2026-07-13', '08:00'), dh('2026-07-13', '12:00'), dh('2026-07-13', '13:00'), dh('2026-07-13', '17:00')] },
      { data: '2026-07-14', jornadaContratadaMin: 480, marcacoes: [] }, // falta injustificada
    ];
    const r = apurarPeriodo(dias, REGRAS_CLT_PADRAO);
    expect(r.dsrPerdidoSemanas).toBe(1);
  });
});
