import { describe, it, expect } from 'vitest';
import { apurarDia, REGRAS_CLT_PADRAO, type EntradaDia } from '../src/index.js';

const d = (hm: string) => new Date(`2026-07-13T${hm}:00-0300`);
const JANELA = [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }];
const base = (marc: string[], over: Partial<EntradaDia> = {}): EntradaDia => ({
  data: '2026-07-13', jornadaContratadaMin: 480, janelaPrevista: JANELA,
  marcacoes: marc.map(d), ...over,
});

describe('apuração por janela (confronto com a jornada prevista)', () => {
  it('cumprindo o horário exato: sem atraso e sem extra', () => {
    const r = apurarDia(base(['08:00', '12:00', '13:00', '17:00']), REGRAS_CLT_PADRAO);
    expect(r.atrasoMin).toBe(0);
    expect(r.extrasTotalMin).toBe(0);
    expect(r.saldoMin).toBe(0);
  });

  it('atraso na entrada além da tolerância é apurado', () => {
    const r = apurarDia(base(['08:20', '12:00', '13:00', '17:00']), REGRAS_CLT_PADRAO);
    expect(r.atrasoMin).toBe(20);
    expect(r.extrasTotalMin).toBe(0);
  });

  it('atraso de até 5min é tolerado (Súmula 366)', () => {
    const r = apurarDia(base(['08:04', '12:00', '13:00', '17:00']), REGRAS_CLT_PADRAO);
    expect(r.atrasoMin).toBe(0);
  });

  it('saída antecipada é apurada', () => {
    const r = apurarDia(base(['08:00', '12:00', '13:00', '16:30']), REGRAS_CLT_PADRAO);
    expect(r.atrasoMin).toBe(30);
  });

  it('hora extra após a janela sai a 50%', () => {
    const r = apurarDia(base(['08:00', '12:00', '13:00', '18:00']), REGRAS_CLT_PADRAO);
    expect(r.extras[0]).toMatchObject({ min: 60, adicionalPct: 50 });
    expect(r.atrasoMin).toBe(0);
  });

  it('atraso e extra se compensam no mesmo dia por padrão', () => {
    const r = apurarDia(base(['08:30', '12:00', '13:00', '17:30']), REGRAS_CLT_PADRAO);
    expect(r.atrasoMin).toBe(0);
    expect(r.extrasTotalMin).toBe(0);
    expect(r.saldoMin).toBe(0);
  });

  it('sem compensação, atraso e extra coexistem', () => {
    const r = apurarDia(base(['08:30', '12:00', '13:00', '17:30']), { ...REGRAS_CLT_PADRAO, compensarAtrasoComExtra: false });
    expect(r.atrasoMin).toBe(30);
    expect(r.extrasTotalMin).toBe(30);
  });

  it('par previsto não cumprido (só manhã) vira atraso do período da tarde', () => {
    const r = apurarDia(base(['08:00', '12:00']), REGRAS_CLT_PADRAO);
    expect(r.atrasoMin).toBe(240); // 13:00–17:00 não trabalhado
    expect(r.faltaMin).toBe(0);    // não é falta de dia inteiro
  });
});
