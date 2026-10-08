import { describe, it, expect } from 'vitest';
import { salarioDoMes, salarioEm, valorizarComSalarios, valorizarPeriodo, apurarPeriodo, REGRAS_CLT_PADRAO, type EntradaDia } from '../src/index.js';

const d = (data: string, hm: string) => new Date(`${data}T${hm}:00-0300`);
const dia = (data: string, saida: string | null): EntradaDia => ({
  data, jornadaContratadaMin: 480,
  marcacoes: saida ? [d(data, '08:00'), d(data, '12:00'), d(data, '13:00'), d(data, saida)] : [],
});

describe('salário com vigência', () => {
  const hist = [{ desde: '2000-01-01', centavos: 300000 }, { desde: '2026-10-15', centavos: 450000 }];

  it('salário vigente por data', () => {
    expect(salarioEm(hist, '2026-10-14')).toBe(300000);
    expect(salarioEm(hist, '2026-10-15')).toBe(450000);
  });

  it('mês sem mudança paga o salário cheio (31 dias)', () => {
    expect(salarioDoMes(hist, '2026-09')!.totalCent).toBe(300000);
    expect(salarioDoMes(hist, '2026-12')!.totalCent).toBe(450000);
  });

  it('promoção no dia 15: 14 dias pelo antigo, 16 pelo novo (base 30)', () => {
    const r = salarioDoMes(hist, '2026-10')!;
    expect(r.partes.map((p) => [p.desde, p.salarioCent])).toEqual([['2026-10-01', 300000], ['2026-10-15', 450000]]);
    expect(r.partes[0]!.valorCent).toBe(140000); // 3000 × 14/30
    expect(r.partes[1]!.valorCent).toBe(240000); // 4500 × 16/30
    expect(r.totalCent).toBe(380000);
  });

  it('admissão no meio do mês: só os dias com salário', () => {
    const r = salarioDoMes([{ desde: '2026-10-21', centavos: 300000 }], '2026-10')!;
    expect(r.totalCent).toBe(110000); // 11 dias × 100
  });

  it('extra antes da promoção pelo salário antigo, depois pelo novo', () => {
    const periodo = apurarPeriodo([dia('2026-10-14', '18:00'), dia('2026-10-15', '18:00')], REGRAS_CLT_PADRAO);
    const v = valorizarComSalarios(periodo, hist, 220, REGRAS_CLT_PADRAO)!;
    const hAntiga = Math.round(300000 / 220), hNova = Math.round(450000 / 220);
    expect(v.extrasCentavos).toBe(Math.round(hAntiga * 1.5) + Math.round(hNova * 1.5));
    expect(v.valorHoraCentavos).toBe(hNova);
  });

  it('sem mudança no período é idêntico ao cálculo antigo', () => {
    const periodo = apurarPeriodo([dia('2026-09-14', '18:00'), dia('2026-09-15', null)], REGRAS_CLT_PADRAO);
    expect(valorizarComSalarios(periodo, hist, 220, REGRAS_CLT_PADRAO))
      .toEqual(valorizarPeriodo(periodo, { salarioMensalCentavos: 300000, horasMensaisFolha: 220 }, REGRAS_CLT_PADRAO));
  });

  it('falta antes da promoção desconta pelo salário antigo', () => {
    const periodo = apurarPeriodo([dia('2026-10-13', null), dia('2026-10-16', null)], REGRAS_CLT_PADRAO);
    const v = valorizarComSalarios(periodo, hist, 220, REGRAS_CLT_PADRAO)!;
    const so13 = valorizarPeriodo(apurarPeriodo([dia('2026-10-13', null)], REGRAS_CLT_PADRAO), { salarioMensalCentavos: 300000, horasMensaisFolha: 220 }, REGRAS_CLT_PADRAO);
    const so16 = valorizarPeriodo(apurarPeriodo([dia('2026-10-16', null)], REGRAS_CLT_PADRAO), { salarioMensalCentavos: 450000, horasMensaisFolha: 220 }, REGRAS_CLT_PADRAO);
    expect(v.descontoFaltasCentavos).toBe(so13.descontoFaltasCentavos + so16.descontoFaltasCentavos);
  });
});
