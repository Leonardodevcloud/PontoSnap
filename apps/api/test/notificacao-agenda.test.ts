import { describe, it, expect } from 'vitest';
import { agendaDoMomento, hhmmParaMin } from '../src/notificacao/agenda';

const base = {
  pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }],
  jornadaDiaMin: null, flexivel: false, marcacoes: 0, lembreteAntes: true, lembreteMinutos: 10,
};
const h = (s: string) => hhmmParaMin(s)!;

describe('agenda de notificações', () => {
  it('lê o horário da escala como o banco guarda ("0800") e com dois-pontos', () => {
    expect(hhmmParaMin('0800')).toBe(480);
    expect(hhmmParaMin('08:00')).toBe(480);
    expect(hhmmParaMin('8:05')).toBe(485);
    expect(hhmmParaMin('2500')).toBeNull();
  });

  it('lembra a entrada nos 10 minutos antes (bug antigo: "0800" virava 48000 min e nunca disparava)', () => {
    const r = agendaDoMomento(base, h('07:52'), '2026-10-14');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ tipo: 'lembreteAntes', chave: 'lembrete-0-2026-10-14', titulo: 'Hora de bater o ponto' });
    expect(r[0]!.corpo).toContain('08:00');
  });

  it('não lembra de batida que já foi feita', () => {
    expect(agendaDoMomento({ ...base, marcacoes: 1 }, h('07:55'), '2026-10-14')).toHaveLength(0);
  });

  it('"esqueceu a entrada?" entre 15 e 120 minutos depois, uma chave por dia', () => {
    expect(agendaDoMomento(base, h('08:10'), 'd')).toHaveLength(0);
    const r = agendaDoMomento(base, h('08:20'), 'd');
    expect(r).toEqual([expect.objectContaining({ tipo: 'esqueceuEntrada', chave: 'esqueceu-0-d' })]);
    expect(agendaDoMomento(base, h('10:30'), 'd')).toHaveLength(0);
  });

  it('só cobra a primeira batida que ficou para trás', () => {
    const r = agendaDoMomento({ ...base, marcacoes: 1 }, h('12:20'), 'd');
    expect(r).toEqual([expect.objectContaining({ tipo: 'esqueceuAlmoco', chave: 'esqueceu-1-d', titulo: 'Saiu para o almoço?' })]);
  });

  it('meio período (sábado 4h) usa só o primeiro turno: a saída é às 12:00', () => {
    const r = agendaDoMomento({ ...base, jornadaDiaMin: 240, marcacoes: 1 }, h('12:20'), 'd');
    expect(r[0]).toMatchObject({ tipo: 'esqueceuSaida', titulo: 'Esqueceu a saída?' });
    expect(agendaDoMomento({ ...base, jornadaDiaMin: 240, marcacoes: 2 }, h('13:20'), 'd')).toHaveLength(0);
  });

  it('contrato de horas não tem lembrete nem cobrança', () => {
    expect(agendaDoMomento({ ...base, flexivel: true }, h('08:20'), 'd')).toHaveLength(0);
  });

  it('respeita lembrete desligado, mas mantém o "esqueceu"', () => {
    expect(agendaDoMomento({ ...base, lembreteAntes: false }, h('07:55'), 'd')).toHaveLength(0);
    expect(agendaDoMomento({ ...base, lembreteAntes: false }, h('08:30'), 'd')).toHaveLength(1);
  });
});
