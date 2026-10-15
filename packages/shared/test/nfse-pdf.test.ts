import { describe, expect, it } from 'vitest';
import { lerChaveNfse, lerNfsePdf, type TextoPdf } from '../src/nfse';

/** Monta itens de texto: [str, x, y]. */
const itens = (l: Array<[string, number, number]>): TextoPdf[] => l.map(([str, x, y]) => ({ str, x, y, w: str.length * 4.2, pagina: 1 }));
const chave = (cnpj: string, num: string, aamm = '2610') => `2927408${'1'}${'2'}${cnpj}${num.padStart(13, '0')}${aamm}1234567897`;

describe('lerChaveNfse', () => {
  it('tira CNPJ, número e mês da chave de 50 dígitos', () => {
    expect(lerChaveNfse(chave('45112908000130', '184'))).toEqual({ doc: '45112908000130', numero: '184', anoMes: '2026-10' });
  });
  it('CPF (tipo 1) vem com 11 dígitos', () => {
    const c = `2927408` + '1' + '1' + '000' + '12345678901' + '0000000000007' + '2610' + '123456789' + '7';
    expect(lerChaveNfse(c)?.doc).toBe('12345678901');
  });
  it('rejeita tamanho errado ou mês inválido', () => {
    expect(lerChaveNfse('123')).toBeNull();
    expect(lerChaveNfse(chave('45112908000130', '1', '2613'))).toBeNull();
  });
});

describe('lerNfsePdf — DANFSe em tabela (rótulos numa linha, valores na de baixo)', () => {
  const danfse = itens([
    ['Chave de Acesso da NFS-e', 30, 765], [chave('45112908000130', '184'), 30, 755],
    ['Número da NFS-e', 30, 745], ['Competência da NFS-e', 200, 745], ['Data e Hora da emissão da NFS-e', 370, 745],
    ['184', 30, 735], ['09/2026', 200, 735], ['02/10/2026 09:12:33', 370, 735],
    ['EMITENTE DA NFS-e', 30, 715], ['CNPJ / CPF / NIF', 200, 705], ['45.112.908/0001-30', 200, 695],
    ['TOMADOR DO SERVIÇO', 30, 670], ['CNPJ / CPF / NIF', 30, 660], ['42.246.432/0002-08', 30, 650],
    ['INTERMEDIÁRIO DO SERVIÇO', 30, 630], ['99.999.999/0001-99', 30, 620],
    ['Valor do Serviço', 30, 590], ['Desconto Condicionado', 200, 590], ['Valor Líquido da NFS-e', 370, 590],
    ['R$ 2.480,00', 30, 580], ['R$ 0,00', 200, 580], ['R$ 2.410,00', 370, 580],
  ]);
  it('lê tudo e pega o valor LÍQUIDO (não o do serviço)', () => {
    const l = lerNfsePdf(danfse);
    expect(l).toMatchObject({ numero: '184', data: '2026-10-02', valorCent: 241000, cnpjPrestador: '45112908000130', cnpjTomador: '42246432000208', leu: true });
    expect(l.chave).toHaveLength(50);
  });
  it('a ordem dos itens no arquivo não importa', () => {
    expect(lerNfsePdf([...danfse].reverse()).valorCent).toBe(241000);
  });
});

describe('lerNfsePdf — modelo de prefeitura ("Rótulo: valor")', () => {
  it('lê pelos rótulos comuns, sem chave', () => {
    const l = lerNfsePdf(itens([
      ['PREFEITURA MUNICIPAL DE SALVADOR', 150, 800],
      ['Número da Nota: 00000071', 400, 780], ['Data de Emissão: 28/09/2026', 400, 768],
      ['PRESTADOR DE SERVIÇOS', 30, 740], ['CPF/CNPJ: 45.112.908/0001-30', 30, 728],
      ['TOMADOR DE SERVIÇOS', 30, 700], ['CPF/CNPJ: 42.246.432/0002-08', 30, 688],
      ['DISCRIMINAÇÃO DOS SERVIÇOS', 30, 660],
      ['VALOR TOTAL DA NOTA = R$ 1.150,00', 30, 600],
    ]));
    expect(l).toMatchObject({ numero: '71', data: '2026-09-28', valorCent: 115000, cnpjPrestador: '45112908000130', cnpjTomador: '42246432000208', chave: null });
  });
});

describe('lerNfsePdf — sem dados', () => {
  it('PDF sem texto reconhecível → leu=false, tudo null', () => {
    const l = lerNfsePdf(itens([['Recibo', 30, 700], ['obrigado', 30, 690]]));
    expect(l).toMatchObject({ numero: null, valorCent: null, leu: false });
  });
});

describe('lerNfsePdf — DANFSe da Reforma Tributária (IBS/CBS), réplica de nota real', () => {
  // Mesmas posições da nota real; o campo "+ IBS/CBS" (R$ 0,00) vem ANTES na lista de propósito.
  const base: Array<[string, number, number]> = [
    ['CHAVE DE ACESSO DA NFS-e', 12, 791], [chave('62362759000171', '13', '2609'), 12, 781],
    ['COMPETÊNCIA DA NFS-e', 156, 771], ['01/09/2026', 156, 763],
    ['DATA E HORA DA EMISSÃO DA NFS-e', 301, 771], ['01/09/2026 17:03:39', 301, 763],
    ['DATA E HORA DA EMISSÃO DA DPS', 301, 751], ['01/09/2026 17:03:39', 301, 743],
    ['EMITENTE DA NFS-e', 12, 730], ['CNPJ / CPF / NIF', 156, 711], ['62.362.759/0001-71', 156, 703],
    ['TOMADOR / ADQUIRENTE', 12, 633], ['CNPJ / CPF / NIF', 156, 634], ['42.246.432/0002-08', 156, 626],
    ['Serviços administrativos prestados de 01/08/2026 - 31/08/2026', 12, 520],
    ['VALOR TOTAL DA NFS-e', 12, 353], ['VALOR DA OPERAÇÃO / SERVIÇO', 156, 354], ['R$ 7.049,87', 156, 347],
  ];
  const ibsAntes: Array<[string, number, number]> = [
    ['VALOR LÍQUIDO DA NFS-e + IBS/CBS', 446, 335], ['R$ 0,00', 446, 327],
    ['VALOR LÍQUIDO DA NFS-e', 156, 335], ['R$ 7.049,87', 156, 327], ['R$ 0,00', 301, 327],
  ];
  it('pega o valor líquido da NFS-e, não o "+ IBS/CBS"', () => {
    expect(lerNfsePdf(itens([...ibsAntes, ...base]))).toMatchObject({
      numero: '13', data: '2026-09-01', valorCent: 704987, cnpjPrestador: '62362759000171', cnpjTomador: '42246432000208',
    });
  });
  it('mesmo com a lista em outra ordem', () => {
    expect(lerNfsePdf(itens([...base, ...ibsAntes].reverse())).valorCent).toBe(704987);
  });
});
