import { describe, it, expect } from 'vitest';
import { apurarPeriodo, REGRAS_CLT_PADRAO, type EntradaDia } from '../src/index.js';

const h = (data: string, hm: string) => new Date(`${data}T${hm}:00-0300`);
/** Dia de escala seg–sex 8h / sáb 4h, compensando na semana. */
const dia = (data: string, batidas: string[], carga = 480, over: Partial<EntradaDia> = {}): EntradaDia => ({
  data, jornadaContratadaMin: carga, marcacoes: batidas.map((x) => h(data, x)), compensaSemana: true,
  janelaPrevista: carga === 240 ? [{ entrada: '0800', saida: '1200' }] : [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }],
  ...over,
});
const domingo = (data: string): EntradaDia => ({ data, marcacoes: [], jornadaContratadaMin: 0, ehDomingo: true, ehDescanso: true, compensaSemana: true });
const longo = ['08:00', '12:00', '13:00', '17:48']; // 8h48
const R = REGRAS_CLT_PADRAO;

describe('compensa na semana', () => {
  it('estica a semana e folga o sábado: sem falta, sem extra', () => {
    const dias = [
      dia('2026-09-28', longo), dia('2026-09-29', longo), dia('2026-09-30', longo), dia('2026-10-01', longo), dia('2026-10-02', longo),
      dia('2026-10-03', [], 240), domingo('2026-10-04'),
    ];
    const r = apurarPeriodo(dias, R);
    const sab = r.dias.find((d) => d.data === '2026-10-03')!;
    expect(sab.faltaMin).toBe(0);
    expect(sab.semana?.compensado).toBe(true);
    expect(sab.semana?.estado).toBe('FECHADA');
    expect(r.totalFaltaMin).toBe(0);
    expect(r.totalExtrasMin).toBe(0);
    expect(r.totalAtrasoMin).toBe(0);
    expect(r.dsrPerdidoSemanas).toBe(0);
  });

  it('sem compensar (regra antiga), o mesmo sábado seria falta', () => {
    const dias = [dia('2026-10-03', [], 240, { compensaSemana: false }), { ...domingo('2026-10-04'), compensaSemana: false }];
    expect(apurarPeriodo(dias, R).totalFaltaMin).toBe(240);
  });

  it('fez a mais: extra da semana no último dia trabalhado', () => {
    const nove = ['08:00', '12:00', '13:00', '18:18']; // 9h18 × 5 = 46h30
    const dias = [...['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'].map((d) => dia(d, nove)), dia('2026-10-03', [], 240), domingo('2026-10-04')];
    const r = apurarPeriodo(dias, R);
    expect(r.totalExtrasMin).toBe(150);
    expect(r.dias.find((d) => d.data === '2026-10-02')!.extras.some((e) => e.motivo === 'extra da semana' && e.min === 150)).toBe(true);
  });

  it('fez a menos que um dia: atraso, sem falta', () => {
    const curto = ['08:00', '12:00', '13:00', '17:12']; // 8h12 × 5 = 41h → falta 3h
    const dias = [...['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'].map((d) => dia(d, curto)), dia('2026-10-03', [], 240), domingo('2026-10-04')];
    const r = apurarPeriodo(dias, R);
    expect(r.totalFaltaMin).toBe(0);
    expect(r.totalAtrasoMin).toBe(180);
    expect(r.saldoPeriodoMin).toBe(-180);
  });

  it('não veio um dia e não compensou: falta no dia + atraso do resto', () => {
    const dias = [
      dia('2026-09-28', longo), dia('2026-09-29', []), dia('2026-09-30', longo), dia('2026-10-01', longo), dia('2026-10-02', longo),
      dia('2026-10-03', [], 240), domingo('2026-10-04'),
    ];
    // feito 4 × 8h48 = 35h12; carga 44h → faltam 8h48 = 1 falta (8h, ter) + 0h48... sábado (4h) cabe antes?
    const r = apurarPeriodo(dias, R);
    // do mais antigo: terça (8h) vira falta; sobram 48min < sábado (4h) → atraso
    expect(r.dias.find((d) => d.data === '2026-09-29')!.faltaMin).toBe(480);
    expect(r.dias.find((d) => d.data === '2026-10-03')!.faltaMin).toBe(0);
    expect(r.totalAtrasoMin).toBe(48);
    expect(r.dsrPerdidoSemanas).toBe(1);
  });

  it('acima de 10h no dia é extra do próprio dia', () => {
    const dias = [dia('2026-09-28', ['07:00', '12:00', '13:00', '19:00']), ...['2026-09-29', '2026-09-30', '2026-10-01'].map((d) => dia(d, longo)),
      dia('2026-10-02', ['08:00', '12:00', '13:00', '15:48']), dia('2026-10-03', [], 240), domingo('2026-10-04')];
    // seg 11h → 1h extra no dia; semana conta 10h + 3×8h48 + 6h48 = 43h12 → −0h48
    const r = apurarPeriodo(dias, R);
    const seg = r.dias.find((d) => d.data === '2026-09-28')!;
    expect(seg.extras.find((e) => e.motivo === 'extra acima de 10h no dia')?.min).toBe(60);
    expect(r.totalAtrasoMin).toBe(48);
  });

  it('semana que termina no mês seguinte fica aberta (sem resultado)', () => {
    const dias = [dia('2026-09-28', longo), dia('2026-09-29', []), dia('2026-09-30', longo)];
    const r = apurarPeriodo(dias, R, { fimPeriodo: '2026-09-30' });
    expect(r.totalFaltaMin).toBe(0);
    expect(r.dias[1]!.semana?.estado).toBe('PROXIMO_MES');
  });

  it('com recorte: semana que começou no mês anterior fecha aqui e o resultado cai nos dias deste mês', () => {
    const nove = ['08:00', '12:00', '13:00', '18:18'];
    const dias = [...['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'].map((d) => dia(d, nove)), dia('2026-10-03', [], 240), domingo('2026-10-04')];
    const r = apurarPeriodo(dias, R, { recorteDe: '2026-10-01' });
    expect(r.dias[0]!.data).toBe('2026-10-01');
    expect(r.totalExtrasMin).toBe(150);
    expect(r.totalTrabalhadoMin).toBe(2 * 558);
  });
});
