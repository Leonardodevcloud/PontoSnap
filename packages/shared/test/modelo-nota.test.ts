import { describe, expect, it } from 'vitest';
import { formatarCodigoServico, lerNfsePdf, lerNfseXml, mesmaDescricao, mesmoCodigoServico, montarDescricaoNota, textoInstrucoesNota, type TextoPdf } from '../src';

const TPL = 'Nota fiscal referente ao serviço prestado de coleta e entrega sob demanda prestado no mês de {mes} ({dias})';
const itens = (l: Array<[string, number, number]>): TextoPdf[] => l.map(([str, x, y]) => ({ str, x, y, w: str.length * 4.2, pagina: 1 }));

describe('modelo de nota', () => {
  it('monta o exemplo real com os dias trabalhados', () => {
    expect(montarDescricaoNota(TPL, { competencia: '2026-10', periodo: '2026-10-12', dias: ['2026-10-16', '2026-10-13'], nome: 'Carlos', valorCent: 122976 }))
      .toBe('Nota fiscal referente ao serviço prestado de coleta e entrega sob demanda prestado no mês de Outubro (13/10 e 16/10)');
  });
  it('sem dias marcados usa o período da semana; mês inteiro usa mês/ano', () => {
    expect(montarDescricaoNota('({dias})', { competencia: '2026-10', periodo: '2026-10-12', nome: 'C', valorCent: 1 })).toBe('(12/10 a 18/10)');
    expect(montarDescricaoNota('{periodo} · {valor} · {funcao}', { competencia: '2026-10', periodo: 'MES', nome: 'C', funcao: 'Operador', valorCent: 122976 })).toBe('outubro/2026 · R$ 1.229,76 · Operador');
    expect(montarDescricaoNota('a {xyz} b', { competencia: '2026-10', periodo: 'MES', nome: 'C', valorCent: 1 })).toBe('a {xyz} b');
  });
  it('semana recortada no mês: começa na quinta 01/10 e vai até o domingo; a última termina no dia 31', () => {
    expect(montarDescricaoNota('{semana}', { competencia: '2026-10', periodo: '2026-10-01', nome: 'C', valorCent: 1 })).toBe('01/10 a 04/10');
    expect(montarDescricaoNota('{semana}', { competencia: '2026-10', periodo: '2026-10-26', nome: 'C', valorCent: 1 })).toBe('26/10 a 31/10');
  });
  it('texto para copiar segue o formato do RH', () => {
    const t = textoInstrucoesNota({ modeloId: 'm', modeloNome: 'M', tomador: { cnpj: '42246432000127', razao: 'Tuts', endereco: 'Rua X', telefone: '(71) 9', email: 'a@b.c' },
      codigoServico: '26.01.01', codigoDescricao: 'Coleta', descricao: 'Desc', observacao: null, valorCent: 122976 });
    expect(t).toContain('* CNPJ: 42.246.432/0001-27');
    expect(t).toContain('* CNAE: 26.01.01 - Coleta');
    expect(t).toContain('* Valor: R$ 1.229,76');
  });
  it('código e descrição: comparação tolerante', () => {
    expect(formatarCodigoServico('260101')).toBe('26.01.01');
    expect(mesmoCodigoServico('26.01.01', '260101')).toBe(true);
    expect(mesmoCodigoServico('26.01', '26.01.01')).toBe(true);
    expect(mesmoCodigoServico('17.02.01', '26.01.01')).toBe(false);
    expect(mesmaDescricao('Prestado no mês de Outubro (13/10 e 16/10)', 'PRESTADO NO MES DE OUTUBRO 13/10 E 16/10')).toBe(true);
    expect(mesmaDescricao('Prestado no mês de Outubro (13/10 e 16/10)', 'prestado no mês de Outubro')).toBe(false);
  });
  it('lê código e descrição do XML nacional e do DANFSe', () => {
    const xml = '<NFSe><infNFSe><nNFSe>13</nNFSe><DPS><infDPS><serv><cServ><cTribNac>260101</cTribNac><xDescServ>Coleta e entrega  de Outubro</xDescServ></cServ></serv></infDPS></DPS></infNFSe></NFSe>';
    expect(lerNfseXml(xml)).toMatchObject({ codigoServico: '26.01.01', descricao: 'Coleta e entrega de Outubro' });
    const pdf = lerNfsePdf(itens([
      ['SERVIÇO PRESTADO', 12, 560],
      ['Código de Tributação Nacional', 12, 550], ['Código de Tributação Municipal', 156, 550], ['Local da Prestação', 301, 550],
      ['26.01.01 - Serviços de coleta, remessa ou entrega de correspondência', 12, 542], ['001', 156, 542], ['Barueri - SP', 301, 542],
      ['Descrição do Serviço', 12, 530],
      ['Nota fiscal referente ao serviço prestado de coleta e entrega sob', 12, 522],
      ['demanda prestado no mês de Outubro (13/10 e 16/10)', 12, 514],
      ['TRIBUTAÇÃO MUNICIPAL', 12, 490], ['Tributação do ISSQN', 12, 480],
    ]));
    expect(pdf.codigoServico).toBe('26.01.01');
    expect(pdf.descricao).toBe('Nota fiscal referente ao serviço prestado de coleta e entrega sob demanda prestado no mês de Outubro (13/10 e 16/10)');
  });
});
