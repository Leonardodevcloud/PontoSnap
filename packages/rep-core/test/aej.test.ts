import { describe, it, expect } from 'vitest';
import { montarAEJ } from '../src/aej/index.js';
import { TipoIdentificador } from '@ponto/shared';
import type { RepConfig } from '@ponto/shared';

const rep: RepConfig = {
  tipoIdEmpregador: TipoIdentificador.CNPJ,
  documentoEmpregador: '12345678000199',
  razaoSocial: 'Autopeças Central Tutts LTDA',
  numeroInpi: 'BR512024001234-5',
  tipoIdDesenvolvedor: TipoIdentificador.CNPJ,
  documentoDesenvolvedor: '98765432000188',
};

const ptrp = {
  nome: 'Central Tutts Ponto', versao: '1.0.0', tpIdtDesenv: 1,
  idtDesenv: '98765432000188', razaoNome: 'Tutts Tecnologia LTDA', email: 'dev@tutts.com.br',
};

describe('geração do AEJ', () => {
  const { conteudo } = montarAEJ({
    fuso: '-0300',
    rep, ptrp,
    empregados: [{ cpf: '43461292850', nome: 'Maria da Silva' }],
    horarios: [{ codigo: 'CH001', durJornadaMin: 480, pares: [
      { entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }] }],
    tratamentos: [
      { cpf: '43461292850', dtMarcacao: new Date('2026-07-10T08:00:00-0300'), tpMarc: 'E', seqEntSaida: 1, fonteMarc: 'O', codHorContratual: 'CH001' },
      { cpf: '43461292850', dtMarcacao: new Date('2026-07-10T17:00:00-0300'), tpMarc: 'S', seqEntSaida: 2, fonteMarc: 'O' },
    ],
  });
  const linhas = conteudo.toString('latin1').split('\r\n').filter(Boolean);

  it('é delimitado por pipe e começa pelos tipos certos', () => {
    expect(linhas[0]!.startsWith('01|')).toBe(true);
    expect(linhas[1]!.startsWith('02|')).toBe(true);
    expect(linhas.some((l) => l.startsWith('03|'))).toBe(true);
    expect(linhas.some((l) => l.startsWith('04|'))).toBe(true);
    expect(linhas.some((l) => l.startsWith('05|'))).toBe(true);
    expect(linhas.some((l) => l.startsWith('08|'))).toBe(true);
  });

  it('o REP-P é declarado como tipo 3 no registro 02', () => {
    const reg02 = linhas.find((l) => l.startsWith('02|'))!;
    expect(reg02.split('|')[2]).toBe('3');
  });

  it('trailer 99 contabiliza os 2 tratamentos', () => {
    const reg99 = linhas.find((l) => l.startsWith('99|'))!;
    expect(reg99.split('|')[5]).toBe('2'); // qtRegistrosTipo05
  });
});
