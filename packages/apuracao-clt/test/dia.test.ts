import { describe, it, expect } from 'vitest';
import { apurarDia, REGRAS_CLT_PADRAO, type EntradaDia } from '../src/index.js';

const d = (data: string, hm: string) => new Date(`${data}T${hm}:00-0300`);
const base = (over: Partial<EntradaDia>): EntradaDia => ({ data: '2026-07-13', marcacoes: [], jornadaContratadaMin: 480, ...over });

describe('apuração diária', () => {
  it('jornada de 8h cheia: saldo zero, intervalo de 1h, sem extra', () => {
    const r = apurarDia(base({ marcacoes: [d('2026-07-13', '08:00'), d('2026-07-13', '12:00'), d('2026-07-13', '13:00'), d('2026-07-13', '17:00')] }), REGRAS_CLT_PADRAO);
    expect(r.minutosTrabalhados).toBe(480);
    expect(r.saldoMin).toBe(0);
    expect(r.intervaloGozadoMin).toBe(60);
    expect(r.penalidadeIntervaloMin).toBe(0);
    expect(r.extrasTotalMin).toBe(0);
  });

  it('hora extra em dia útil sai a 50%', () => {
    const r = apurarDia(base({ marcacoes: [d('2026-07-13', '08:00'), d('2026-07-13', '12:00'), d('2026-07-13', '13:00'), d('2026-07-13', '18:00')] }), REGRAS_CLT_PADRAO);
    expect(r.minutosTrabalhados).toBe(540);
    expect(r.saldoMin).toBe(60);
    expect(r.extras[0]).toMatchObject({ min: 60, adicionalPct: 50 });
  });

  it('respeita a tolerância diária (Súmula 366): 8min a mais não vira extra', () => {
    const r = apurarDia(base({ marcacoes: [d('2026-07-13', '08:00'), d('2026-07-13', '12:00'), d('2026-07-13', '13:00'), d('2026-07-13', '17:08')] }), REGRAS_CLT_PADRAO);
    expect(r.minutosTrabalhados).toBe(488);
    expect(r.saldoMin).toBe(0);
  });

  it('intervalo insuficiente gera indenização +50% (Art. 71 §4º)', () => {
    const r = apurarDia(base({ marcacoes: [d('2026-07-13', '08:00'), d('2026-07-13', '12:00'), d('2026-07-13', '12:30'), d('2026-07-13', '17:00')] }), REGRAS_CLT_PADRAO);
    expect(r.intervaloGozadoMin).toBe(30);
    expect(r.penalidadeIntervaloMin).toBe(30); // 60 - 30
    expect(r.extras.some((e) => e.motivo.includes('intervalo') && e.adicionalPct === 50)).toBe(true);
  });

  it('trabalho em feriado sai a 100%', () => {
    const r = apurarDia(base({ ehFeriado: true, marcacoes: [d('2026-07-13', '08:00'), d('2026-07-13', '12:00')] }), REGRAS_CLT_PADRAO);
    expect(r.minutosContratados).toBe(0);
    expect(r.extras[0]).toMatchObject({ min: 240, adicionalPct: 100 });
  });

  it('trabalho a menos que a jornada (dia trabalhado) é atraso/saída antecipada, não falta', () => {
    const r = apurarDia(base({ marcacoes: [d('2026-07-13', '08:00'), d('2026-07-13', '12:00'), d('2026-07-13', '13:00'), d('2026-07-13', '16:00')] }), REGRAS_CLT_PADRAO);
    expect(r.minutosTrabalhados).toBe(420);
    expect(r.faltaMin).toBe(0);
    expect(r.atrasoMin).toBe(60);
    expect(r.saldoMin).toBe(-60);
  });

  it('dia esperado sem nenhuma batida é falta de dia inteiro', () => {
    const r = apurarDia(base({ marcacoes: [] }), REGRAS_CLT_PADRAO);
    expect(r.faltaMin).toBe(480);
    expect(r.faltaInjustificada).toBe(true);
    expect(r.pendente).toBe(false);
  });

  it('interjornada abaixo de 11h é sinalizada e indenizada', () => {
    const r = apurarDia(base({ saidaDiaAnterior: d('2026-07-12', '23:00'), marcacoes: [d('2026-07-13', '06:00'), d('2026-07-13', '10:00')] }), REGRAS_CLT_PADRAO);
    expect(r.violacaoInterjornada).toBe(true);
    expect(r.penalidadeInterjornadaMin).toBe(240); // 660 - 420
  });

  it('número ímpar de batidas fica em aberto', () => {
    const r = apurarDia(base({ marcacoes: [d('2026-07-13', '08:00'), d('2026-07-13', '12:00'), d('2026-07-13', '13:00')] }), REGRAS_CLT_PADRAO);
    expect(r.paresIncompletos).toBe(true);
  });

  const janela = [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }];

  it('batida em aberto NÃO vira atraso do período sem par (fica pendente)', () => {
    // esqueceu a saída da tarde: antes a janela lia 4h de "saída antecipada"
    const r = apurarDia(base({ janelaPrevista: janela, marcacoes: [d('2026-07-13', '08:00'), d('2026-07-13', '12:00'), d('2026-07-13', '13:00')] }), REGRAS_CLT_PADRAO);
    expect(r.pendente).toBe(true);
    expect(r.atrasoMin).toBe(0);
    expect(r.faltaMin).toBe(0);
    expect(r.saldoMin).toBe(0);
    expect(r.minutosTrabalhados).toBe(240);
  });

  it('só uma batida num dia passado também fica pendente, não falta', () => {
    const r = apurarDia(base({ janelaPrevista: janela, marcacoes: [d('2026-07-13', '08:00')] }), REGRAS_CLT_PADRAO);
    expect(r.pendente).toBe(true);
    expect(r.faltaMin).toBe(0);
    expect(r.atrasoMin).toBe(0);
  });

  it('hoje em andamento sem batida não é falta', () => {
    const r = apurarDia(base({ diaEmCurso: true, janelaPrevista: janela, marcacoes: [] }), REGRAS_CLT_PADRAO);
    expect(r.pendente).toBe(true);
    expect(r.faltaMin).toBe(0);
  });

  it('hoje em andamento, voltou do almoço: não lê a tarde como saída antecipada', () => {
    const r = apurarDia(base({ diaEmCurso: true, janelaPrevista: janela, marcacoes: [d('2026-07-13', '08:00'), d('2026-07-13', '12:00')] }), REGRAS_CLT_PADRAO);
    expect(r.pendente).toBe(true);
    expect(r.atrasoMin).toBe(0);
  });

  it('hoje com todas as batidas previstas já apura normalmente', () => {
    const r = apurarDia(base({ diaEmCurso: true, janelaPrevista: janela, marcacoes: [d('2026-07-13', '08:00'), d('2026-07-13', '12:00'), d('2026-07-13', '13:00'), d('2026-07-13', '18:00')] }), REGRAS_CLT_PADRAO);
    expect(r.pendente).toBe(false);
    expect(r.extrasTotalMin).toBe(60);
  });

  it('atraso real (par completo, entrada tardia) continua atraso', () => {
    const r = apurarDia(base({ janelaPrevista: janela, marcacoes: [d('2026-07-13', '08:40'), d('2026-07-13', '12:00'), d('2026-07-13', '13:00'), d('2026-07-13', '17:00')] }), REGRAS_CLT_PADRAO);
    expect(r.pendente).toBe(false);
    expect(r.atrasoMin).toBe(40);
  });

  it('trabalho em folga que não é domingo/feriado (sábado) sai a 50% e não gera falta', () => {
    const r = apurarDia(base({ ehDescanso: true, marcacoes: [d('2026-07-13', '08:00'), d('2026-07-13', '12:00')] }), REGRAS_CLT_PADRAO);
    expect(r.minutosContratados).toBe(0);
    expect(r.faltaMin).toBe(0);
    expect(r.extras[0]).toMatchObject({ min: 240, adicionalPct: 50 });
  });
});
