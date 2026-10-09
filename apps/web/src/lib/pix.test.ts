import { describe, it, expect } from 'vitest';
import { brCodePix, crc16, normalizarChave } from './pix';
import { mascaraDoc, docIncompleto } from './formato';

describe('pix', () => {
  it('CRC16-CCITT do exemplo clássico', () => { expect(crc16('123456789')).toBe('29B1'); });
  it('normaliza tipos de chave', () => {
    expect(normalizarChave('529.982.247-25')).toEqual({ chave: '52998224725', tipo: 'CPF' });
    expect(normalizarChave('(11) 98765-4321')).toEqual({ chave: '+5511987654321', tipo: 'TELEFONE' });
    expect(normalizarChave('11987654321')).toEqual({ chave: '+5511987654321', tipo: 'TELEFONE' });
    expect(normalizarChave('60.874.544/0001-04')).toEqual({ chave: '60874544000104', tipo: 'CNPJ' });
    expect(normalizarChave('Ana@Email.com')).toEqual({ chave: 'ana@email.com', tipo: 'EMAIL' });
    expect(normalizarChave('123e4567-E89B-12d3-a456-426614174000')?.tipo).toBe('ALEATORIA');
    expect(normalizarChave('abc')).toBeNull();
  });
  it('monta BR Code com valor, nome sem acento e CRC no fim', () => {
    const s = brCodePix({ chave: 'ana@email.com', nome: 'João da Conceição', valorCent: 234600 });
    expect(s.startsWith('000201')).toBe(true);
    expect(s).toContain('0014br.gov.bcb.pix0113ana@email.com');
    expect(s).toContain('5407234600'.replace('234600', '2346.00'));
    expect(s).toContain('5917JOAO DA CONCEICAO');
    expect(s.slice(-8, -4)).toBe('6304');
    expect(crc16(s.slice(0, -4))).toBe(s.slice(-4));
  });
  it('sem valor não leva o campo 54', () => { expect(brCodePix({ chave: '52998224725', nome: 'X' })).not.toContain('5404'); });
});

describe('máscara de documento', () => {
  it('CPF enquanto tem até 11 dígitos, CNPJ depois', () => {
    expect(mascaraDoc('529982')).toBe('529.982');
    expect(mascaraDoc('52998224725')).toBe('529.982.247-25');
    expect(mascaraDoc('608745440001')).toBe('60.874.544/0001');
    expect(mascaraDoc('60874544000104')).toBe('60.874.544/0001-04');
    expect(mascaraDoc('60.874.544/0001-049999')).toBe('60.874.544/0001-04');
  });
  it('valida tamanho', () => {
    expect(docIncompleto('')).toBe('');
    expect(docIncompleto('529.982')).not.toBe('');
    expect(docIncompleto('529.982.247-25', true)).not.toBe('');
  });
});
