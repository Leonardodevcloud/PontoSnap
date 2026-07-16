import { describe, it, expect } from 'vitest';
import { calcularBanco, somarMeses, type MovimentoBanco } from '../src/banco';

const cred = (data: string, min: number): MovimentoBanco =>
  ({ data, minutos: min, tipo: 'CREDITO' });
const deb = (data: string, min: number): MovimentoBanco =>
  ({ data, minutos: -min, tipo: 'DEBITO' });

describe('somarMeses', () => {
  it('soma normal', () => {
    expect(somarMeses('2026-01-15', 6)).toBe('2026-07-15');
  });

  it('não inventa 31 de fevereiro', () => {
    expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('vira o ano', () => {
    expect(somarMeses('2026-08-10', 12)).toBe('2027-08-10');
  });
});

describe('saldo do banco', () => {
  it('crédito simples fica no saldo com prazo do acordo individual', () => {
    const r = calcularBanco([cred('2026-07-01', 120)], 6, '2026-07-15');
    expect(r.saldoMin).toBe(120);
    expect(r.creditadoMin).toBe(120);
    expect(r.proximoVencimento).toBe('2027-01-01');
    expect(r.vencidoMin).toBe(0);
  });

  it('compensação consome o crédito MAIS VELHO primeiro (FIFO)', () => {
    // O de janeiro vence antes; a folga tem que abater ele, não o de junho.
    const r = calcularBanco([
      cred('2026-01-10', 120),
      cred('2026-06-10', 120),
      deb('2026-07-01', 120),
    ], 6, '2026-07-15');
    expect(r.saldoMin).toBe(120);
    expect(r.lotes).toHaveLength(1);
    expect(r.lotes[0]!.data).toBe('2026-06-10'); // o velho foi consumido
  });

  it('crédito não compensado no prazo VENCE e vira dinheiro a pagar', () => {
    // Crédito de janeiro, acordo de 6 meses → venceu em 10/07.
    const r = calcularBanco([cred('2026-01-10', 180)], 6, '2026-07-15');
    expect(r.vencidoMin).toBe(180);
    expect(r.saldoMin).toBe(180); // ainda é devido — mas em dinheiro, não em folga
    expect(r.lotes[0]!.vencido).toBe(true);
  });

  it('acordo coletivo dá 12 meses, e aí o mesmo crédito ainda está vivo', () => {
    const r = calcularBanco([cred('2026-01-10', 180)], 12, '2026-07-15');
    expect(r.vencidoMin).toBe(0);
    expect(r.proximoVencimento).toBe('2027-01-10');
  });

  it('avisa o que vence nos próximos 30 dias', () => {
    const r = calcularBanco([
      cred('2026-01-20', 60),  // vence 20/07 — dentro de 30 dias
      cred('2026-06-20', 90),  // vence 20/12 — longe
    ], 6, '2026-07-01');
    expect(r.aVencerMin).toBe(60);
    expect(r.vencidoMin).toBe(0);
  });

  it('pagamento quita o lote e tira do saldo', () => {
    const r = calcularBanco([
      cred('2026-01-10', 180),
      { data: '2026-07-20', minutos: -180, tipo: 'PAGAMENTO', descricao: 'Pago na folha de julho' },
    ], 6, '2026-07-25');
    expect(r.saldoMin).toBe(0);
    expect(r.pagoMin).toBe(180);
    expect(r.vencidoMin).toBe(0);
    expect(r.compensadoMin).toBe(0); // pagamento não é compensação
  });

  it('compensar mais do que tem deixa o empregado devendo', () => {
    const r = calcularBanco([cred('2026-07-01', 60), deb('2026-07-10', 180)], 6, '2026-07-15');
    expect(r.saldoMin).toBe(-120);
    expect(r.devedorMin).toBe(120);
    expect(r.lotes).toHaveLength(0);
  });

  it('crédito novo abate a dívida antes de virar lote com prazo', () => {
    const r = calcularBanco([
      deb('2026-07-01', 120),   // ficou devendo 2h
      cred('2026-07-10', 180),  // entram 3h: 2h quitam a dívida, 1h vira lote
    ], 6, '2026-07-15');
    expect(r.devedorMin).toBe(0);
    expect(r.saldoMin).toBe(60);
    expect(r.lotes).toHaveLength(1);
    expect(r.lotes[0]!.minutosRestantes).toBe(60);
  });

  it('extrato fora de ordem dá o mesmo resultado', () => {
    const movs = [deb('2026-07-01', 120), cred('2026-01-10', 120), cred('2026-06-10', 120)];
    const a = calcularBanco(movs, 6, '2026-07-15');
    const b = calcularBanco([...movs].reverse(), 6, '2026-07-15');
    expect(a.saldoMin).toBe(b.saldoMin);
    expect(a.lotes[0]!.data).toBe(b.lotes[0]!.data);
  });

  it('banco vazio não quebra', () => {
    const r = calcularBanco([], 6, '2026-07-15');
    expect(r.saldoMin).toBe(0);
    expect(r.proximoVencimento).toBeNull();
    expect(r.lotes).toHaveLength(0);
  });

  it('cenário real de meio ano', () => {
    const r = calcularBanco([
      cred('2026-02-05', 130),  // vence 05/08
      cred('2026-03-12', 90),   // vence 12/09
      deb('2026-04-01', 130),   // folga: consome o de fevereiro inteiro
      cred('2026-05-20', 200),  // vence 20/11
      deb('2026-06-15', 60),    // consome parte do de março
    ], 6, '2026-07-15');
    // sobrou: 30 de março + 200 de maio
    expect(r.saldoMin).toBe(230);
    expect(r.creditadoMin).toBe(420);
    expect(r.compensadoMin).toBe(190);
    expect(r.vencidoMin).toBe(0);
    expect(r.proximoVencimento).toBe('2026-09-12');
  });
});
