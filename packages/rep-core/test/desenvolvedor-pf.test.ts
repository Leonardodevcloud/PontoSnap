import { describe, it, expect } from 'vitest';
import { montarAFD, montarAEJ } from '../src/index.js';
import type { RepConfig, MarcacaoGravada } from '@ponto/shared';

// Desenvolvedor PESSOA FÍSICA: tipoIdDesenvolvedor = 2, documento = CPF (11 dígitos)
const REP_PF: RepConfig = {
  tipoIdEmpregador: 1, documentoEmpregador: '12345678000190', cnoCaepf: null,
  razaoSocial: 'CLIENTE LTDA', numeroInpi: 'BR512024000123-4',
  tipoIdDesenvolvedor: 2, documentoDesenvolvedor: '12345678901',
};
const m: MarcacaoGravada = {
  nsr: 1, cpf: '12345678901', dtMarcacao: new Date('2026-07-13T11:00:00Z'),
  dtGravacao: new Date('2026-07-13T11:00:00Z'), coletor: 1, onlineOffline: 0,
  hashRegistro: 'A'.repeat(64), fuso: '-0300',
} as MarcacaoGravada;

describe('desenvolvedor pessoa física', () => {
  it('AFD: campo 12 = "2" e CPF ocupa as 14 posições do campo 13', () => {
    const { conteudo } = montarAFD({ rep: REP_PF, marcacoes: [m], fuso: '-0300' });
    const cab = conteudo.toString('latin1').split('\r\n')[0]!;
    expect(cab.length).toBe(302);
    expect(cab.slice(253, 254)).toBe('2');                    // tipo: 2 = CPF
    expect(cab.slice(254, 268)).toBe('00012345678901');       // CPF zero-preenchido
  });

  it('AEJ: registro 08 sai com tpIdtDesenv "2" e CPF de 11 dígitos', () => {
    const { conteudo } = montarAEJ({
      rep: REP_PF, fuso: '-0300',
      ptrp: { nome: 'PontoSnap', versao: '1.0.0', tpIdtDesenv: 2, idtDesenv: '12345678901', razaoNome: 'LEONARDO SANTOS', email: 'a@b.com' },
      empregados: [{ cpf: '12345678901', nome: 'FULANO' }],
    });
    const l08 = conteudo.toString('latin1').split('\r\n').find((l) => l.startsWith('08|'))!;
    const c = l08.split('|');
    expect(c[3]).toBe('2');                                    // tpIdtDesenv
    expect(c[4]).toMatch(/^\d{11}$/);                          // CPF: 11 dígitos (leiaute aceita 11 ou 14)
  });
});
