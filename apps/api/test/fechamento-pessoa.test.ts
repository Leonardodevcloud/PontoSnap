import { describe, it, expect } from 'vitest';
import { congelarMei, congelarMot, debitosDepois, diasAte } from '../src/pessoal/fechamento-pessoa';
import { calcularMei, diasBase, calcularSemanaMotorista, semanasDoMes } from '../src/pessoal/calculo';
import type { LinhaMei, LinhaMot } from '../src/pessoal/pessoal.service';

const COMP = '2026-10';
const fer = new Set(['2026-10-12']);
function mei(valorCent = 220000, debitosCent = 0): LinhaMei {
  const diasMes = diasBase(COMP, 'SEG_SAB', fer).length;
  const r = calcularMei({ valorCent, diasMes, heMin: 0, faltas: 0, feriadosTrab: 0, metaCent: 0, metaPaga: false, debitosCent });
  return { id: 'm', nome: 'Ana', documento: null, funcao: null, empresa: null, inicioAtividade: null, competenciaInicio: '2026-01', valorCent, chavePix: null,
    valorDesde: '2026-01', historicoValores: [], baseDias: 'SEG_SAB', diasMes, debitosCent,
    lanc: { heMin: 0, faltas: 0, feriadosTrab: 0, metaCent: 0, metaPaga: false, metaPagaEm: null, nfNumero: null, nfData: null, pago: false, observacao: null, valorPagoCent: null, pagoEm: null, nfArquivo: null },
    ...r };
}

describe('fechamento de uma pessoa', () => {
  it('dias até o último dia na base seg–sáb, sem feriado', () => {
    // 01/10 (qui) a 15/10 (qui), sem domingos e sem 12/10 = 12 dias
    expect(diasAte(COMP, 'SEG_SAB', fer, '2026-10-15')).toBe(12);
  });

  it('MEI desligado: contrato proporcional e líquido coerente', () => {
    const m = mei();
    const c = congelarMei(m, { motivo: 'DESLIGAMENTO', ultimoDia: '2026-10-15', proporcional: true }, fer, COMP, 0);
    expect(c.proporcional).toEqual({ dias: 12, diasMes: m.diasMes, contratoCent: Math.round(220000 * 12 / m.diasMes) });
    expect(c.liquidoCent).toBe(c.proporcional!.contratoCent);
  });

  it('MEI "mês cheio" mantém o contrato inteiro; débitos futuros saem do líquido', () => {
    const c = congelarMei(mei(220000, 30000), { motivo: 'DESLIGAMENTO', ultimoDia: '2026-10-15', proporcional: false }, fer, COMP, 60000);
    expect(c.proporcional).toBeUndefined();
    expect(c.liquidoCent).toBe(220000 - 30000 - 60000);
    expect(c.debitosFuturosCent).toBe(60000);
  });

  it('pagar antes do fechamento (antecipado) não mexe no valor', () => {
    const m = mei();
    expect(congelarMei(m, { motivo: 'ANTECIPADO', ultimoDia: null, proporcional: false }, fer, COMP, 0).liquidoCent).toBe(m.liquidoCent);
  });

  it('débitos depois: soma só as parcelas que ainda iam cair (fixo não entra)', () => {
    const parc = { valorTotalCent: 90000, parcelas: 3, competenciaInicio: '2026-10', parcelasPagas: 0, tipo: 'PARCELADO' as const, competenciaFim: null };
    const fixo = { valorTotalCent: 5000, parcelas: 1, competenciaInicio: '2026-01', parcelasPagas: 0, tipo: 'FIXO' as const, competenciaFim: null };
    expect(debitosDepois([parc, fixo], '2026-10')).toBe(60000);
    expect(debitosDepois([parc], '2026-12')).toBe(0);
  });

  it('motorista: zera semanas depois do último dia e corta a semana dele', () => {
    const diasMes = diasBase(COMP, 'SEG_SAB', fer).length;
    const base = new Set(diasBase(COMP, 'SEG_SAB', fer));
    const semanas = semanasDoMes(COMP).map((s) => {
      const dias = s.dias.filter((d) => base.has(d)).length;
      return { inicio: s.inicio, fim: s.fim, diasAuto: dias, dias, adicionalCent: 0, nfNumero: null, pago: false, nfArquivo: null, debitoAplicadoCent: 0, valorPagoCent: null, pagoEm: null,
        totalCent: calcularSemanaMotorista({ mensalCent: 250000, diasMes, dias, adicionalCent: 0 }).totalCent };
    });
    const m = { id: 'x', nome: 'Bruno', documento: null, funcao: null, empresa: null, inicioAtividade: null, competenciaInicio: '2026-01', valorCent: 250000, chavePix: null,
      valorDesde: '2026-01', historicoValores: [], baseDias: 'SEG_SAB', diasMes, diariaCent: 0, semanas, totalCent: 250000, debitosCent: 0, liquidoCent: 250000, observacao: null,
      pagamento: { pago: false, valorPagoCent: null, pagoEm: null }, debitoPendenteCent: 0 } as LinhaMot;
    const c = congelarMot(m, { motivo: 'DESLIGAMENTO', ultimoDia: '2026-10-15', proporcional: false }, fer, COMP, 0);
    expect(c.semanas.reduce((a, s) => a + s.dias, 0)).toBe(12);
    expect(c.semanas.filter((s) => s.inicio > '2026-10-15').every((s) => s.dias === 0 && s.totalCent === 0)).toBe(true);
    expect(c.totalCent).toBe(Math.round(250000 / diasMes * 12));
  });
});
