import { describe, it, expect } from 'vitest';
import { explicar } from '../src/lib/explicar';
import type { ApuracaoResp, ResultadoDiaCLT } from '../src/tipos';

const dia = (data: string, p: Partial<ResultadoDiaCLT>): ResultadoDiaCLT => ({
  data, marcacoes: [], ehDescansoDia: false, faltaInjustificada: false, minutosTrabalhados: 0, minutosContratados: 480,
  minutosNoturnosReais: 0, minutosNoturnosLegais: 0, extras: [], extrasTotalMin: 0, faltaMin: 0, atrasoMin: 0, saldoMin: 0,
  intervaloGozadoMin: 60, penalidadeIntervaloMin: 0, penalidadeInterjornadaMin: 0, violacaoInterjornada: false, paresIncompletos: false,
  observacoes: [], ...p,
});

function ap(dias: ResultadoDiaCLT[], extra: Partial<ApuracaoResp> = {}): ApuracaoResp {
  const soma = (f: (d: ResultadoDiaCLT) => number) => dias.reduce((a, d) => a + f(d), 0);
  return {
    nome: 'Lucas', matricula: null, inicio: '2026-10-01', fim: '2026-10-31',
    resultado: {
      dias, totalTrabalhadoMin: soma((d) => d.minutosTrabalhados), totalContratadoMin: soma((d) => d.minutosContratados),
      totalExtrasMin: soma((d) => d.extrasTotalMin), extrasPorAdicional: {}, totalNoturnoLegalMin: 0,
      totalFaltaMin: soma((d) => d.faltaMin), totalAtrasoMin: soma((d) => d.atrasoMin), saldoPeriodoMin: soma((d) => d.saldoMin),
      bancoDeHorasMin: 0, reflexoDsrMin: 0, dsrPerdidoSemanas: 1, diasComViolacao: [],
    },
    destinacao: { falta: { min: 0, destino: 'DESCONTA' }, atraso: { min: 0, destino: 'DESCONTA' }, extra: { min: 0, destino: 'PAGA' } },
    horarioDurMin: 480, horarioFlexivel: false, jornadaPorDia: null, banco: null,
    ...extra,
  } as ApuracaoResp;
}

describe('por que deu esse número', () => {
  it('extras por dia somam o total da apuração', () => {
    const e = explicar(ap([
      dia('2026-10-05', { minutosTrabalhados: 540, extras: [{ min: 60, adicionalPct: 50, motivo: 'extra diária' }], extrasTotalMin: 60, saldoMin: 60 }),
      dia('2026-10-06', { minutosTrabalhados: 520, extras: [{ min: 40, adicionalPct: 50, motivo: 'extra diária' }], extrasTotalMin: 40, saldoMin: 40 }),
    ]), 'extras');
    expect(e.titulo).toBe('Por que +1h40 de extra?');
    expect(e.linhas.filter((l) => l.op === '+').map((l) => l.valor)).toEqual(['+1h00', '+0h40']);
    expect(e.linhas.at(-1)).toMatchObject({ op: '=', valor: '+1h40', estilo: 'total' });
  });

  it('semana que compensa: só a semana fechada acima da carga gera extra', () => {
    const sem = (feito: number, resultado: number, estado: 'FECHADA' | 'ABERTA' = 'FECHADA') =>
      ({ inicio: '2026-10-05', fim: '2026-10-11', estado, feitoMin: feito, cargaMin: 2640, resultadoMin: resultado, compensado: false });
    const e = explicar(ap([
      dia('2026-10-09', { semana: sem(2800, 160), extras: [{ min: 160, adicionalPct: 50, motivo: 'extra da semana' }], extrasTotalMin: 160 }),
      dia('2026-10-13', { semana: { ...sem(600, 0, 'ABERTA'), inicio: '2026-10-12', fim: '2026-10-18' } }),
    ]), 'extras');
    expect(e.linhas[0]).toMatchObject({ op: '+', rotulo: 'Semana 05/10–11/10', valor: '+2h40' });
    expect(e.linhas[1]).toMatchObject({ estilo: 'zero', valor: '—' });
    expect(e.linhas.at(-1)!.valor).toBe('+2h40');
  });

  it('faltas com cargas diferentes explicam a soma (7 × 8h + 2 × 4h)', () => {
    const dias = [
      ...Array.from({ length: 7 }, (_, i) => dia(`2026-10-${String(i + 1).padStart(2, '0')}`, { faltaMin: 480, faltaInjustificada: true })),
      dia('2026-10-10', { minutosContratados: 240, faltaMin: 240 }), dia('2026-10-17', { minutosContratados: 240, faltaMin: 240 }),
    ];
    const e = explicar(ap(dias), 'faltas');
    expect(e.titulo).toBe('Por que 64h00 de falta?');
    expect(e.resumo).toContain('7 × 8h00 + 2 × 4h00');
    expect(e.nota).toContain('DSR');
    expect(e.linhas.at(-1)).toMatchObject({ rotulo: 'Faltas do mês · 9 dias', valor: '64h00' });
  });

  it('banco: anterior + mês + avulso = acumulado', () => {
    const e = explicar(ap([], { banco: { ativo: true, formaCalculo: 'BANCO_HORAS', prazoMeses: 6, competencia: '2026-10', fechada: false,
      saldoAnteriorMin: 190, saldoMesMin: 140, avulsoMin: 0, saldoAcumuladoMin: 330, desatualizado: false } }), 'banco');
    expect(e.titulo).toBe('Por que +5h30 no banco?');
    expect(e.linhas.map((l) => l.valor)).toEqual(['+3h10', '+2h20', '0h00', '+5h30']);
  });
});
