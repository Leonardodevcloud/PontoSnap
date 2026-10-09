import { describe, it, expect } from 'vitest';
import {
  calcularBeneficio, calcularMei, calcularSemanaMotorista, diasBase, diasComVr, parcelaNoMes, situacaoDebito, semanasDoMes, somarMeses,
} from '../src/pessoal/calculo';

describe('calendário', () => {
  it('outubro/2026 seg–sáb sem o feriado de 12/10 = 26 dias; seg–sex = 21', () => {
    const fer = new Set(['2026-10-12']);
    expect(diasBase('2026-10', 'SEG_SAB', fer)).toHaveLength(26);
    expect(diasBase('2026-10', 'SEG_SEX', fer)).toHaveLength(21);
  });
  it('semanas começam na segunda e são recortadas no mês', () => {
    const s = semanasDoMes('2026-10');
    expect(s[0]).toMatchObject({ inicio: '2026-10-01', fim: '2026-10-04' });
    expect(s[1]).toMatchObject({ inicio: '2026-10-05', fim: '2026-10-11' });
    expect(s[s.length - 1]!.fim).toBe('2026-10-31');
  });
  it('vira o ano', () => { expect(somarMeses('2026-12', 1)).toBe('2027-01'); });
});

describe('débito parcelado', () => {
  const d = { valorTotalCent: 25330, parcelas: 2, competenciaInicio: '2026-10' };
  it('cai só nos meses das parcelas e a última absorve o resto', () => {
    expect(parcelaNoMes(d, '2026-09')).toBeNull();
    expect(parcelaNoMes(d, '2026-10')).toEqual({ numero: 1, valorCent: 12665 });
    expect(parcelaNoMes(d, '2026-11')).toEqual({ numero: 2, valorCent: 12665 });
    expect(parcelaNoMes(d, '2026-12')).toBeNull();
    const imp = { valorTotalCent: 1000, parcelas: 3, competenciaInicio: '2026-10' };
    const soma = ['2026-10', '2026-11', '2026-12'].reduce((s, c) => s + parcelaNoMes(imp, c)!.valorCent, 0);
    expect(soma).toBe(1000);
  });
  it('retroativo: com parcelas já pagas, o início desconta a próxima e o resto fecha o total', () => {
    // R$ 1.000 em 12×, 4 pagas antes do sistema: out/26 é a 5ª, set/27 seria a 13ª (não existe)
    const r = { valorTotalCent: 100000, parcelas: 12, competenciaInicio: '2026-10', parcelasPagas: 4 };
    expect(parcelaNoMes(r, '2026-09')).toBeNull();
    expect(parcelaNoMes(r, '2026-10')).toEqual({ numero: 5, valorCent: 8333 });
    expect(parcelaNoMes(r, '2027-05')).toEqual({ numero: 12, valorCent: 100000 - 8333 * 11 });
    expect(parcelaNoMes(r, '2027-06')).toBeNull();
    expect(situacaoDebito(r, '2026-10')).toEqual({ pagoCent: 8333 * 4, faltaCent: 100000 - 8333 * 5 });
    expect(situacaoDebito(r, '2027-05')).toEqual({ pagoCent: 8333 * 11, faltaCent: 0 });
  });
  it('fixo: mesmo valor todo mês, sem fim, até o mês de encerramento', () => {
    const f = { valorTotalCent: 15000, parcelas: 1, competenciaInicio: '2026-10', tipo: 'FIXO' as const };
    expect(parcelaNoMes(f, '2026-09')).toBeNull();
    expect(parcelaNoMes(f, '2028-10')).toEqual({ numero: 25, valorCent: 15000 });
    expect(situacaoDebito(f, '2026-12')).toEqual({ pagoCent: 30000, faltaCent: null });
    expect(parcelaNoMes({ ...f, competenciaFim: '2026-11' }, '2026-12')).toBeNull();
    expect(parcelaNoMes({ ...f, competenciaFim: '2026-11' }, '2026-11')).toEqual({ numero: 2, valorCent: 15000 });
  });
});

describe('benefícios com acerto do mês anterior', () => {
  const pagos = ['2026-10-12', '2026-10-13', '2026-10-20', '2026-10-21'];
  const base = {
    vrDiaCent: 2500, cestaCent: 0, vtTipo: 'DIA' as const, vtValorCent: 1180, diasProx: 19, pagos,
    previstosMes: new Set(['2026-10-13', '2026-10-20', '2026-10-21']), // 12/10 é feriado
    faltas: new Set(['2026-10-20']), feriados: new Set(['2026-10-12']),
  };
  it('feriado pago e falta do ponto voltam como acerto na carga seguinte', () => {
    const r = calcularBeneficio(base);
    expect(r.vrProxCent).toBe(19 * 2500);
    expect(r.vtProxCent).toBe(19 * 1180);
    expect(r.naoUsados).toEqual([{ data: '2026-10-12', motivo: 'feriado' }, { data: '2026-10-20', motivo: 'falta' }]);
    expect(r.acertoVrCent).toBe(5000);
    expect(r.acertoVtCent).toBe(2360);
    expect(r.cargaCent).toBe(19 * 2500 + 19 * 1180 - 7360);
  });
  it('dia de férias/atestado (fora dos previstos) também é acerto', () => {
    const r = calcularBeneficio({ ...base, faltas: new Set(), previstosMes: new Set(['2026-10-20', '2026-10-21']) });
    expect(r.naoUsados.map((x) => x.motivo)).toEqual(['feriado', 'afastamento']);
  });
  it('combustível fixo: feriado não abate, falta abate 1/30', () => {
    const r = calcularBeneficio({ ...base, vtTipo: 'FIXO', vtValorCent: 10000 });
    expect(r.vtProxCent).toBe(10000);
    expect(r.acertoVtCent).toBe(333); // 1 falta × 100,00/30
  });
  it('valor mudou: a carga usa o novo, o acerto devolve pelo valor que foi pago', () => {
    const r = calcularBeneficio({ ...base, vrDiaCent: 3000, pagoCom: { vrDiaCent: 2500, vtTipo: 'DIA', vtValorCent: 1180 } });
    expect(r.vrProxCent).toBe(19 * 3000);
    expect(r.acertoVrCent).toBe(2 * 2500);
  });
  it('cesta: teve falta no mês, perde a cesta inteira', () => {
    const r = calcularBeneficio({ ...base, cestaCent: 8000 });   // base tem falta em 20/10
    expect(r.cestaStatus).toBe('PERDIDA_FALTA');
    expect(r.cestaCent).toBe(0);
    expect(r.vrProxCent).toBe(19 * 2500);
  });
  it('cesta: sem falta é paga cheia e entra na carga (sem acerto)', () => {
    const r = calcularBeneficio({ ...base, cestaCent: 8000, faltas: new Set() , previstosMes: new Set(['2026-10-13', '2026-10-20', '2026-10-21']) });
    expect(r.cestaStatus).toBe('PAGA');
    expect(r.cestaCent).toBe(8000);
    expect(r.cargaCent).toBe(r.vrProxCent + 8000 + r.vtProxCent - r.acertoCent);
  });
  it('cesta: em carência não paga, mesmo sem falta', () => {
    const r = calcularBeneficio({ ...base, cestaCent: 8000, faltas: new Set(), cestaLiberada: false });
    expect(r.cestaStatus).toBe('CARENCIA');
    expect(r.cestaCent).toBe(0);
  });
});

describe('VR no sábado de meio turno', () => {
  // outubro/2026: 03/10 é sábado
  const jornada = { '2026-10-01': 480, '2026-10-02': 480, '2026-10-03': 240, '2026-10-05': 480 };
  it('sábado de 4h não dá VR; dia de semana dá', () => {
    expect(diasComVr(Object.keys(jornada), jornada)).toEqual(['2026-10-01', '2026-10-02', '2026-10-05']);
  });
  it('sábado de turno cheio dá VR', () => {
    expect(diasComVr(['2026-10-03'], { ...jornada, '2026-10-03': 480 })).toEqual(['2026-10-03']);
  });
  it('VT conta todos os dias, VR só os de turno cheio; acerto de VR só do que foi pago com VR', () => {
    const r = calcularBeneficio({
      vrDiaCent: 2500, cestaCent: 0, vtTipo: 'DIA', vtValorCent: 1000, diasProx: 25, diasProxVr: 21,
      pagos: ['2026-10-03', '2026-10-12'], pagosVr: ['2026-10-12'],
      previstosMes: new Set(), faltas: new Set(), feriados: new Set(['2026-10-12']),
    });
    expect(r.vrProxCent).toBe(21 * 2500);
    expect(r.vtProxCent).toBe(25 * 1000);
    expect(r.acertoVrCent).toBe(2500);      // só 12/10 tinha VR
    expect(r.acertoVtCent).toBe(2 * 1000);  // VT dos dois dias
  });
});

describe('MEI: bruto (NF) e líquido', () => {
  const e = { valorCent: 388887, diasMes: 26, heMin: 0, faltas: 1, feriadosTrab: 0, metaCent: 80000, metaPaga: false, debitosCent: 152700 };
  it('meta a pagar entra no bruto e no líquido', () => {
    const r = calcularMei(e);
    expect(r.faltasCent).toBe(14957);              // 3.888,87 / 26
    expect(r.brutoCent).toBe(388887 - 14957 + 80000);
    expect(r.liquidoCent).toBe(r.brutoCent - 152700);
  });
  it('meta já paga continua na NF mas sai do líquido', () => {
    const r = calcularMei({ ...e, metaPaga: true });
    expect(r.brutoCent).toBe(388887 - 14957 + 80000);
    expect(r.liquidoCent).toBe(r.brutoCent - 152700 - 80000);
  });
  it('hora extra a 1,5 sobre o valor-hora do mês', () => {
    const r = calcularMei({ ...e, faltas: 0, metaCent: 0, debitosCent: 0, valorCent: 210000, heMin: 60 });
    expect(r.valorHoraCent).toBe(1010);           // 2.100 / 208h
    expect(r.heCent).toBe(1514);
  });
});

describe('motorista', () => {
  it('diária = mensal ÷ dias do mês', () => {
    const r = calcularSemanaMotorista({ mensalCent: 600000, diasMes: 26, dias: 3, adicionalCent: 0 });
    expect(r.diariaCent).toBe(23077);
    expect(r.totalCent).toBe(69231);
  });
});
