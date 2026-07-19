import { describe, it, expect } from 'vitest';
import {
  formatarDataHoraAFD, offsetMin, inicioDoDia, fimDoDia, dataLocalDe, diaDaSemanaLocal,
} from '../src/datetime.js';
import { proximaMarcacao, verificarCadeia, construirEntradaHash, calcularHash } from '../src/hash-chain/index.js';
import { registro7 } from '../src/afd/index.js';
import { Coletor, OnlineOffline } from '@ponto/shared';
import type { MarcacaoGravada } from '@ponto/shared';

describe('helpers de fuso', () => {
  it('offsetMin lê os offsets do Brasil', () => {
    expect(offsetMin('-0200')).toBe(-120);
    expect(offsetMin('-0300')).toBe(-180);
    expect(offsetMin('-0400')).toBe(-240);
    expect(offsetMin('-0500')).toBe(-300);
  });

  it('formatarDataHoraAFD respeita o fuso passado', () => {
    // Mesmo instante, fusos diferentes → hora de parede diferente + sufixo.
    const dt = new Date('2026-07-10T12:00:00Z');
    expect(formatarDataHoraAFD(dt, '-0300')).toBe('2026-07-10T09:00:00-0300');
    expect(formatarDataHoraAFD(dt, '-0400')).toBe('2026-07-10T08:00:00-0400');
    // Sem argumento = Brasília (compatibilidade).
    expect(formatarDataHoraAFD(dt)).toBe('2026-07-10T09:00:00-0300');
  });

  it('inicioDoDia/fimDoDia deslocam o limite conforme o fuso', () => {
    // Meia-noite em Manaus (-04) é 1h depois (em UTC) que em Brasília (-03).
    expect(inicioDoDia('2026-07-14', '-0300').toISOString()).toBe('2026-07-14T03:00:00.000Z');
    expect(inicioDoDia('2026-07-14', '-0400').toISOString()).toBe('2026-07-14T04:00:00.000Z');
    expect(fimDoDia('2026-07-14', '-0400').toISOString()).toBe('2026-07-15T03:59:59.000Z');
  });

  it('uma batida na virada cai em dias diferentes conforme o fuso — o bug que isto corrige', () => {
    // 03:30Z do dia 14: em Brasília já é 00:30 do 14; em Manaus ainda é 23:30 do 13.
    const naVirada = new Date('2026-07-14T03:30:00Z');
    expect(dataLocalDe(naVirada, '-0300')).toBe('2026-07-14');
    expect(dataLocalDe(naVirada, '-0400')).toBe('2026-07-13');

    // Consequência no filtro por dia: essa batida entra no dia 14 de um cliente
    // de Brasília, mas pertence ao dia 13 de um cliente de Manaus.
    const dentroBrasilia = naVirada >= inicioDoDia('2026-07-14', '-0300')
      && naVirada <= fimDoDia('2026-07-14', '-0300');
    const dentroManaus14 = naVirada >= inicioDoDia('2026-07-14', '-0400');
    expect(dentroBrasilia).toBe(true);
    expect(dentroManaus14).toBe(false);
  });

  it('diaDaSemanaLocal é robusto a qualquer offset do Brasil', () => {
    // 2026-07-13 é uma segunda-feira (1) — vale para -02 a -05.
    for (const f of ['-0200', '-0300', '-0400', '-0500']) {
      expect(diaDaSemanaLocal('2026-07-13', f)).toBe(1);
    }
  });
});

const cpf = '43461292850';
function entrada(dtISO: string) {
  return {
    cpf, dtMarcacao: new Date(dtISO), dtGravacao: new Date(dtISO),
    coletor: Coletor.MOBILE, onlineOffline: OnlineOffline.ONLINE,
  };
}

describe('fuso no hash-chain (irreversível)', () => {
  it('sem fuso == com -0300: não muda o hash das batidas de produção existentes', () => {
    const semFuso = proximaMarcacao(entrada('2026-07-10T08:00:00-0300'), null);
    const comBrasilia = proximaMarcacao(entrada('2026-07-10T08:00:00-0300'), null, '-0300');
    expect(semFuso.hashRegistro).toBe(comBrasilia.hashRegistro);
    expect(semFuso.fuso).toBe('-0300');
  });

  it('fuso diferente produz hash diferente (o fuso está DENTRO do hash)', () => {
    const brasilia = proximaMarcacao(entrada('2026-07-10T12:00:00Z'), null, '-0300');
    const manaus = proximaMarcacao(entrada('2026-07-10T12:00:00Z'), null, '-0400');
    expect(manaus.hashRegistro).not.toBe(brasilia.hashRegistro);
    expect(manaus.fuso).toBe('-0400');
  });

  it('cadeia gravada em -0400 é verificada como íntegra usando o fuso da linha', () => {
    const dts = [
      '2026-07-10T08:00:00-0400', '2026-07-10T12:00:00-0400',
      '2026-07-10T13:00:00-0400', '2026-07-10T17:00:00-0400',
    ];
    const cadeia: MarcacaoGravada[] = [];
    let ant: { nsr: number; hashRegistro: string } | null = null;
    for (const dt of dts) {
      const m = proximaMarcacao(entrada(dt), ant, '-0400');
      cadeia.push(m);
      ant = { nsr: m.nsr, hashRegistro: m.hashRegistro };
    }
    expect(verificarCadeia(cadeia)).toEqual({ integro: true, nsrQuebrado: null });
    expect(cadeia.every((m) => m.fuso === '-0400')).toBe(true);
  });

  it('trocar o fuso gravado de uma linha quebra a verificação (fuso é imutável junto do hash)', () => {
    const m = proximaMarcacao(entrada('2026-07-10T12:00:00Z'), null, '-0400');
    // Alguém "corrige" o fuso da linha para -0300 sem refazer o hash → quebra.
    const adulterada: MarcacaoGravada = { ...m, fuso: '-0300' };
    const r = verificarCadeia([adulterada]);
    expect(r.integro).toBe(false);
    expect(r.nsrQuebrado).toBe(1);
  });
});

describe('AFD reproduz o fuso de cada marcação', () => {
  it('registro7 formata a marcação com o fuso da própria linha e casa com o hash', () => {
    const m = proximaMarcacao(entrada('2026-07-10T12:00:00Z'), null, '-0400');
    const linha = registro7(m);
    // Marcação (posições 11–34): AAAA-MM-ddThh:mm:00-0400
    expect(linha).toContain('2026-07-10T08:00:00-0400');
    // O hash impresso na linha é o mesmo que recalculamos com o fuso da linha.
    const recalculado = calcularHash(construirEntradaHash({
      nsr: m.nsr, dtMarcacao: m.dtMarcacao, cpf: m.cpf, dtGravacao: m.dtGravacao,
      coletor: m.coletor, onlineOffline: m.onlineOffline, hashAnterior: null, fuso: m.fuso,
    }));
    expect(linha).toContain(recalculado);
    // Larguras do leiaute preservadas.
    expect(linha).toHaveLength(137);
  });
});
