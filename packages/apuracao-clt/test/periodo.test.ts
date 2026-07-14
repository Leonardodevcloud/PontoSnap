import { describe, it, expect } from 'vitest';
import { apurarPeriodo, REGRAS_CLT_PADRAO, type EntradaDia } from '../src/index.js';

const d = (data: string, hm: string) => new Date(`${data}T${hm}:00-0300`);
const dia = (data: string, ini: string, fim: string, over: Partial<EntradaDia> = {}): EntradaDia => ({
  data, jornadaContratadaMin: 480,
  marcacoes: [d(data, ini), d(data, '12:00'), d(data, '13:00'), d(data, fim)], ...over,
});

describe('apuração do período', () => {
  it('agrega dias, classifica extras e estima o DSR', () => {
    const dias: EntradaDia[] = [
      dia('2026-07-13', '08:00', '17:00'),          // 8h, saldo 0
      dia('2026-07-14', '08:00', '18:00'),          // 9h, +60 extra 50%
      { data: '2026-07-19', marcacoes: [], jornadaContratadaMin: 0, ehDomingo: true }, // descanso
    ];
    const r = apurarPeriodo(dias, REGRAS_CLT_PADRAO);
    expect(r.totalTrabalhadoMin).toBe(540 + 480);
    expect(r.totalExtrasMin).toBe(60);
    expect(r.extrasPorAdicional['50']).toBe(60);
    expect(r.reflexoDsrMin).toBeGreaterThan(0); // há descanso e extras
  });

  it('com banco de horas, o saldo positivo vai para o banco', () => {
    const dias: EntradaDia[] = [dia('2026-07-14', '08:00', '18:00')]; // +60
    const r = apurarPeriodo(dias, { ...REGRAS_CLT_PADRAO, bancoDeHoras: true });
    expect(r.saldoPeriodoMin).toBe(60);
    expect(r.bancoDeHorasMin).toBe(60);
  });
});
