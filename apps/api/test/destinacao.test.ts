import { describe, it, expect } from 'vitest';
import { resumirDestinacao, movimentosBancoDoDia } from '../src/tratamento/destinacao';

const periodo = (faltaMin: number, atrasoMin: number, extrasMin: number) =>
  ({ totalFaltaMin: faltaMin, totalAtrasoMin: atrasoMin, totalExtrasMin: extrasMin } as never);
const dia = (saldoMin: number, faltaMin: number, paresIncompletos = false) => ({ saldoMin, faltaMin, paresIncompletos } as never);

describe('resumirDestinacao', () => {
  it('roteia falta, atraso e extra conforme a regra (banco ativo)', () => {
    const r = resumirDestinacao(periodo(480, 45, 200), {
      destinacaoFaltas: 'DESCONTA', destinacaoAtrasos: 'BANCO', bancoAtivo: true,
    });
    expect(r.falta).toEqual({ min: 480, destino: 'DESCONTA' });
    expect(r.atraso).toEqual({ min: 45, destino: 'BANCO' });
    expect(r.extra).toEqual({ min: 200, destino: 'BANCO' });
  });

  it('sem banco, "BANCO" vira desconto e extra é pago', () => {
    const r = resumirDestinacao(periodo(0, 30, 120), {
      destinacaoFaltas: 'BANCO', destinacaoAtrasos: 'BANCO', bancoAtivo: false,
    });
    expect(r.atraso.destino).toBe('DESCONTA');
    expect(r.extra.destino).toBe('PAGA');
  });

  it('respeita abonar e tolerar', () => {
    const r = resumirDestinacao(periodo(480, 20, 0), {
      destinacaoFaltas: 'ABONA', destinacaoAtrasos: 'TOLERA', bancoAtivo: true,
    });
    expect(r.falta.destino).toBe('ABONA');
    expect(r.atraso.destino).toBe('TOLERA');
  });
});

describe('movimentosBancoDoDia', () => {
  const banco = { destinacaoFaltas: 'BANCO' as const, destinacaoAtrasos: 'BANCO' as const, bancoAtivo: true };
  const desconto = { destinacaoFaltas: 'DESCONTA' as const, destinacaoAtrasos: 'DESCONTA' as const, bancoAtivo: true };

  it('extra sempre credita', () => {
    const m = movimentosBancoDoDia(dia(120, 0), desconto);
    expect(m).toEqual([{ minutos: 120, tipo: 'CREDITO', descricao: 'Hora extra' }]);
  });
  it('falta (em faltaMin, saldo 0) debita só se destino BANCO', () => {
    const comBanco = movimentosBancoDoDia(dia(0, 480), banco);
    expect(comBanco).toEqual([{ minutos: -480, tipo: 'DEBITO', descricao: 'Falta injustificada' }]);
    expect(movimentosBancoDoDia(dia(0, 480), desconto)).toEqual([]);
  });
  it('atraso (saldo negativo, sem falta) debita só se destino BANCO', () => {
    expect(movimentosBancoDoDia(dia(-45, 0), banco)).toEqual([{ minutos: -45, tipo: 'DEBITO', descricao: 'Atraso ou saída antecipada' }]);
    expect(movimentosBancoDoDia(dia(-45, 0), desconto)).toEqual([]);
  });
  it('dia com par incompleto não gera movimento', () => {
    expect(movimentosBancoDoDia(dia(-45, 0, true), banco)).toEqual([]);
  });
  it('sem banco, nada negativo vai pro banco', () => {
    expect(movimentosBancoDoDia(dia(0, 480), { ...banco, bancoAtivo: false })).toEqual([]);
  });
});
