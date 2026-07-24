import { describe, it, expect } from 'vitest';
import { gerarATTR } from '../src/attr/index.js';

const DADOS = {
  desenvolvedor: { razaoSocial: 'TUTTS TECNOLOGIA LTDA', documento: '98765432000188' },
  responsavelLegal: { nome: 'Leonardo Santos', cpf: '12345678901' },
  responsavelTecnico: { nome: 'Leonardo Santos', cpf: '12345678901' },
  programa: { identificador: 'PontoSnap', versao: '1.0.0', numeroInpi: 'BR512024000123-4', certificadoInpi: null },
  destinatario: { razaoSocial: 'CLIENTE EXEMPLO LTDA', documento: '12345678000190' },
  dataEmissao: new Date('2026-07-24T12:00:00Z'),
};

describe('ATTR (art. 89 da Portaria 671/2021)', () => {
  it('gera um PDF válido', async () => {
    const pdf = await gerarATTR(DADOS);
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('funciona com REP-P (equipamento é N/A) e com certificado INPI informado', async () => {
    const semCert = await gerarATTR(DADOS);
    const comCert = await gerarATTR({ ...DADOS, programa: { ...DADOS.programa, certificadoInpi: 'BR51-2024-000123' } });
    expect(comCert.length).not.toBe(semCert.length); // o campo entrou no documento
  });
});
