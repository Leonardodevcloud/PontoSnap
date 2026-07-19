import { describe, it, expect } from 'vitest';
import {
  calcularMensalidade, vencimentoDaCompetencia, resolverBase,
  estaAtrasada, diasDeAtraso,
} from '../src/cobranca';

describe('calcularMensalidade', () => {
  it('FIXO ignora a contagem de funcionários', () => {
    expect(calcularMensalidade({ modo: 'FIXO', valor: 320 }, 50)).toBe(320);
    expect(calcularMensalidade({ modo: 'FIXO', valor: 320 }, 1)).toBe(320);
  });

  it('POR_FUNCIONARIO multiplica valor pelos ativos', () => {
    expect(calcularMensalidade({ modo: 'POR_FUNCIONARIO', valor: 8 }, 25)).toBe(200);
  });

  it('POR_FUNCIONARIO nunca zera: mínimo de 1', () => {
    expect(calcularMensalidade({ modo: 'POR_FUNCIONARIO', valor: 8 }, 0)).toBe(8);
  });

  it('arredonda para 2 casas sem lixo de ponto flutuante', () => {
    expect(calcularMensalidade({ modo: 'POR_FUNCIONARIO', valor: 8.33 }, 3)).toBe(24.99);
  });
});

describe('vencimentoDaCompetencia', () => {
  it('monta a data com o dia escolhido', () => {
    expect(vencimentoDaCompetencia('2026-08', 10)).toBe('2026-08-10');
  });

  it('limita a 28 para existir em fevereiro', () => {
    expect(vencimentoDaCompetencia('2026-02', 31)).toBe('2026-02-28');
  });

  it('preenche o zero à esquerda do dia', () => {
    expect(vencimentoDaCompetencia('2026-08', 5)).toBe('2026-08-05');
  });
});

describe('resolverBase (overrides)', () => {
  it('sem override, herda do plano', () => {
    const b = resolverBase({ modo: 'FIXO', valor: 180 }, {});
    expect(b).toEqual({ modo: 'FIXO', valor: 180 });
  });

  it('override de valor manda sobre o plano', () => {
    const b = resolverBase({ modo: 'FIXO', valor: 180 }, { valor: 250 });
    expect(b.valor).toBe(250);
  });

  it('override de modo manda sobre o plano', () => {
    const b = resolverBase({ modo: 'FIXO', valor: 8 }, { modo: 'POR_FUNCIONARIO' });
    expect(b.modo).toBe('POR_FUNCIONARIO');
  });

  it('sem plano, usa só o override (contrato 100% avulso)', () => {
    const b = resolverBase(null, { modo: 'FIXO', valor: 500 });
    expect(b).toEqual({ modo: 'FIXO', valor: 500 });
  });

  it('sem plano e sem override é erro de configuração', () => {
    expect(() => resolverBase(null, {})).toThrow(/sem plano/);
  });
});

describe('atraso', () => {
  const hoje = new Date('2026-07-18T12:00:00-0300');

  it('vencimento no futuro não está atrasado', () => {
    expect(estaAtrasada('2026-08-10', 'ABERTA', hoje)).toBe(false);
  });

  it('vencimento passado e não paga está atrasada', () => {
    expect(estaAtrasada('2026-07-06', 'ABERTA', hoje)).toBe(true);
  });

  it('paga nunca está atrasada, mesmo vencida', () => {
    expect(estaAtrasada('2026-07-06', 'PAGA', hoje)).toBe(false);
  });

  it('conta os dias de atraso', () => {
    expect(diasDeAtraso('2026-07-06', hoje)).toBe(11);
  });

  it('em dia: zero dias de atraso', () => {
    expect(diasDeAtraso('2026-08-10', hoje)).toBe(0);
  });

  it('o fim do dia do vencimento respeita o fuso do tenant', () => {
    // 03:30Z do dia 15: em Brasília (-03) já passou do fim do dia 14 (venceu);
    // em Manaus (-04) ainda é 23:30 do dia 14 (dentro do prazo, não venceu).
    const instante = new Date('2026-07-15T03:30:00Z');
    expect(estaAtrasada('2026-07-14', 'ABERTA', instante, '-0300')).toBe(true);
    expect(estaAtrasada('2026-07-14', 'ABERTA', instante, '-0400')).toBe(false);
  });

  it('sem fuso explícito, mantém o comportamento de Brasília', () => {
    const instante = new Date('2026-07-15T03:30:00Z');
    expect(estaAtrasada('2026-07-14', 'ABERTA', instante)).toBe(true);
  });
});
