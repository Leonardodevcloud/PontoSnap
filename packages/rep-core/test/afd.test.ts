import { describe, it, expect } from 'vitest';
import { montarAFD } from '../src/afd/index.js';
import { proximaMarcacao } from '../src/hash-chain/index.js';
import { Coletor, OnlineOffline, TipoIdentificador } from '@ponto/shared';
import type { MarcacaoGravada, RepConfig } from '@ponto/shared';

const rep: RepConfig = {
  tipoIdEmpregador: TipoIdentificador.CNPJ,
  documentoEmpregador: '12345678000199',
  razaoSocial: 'Autopeças Central Tutts LTDA',
  numeroInpi: 'BR512024001234-5',
  tipoIdDesenvolvedor: TipoIdentificador.CNPJ,
  documentoDesenvolvedor: '98765432000188',
};

function marcacoes(): MarcacaoGravada[] {
  const m = proximaMarcacao({
    cpf: '43461292850', dtMarcacao: new Date('2026-07-10T08:00:00-0300'),
    dtGravacao: new Date('2026-07-10T08:00:00-0300'),
    coletor: Coletor.MOBILE, onlineOffline: OnlineOffline.ONLINE,
  }, null, '-0300');
  return [m];
}

describe('geração do AFD', () => {
  const { conteudo, nomeArquivo } = montarAFD({ rep, marcacoes: marcacoes(), fuso: '-0300' });
  const linhas = conteudo.toString('latin1').split('\r\n').filter(Boolean);

  it('cada tipo de registro tem a largura exata do leiaute', () => {
    expect(linhas[0]).toHaveLength(302);                 // cabeçalho
    expect(linhas[1]).toHaveLength(137);                 // marcação tipo 7
    expect(linhas[linhas.length - 2]).toHaveLength(64);  // trailer
    expect(linhas[linhas.length - 1]).toHaveLength(100); // assinatura
  });

  it('cabeçalho começa com 000000000 e trailer com 999999999', () => {
    expect(linhas[0]!.startsWith('000000000')).toBe(true);
    expect(linhas[linhas.length - 2]!.startsWith('999999999')).toBe(true);
  });

  it('nome do arquivo segue o padrão REP-P', () => {
    expect(nomeArquivo).toBe('AFD512024001234512345678000199REP_P.txt');
  });

  it('termina cada linha com CR LF', () => {
    expect(conteudo.includes(Buffer.from([13, 10]))).toBe(true);
  });
});
