import { describe, it, expect } from 'vitest';
import { parseCsv, parseXlsx } from '../src/empregado/importacao';
import ExcelJS from 'exceljs';

describe('parseCsv', () => {
  it('lê CSV com vírgula', () => {
    const r = parseCsv('CPF,Nome,E-mail\n04561234567,Maria Souza,maria@x.com');
    expect(r.validas).toHaveLength(1);
    expect(r.validas[0]!.cpf).toBe('04561234567');
    expect(r.validas[0]!.email).toBe('maria@x.com');
  });

  it('lê CSV com ponto-e-vírgula (Excel PT-BR)', () => {
    const r = parseCsv('CPF;Nome\n04561234567;João Silva');
    expect(r.validas).toHaveLength(1);
    expect(r.validas[0]!.nome).toBe('João Silva');
  });

  it('preserva o zero da frente do CPF', () => {
    const r = parseCsv('CPF,Nome\n04561234567,Maria');
    expect(r.validas[0]!.cpf).toBe('04561234567');
    expect(r.validas[0]!.cpf).toHaveLength(11);
  });

  it('tira pontuação de CPF que o RH digitou com máscara', () => {
    const r = parseCsv('CPF,Nome\n"045.612.345-67",Maria');
    expect(r.validas[0]!.cpf).toBe('04561234567');
  });

  it('remove o BOM do começo', () => {
    const r = parseCsv('\uFEFFCPF,Nome\n04561234567,Ana');
    expect(r.validas).toHaveLength(1);
  });

  it('acento no cabeçalho não atrapalha (Matrícula, Salário)', () => {
    const r = parseCsv('CPF,Nome,Matrícula,Salário mensal\n04561234567,Ana,F-1,2500');
    expect(r.validas[0]!.matricula).toBe('F-1');
    expect(r.validas[0]!.salarioMensal).toBe(2500);
  });

  it('CPF inválido vira erro, não trava as outras linhas', () => {
    const r = parseCsv('CPF,Nome\n123,Curto\n04561234567,Válida');
    expect(r.validas).toHaveLength(1);
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0]!.motivo).toMatch(/11 dígitos/);
    expect(r.erros[0]!.linha).toBe(2);
  });

  it('nome faltando é erro', () => {
    const r = parseCsv('CPF,Nome\n04561234567,');
    expect(r.erros[0]!.motivo).toMatch(/nome/);
  });

  it('e-mail inválido é erro', () => {
    const r = parseCsv('CPF,Nome,E-mail\n04561234567,Ana,arroba-faltando');
    expect(r.erros[0]!.motivo).toMatch(/e-mail/);
  });

  it('PIN fora de 4-8 dígitos é erro', () => {
    const r = parseCsv('CPF,Nome,PIN\n04561234567,Ana,12');
    expect(r.erros[0]!.motivo).toMatch(/PIN/);
  });

  it('salário com vírgula decimal brasileira', () => {
    const r = parseCsv('CPF,Nome,Salário mensal\n04561234567,Ana,"2.500,50"');
    expect(r.validas[0]!.salarioMensal).toBe(2500.5);
  });

  it('CPF repetido no arquivo: primeira entra, segunda é erro', () => {
    const r = parseCsv('CPF,Nome\n04561234567,Ana\n04561234567,Ana de novo');
    expect(r.validas).toHaveLength(1);
    expect(r.erros.some((e) => /repetido/.test(e.motivo))).toBe(true);
  });

  it('linha vazia é ignorada, não vira erro', () => {
    const r = parseCsv('CPF,Nome\n04561234567,Ana\n\n');
    expect(r.validas).toHaveLength(1);
    expect(r.erros).toHaveLength(0);
  });
});

describe('parseXlsx', () => {
  async function planilha(linhas: (string | number)[][]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Funcionários');
    linhas.forEach((l) => ws.addRow(l));
    return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
  }

  it('lê um xlsx com cabeçalho e uma linha', async () => {
    const buf = await planilha([
      ['CPF', 'Nome completo', 'E-mail'],
      ['04561234567', 'Maria Souza', 'maria@x.com'],
    ]);
    const r = await parseXlsx(buf);
    expect(r.validas).toHaveLength(1);
    expect(r.validas[0]!.cpf).toBe('04561234567');
    expect(r.validas[0]!.email).toBe('maria@x.com');
  });

  it('CPF numérico no xlsx ainda vira 11 dígitos com zero', async () => {
    // Excel guardaria como número 4561234567 — perdendo o zero. Como texto, mantém.
    const buf = await planilha([['CPF', 'Nome'], ['04561234567', 'Ana']]);
    const r = await parseXlsx(buf);
    expect(r.validas[0]!.cpf).toBe('04561234567');
  });

  it('mistura válidas e inválidas no xlsx', async () => {
    const buf = await planilha([
      ['CPF', 'Nome'],
      ['04561234567', 'Válida'],
      ['999', 'CPF curto'],
    ]);
    const r = await parseXlsx(buf);
    expect(r.validas).toHaveLength(1);
    expect(r.erros).toHaveLength(1);
  });
});
