import { describe, it, expect } from 'vitest';
import { montarAFD, montarAEJ, crc16Kermit } from '../src/index.js';
import type { RepConfig, MarcacaoGravada } from '@ponto/shared';

/**
 * CONFORMIDADE COM O LEIAUTE OFICIAL — Portaria MTP 671/2021.
 *
 * Conferido contra os PDFs publicados no portal gov.br:
 *   · leiaute-do-arquivo-fonte-de-dados-afd.pdf (Anexo V, versão "003")
 *   · leiaute-do-arquivo-eletronico-de-jornada-aej.pdf (Anexo VI, versão "001")
 *
 * Este teste existe porque o AFD é IMUTÁVEL: arquivo gerado com campo errado
 * não tem conserto depois. Se alguém mexer no gerador e sair do leiaute, aqui
 * quebra antes de chegar em cliente.
 */

const REP: RepConfig = {
  tipoIdEmpregador: 1,
  documentoEmpregador: '12345678000190',
  cnoCaepf: null,
  razaoSocial: 'EMPRESA TESTE LTDA',
  numeroInpi: 'BR512024000123-4',
  tipoIdDesenvolvedor: 1,
  documentoDesenvolvedor: '98765432000188',
};

const marcacao = (nsr: number, iso: string, cpf = '12345678901'): MarcacaoGravada => ({
  nsr, cpf, dtMarcacao: new Date(iso), dtGravacao: new Date(iso),
  coletor: 1, onlineOffline: 0, hashRegistro: 'A'.repeat(64), fuso: '-0300',
} as MarcacaoGravada);

/** DH do leiaute: "AAAA-MM-ddThh:mm:00ZZZZZ" — 24 posições. */
const DH = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{4}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function linhasAFD() {
  const { conteudo } = montarAFD({
    fuso: '-0300',
    rep: REP,
    marcacoes: [marcacao(1, '2026-07-13T11:00:00Z'), marcacao(2, '2026-07-13T15:00:00Z')],
    dataGeracao: new Date('2026-07-14T10:00:00Z') });
  const texto = conteudo.toString('latin1');
  return { texto, linhas: texto.split('\r\n').filter((l) => l.length > 0) };
}

describe('AFD — leiaute oficial (Anexo V)', () => {
  it('é ISO-8859-1, uma linha por registro, terminadas em CR+LF, sem linhas em branco', () => {
    const { texto } = linhasAFD();
    expect(texto.endsWith('\r\n')).toBe(true);
    // toda quebra de linha é precedida de CR
    expect(texto.split('\n').every((p, i, arr) => i === arr.length - 1 || p.endsWith('\r'))).toBe(true);
    expect(texto).not.toMatch(/\r\n\r\n/); // sem linha em branco
  });

  it('registro 1 (cabeçalho) tem 302 posições e os campos no lugar', () => {
    const [cab] = linhasAFD().linhas;
    expect(cab!.length).toBe(302);
    expect(cab!.slice(0, 9)).toBe('000000000');         // 1
    expect(cab!.slice(9, 10)).toBe('1');                 // 2 tipo
    expect(cab!.slice(10, 11)).toBe('1');                // 3 tpIdtEmpregador
    expect(cab!.slice(11, 25)).toBe('12345678000190');   // 4 doc empregador (14 N)
    expect(cab!.slice(39, 189).trimEnd()).toBe('EMPRESA TESTE LTDA'); // 6 razão (150 A)
    expect(cab!.slice(189, 206)).toMatch(/^\d{17}$/);    // 7 INPI — campo N
    expect(cab!.slice(206, 216)).toMatch(DATA);          // 8 data inicial
    expect(cab!.slice(216, 226)).toMatch(DATA);          // 9 data final
    expect(cab!.slice(226, 250)).toMatch(DH);            // 10 geração
    expect(cab!.slice(250, 253)).toBe('003');            // 11 versão do leiaute
    expect(cab!.slice(253, 254)).toBe('1');              // 12 tpIdtDesenvolvedor
    expect(cab!.slice(254, 268)).toBe('98765432000188'); // 13 doc desenvolvedor
    expect(cab!.slice(268, 298)).toBe(' '.repeat(30));   // 14 modelo (só REP-C)
  });

  it('registro 1 fecha com CRC-16/KERMIT correto', () => {
    const [cab] = linhasAFD().linhas;
    expect(cab!.slice(298, 302)).toBe(crc16Kermit(cab!.slice(0, 298)));
  });

  it('registro 7 (marcação REP-P) tem 137 posições e campos válidos', () => {
    const marcs = linhasAFD().linhas.filter((l) => l[9] === '7');
    expect(marcs.length).toBe(2);
    for (const m of marcs) {
      expect(m.length).toBe(137);
      expect(m.slice(0, 9)).toMatch(/^\d{9}$/);      // 1 NSR
      expect(m.slice(9, 10)).toBe('7');               // 2 tipo
      expect(m.slice(10, 34)).toMatch(DH);            // 3 data/hora da marcação
      expect(m.slice(34, 46)).toMatch(/^\d{12}$/);    // 4 CPF (12 N)
      expect(m.slice(46, 70)).toMatch(DH);            // 5 data/hora da gravação
      expect(m.slice(70, 72)).toMatch(/^\d{2}$/);     // 6 coletor
      expect(m.slice(72, 73)).toMatch(/^[01]$/);      // 7 online/offline
      expect(m.slice(73, 137)).toMatch(/^[0-9A-F]{64}$/); // 8 hash SHA-256
    }
  });

  it('NSR é sequencial, sem lacunas e em ordem', () => {
    const nsrs = linhasAFD().linhas.filter((l) => l[9] === '7').map((l) => Number(l.slice(0, 9)));
    expect(nsrs).toEqual([1, 2]);
  });

  it('registro 9 (trailer) tem 64 posições e conta os registros', () => {
    const { linhas } = linhasAFD();
    const tr = linhas.find((l) => l.startsWith('999999999'))!;
    expect(tr.length).toBe(64);
    expect(tr.slice(0, 9)).toBe('999999999');
    expect(tr.slice(54, 63)).toBe('000000002'); // qt de registros tipo 7
    expect(tr.slice(63, 64)).toBe('9');
  });

  it('linha de assinatura tem 100 posições com o texto literal do REP-P', () => {
    const { linhas } = linhasAFD();
    const ass = linhas[linhas.length - 1]!;
    expect(ass.length).toBe(100);
    expect(ass.trimEnd()).toBe('ASSINATURA_DIGITAL_EM_ARQUIVO_P7S');
  });

  it('nome do arquivo segue "AFD" + INPI + documento do empregador + REP_P', () => {
    const { nomeArquivo } = montarAFD({ rep: REP, marcacoes: [marcacao(1, '2026-07-13T11:00:00Z')], fuso: '-0300' });
    expect(nomeArquivo).toBe('AFD5120240001234' + '12345678000190' + 'REP_P.txt');
  });
});

// ---------------------------------------------------------------------------

function gerarAEJ() {
  const { conteudo } = montarAEJ({
    fuso: '-0300',
    rep: REP,
    ptrp: { nome: 'PontoSnap', versao: '1.0.0', tpIdtDesenv: 1, idtDesenv: '98765432000188', razaoNome: 'TUTTS LTDA', email: 'contato@pontosnap.online' },
    empregados: [{ cpf: '12345678901', nome: 'FULANO DE TAL' }],
    horarios: [{ codigo: 'ADM', durJornadaMin: 480, pares: [{ entrada: '0800', saida: '1200' }, { entrada: '1300', saida: '1700' }] }],
    tratamentos: [
      { cpf: '12345678901', dtMarcacao: new Date('2026-07-13T11:00:00Z'), tpMarc: 'E', seqEntSaida: 1, fonteMarc: 'O', codHorContratual: 'ADM' },
      { cpf: '12345678901', dtMarcacao: new Date('2026-07-13T15:00:00Z'), tpMarc: 'S', seqEntSaida: 1, fonteMarc: 'O' },
      { cpf: '12345678901', dtMarcacao: new Date('2026-07-13T15:01:00Z'), tpMarc: 'D', seqEntSaida: 0, fonteMarc: 'O', motivo: 'Batida duplicada' },
      { cpf: '12345678901', dtMarcacao: new Date('2026-07-13T20:00:00Z'), tpMarc: 'S', seqEntSaida: 2, fonteMarc: 'I', motivo: 'Esqueceu de bater' },
    ],
    ausencias: [
      { cpf: '12345678901', tipo: 3, data: new Date('2026-07-13T12:00:00Z'), qtMinutos: 60, tipoMovBH: 1 },
      { cpf: '12345678901', tipo: 1, data: new Date('2026-07-12T12:00:00Z') },
    ],
    dataGeracao: new Date('2026-07-14T10:00:00Z'),
  });
  const texto = conteudo.toString('latin1');
  return { texto, linhas: texto.split('\r\n').filter((l) => l.length > 0) };
}

const campos = (l: string) => l.split('|');

describe('AEJ — leiaute oficial (Anexo VI)', () => {
  it('linhas terminam em CR+LF, sem linhas em branco', () => {
    const { texto } = gerarAEJ();
    expect(texto.endsWith('\r\n')).toBe(true);
    expect(texto).not.toMatch(/\r\n\r\n/);
  });

  it('registro 01 (cabeçalho) tem 10 campos e versão "001"', () => {
    const c = campos(gerarAEJ().linhas[0]!);
    expect(c.length).toBe(10);
    expect(c[0]).toBe('01');
    expect(c[1]).toBe('1');                  // tpIdtEmpregador
    expect(c[2]).toBe('12345678000190');
    expect(c[6]).toMatch(DATA);              // dataInicialAej
    expect(c[7]).toMatch(DATA);              // dataFinalAej
    expect(c[8]).toMatch(DH);                // dataHoraGerAej
    expect(c[9]).toBe('001');                // versaoAej
  });

  it('registro 02 identifica o REP como REP-P ("3")', () => {
    const c = campos(gerarAEJ().linhas.find((l) => l.startsWith('02|'))!);
    expect(c.length).toBe(4);
    expect(c[2]).toBe('3');                  // tpRep: 3 = REP-P
    expect(c[3]!.length).toBeLessThanOrEqual(17);
  });

  it('registro 03 (vínculo) tem 4 campos e CPF com 11 dígitos', () => {
    const c = campos(gerarAEJ().linhas.find((l) => l.startsWith('03|'))!);
    expect(c.length).toBe(4);
    expect(c[2]).toMatch(/^\d{11}$/);
  });

  it('registro 04 traz os pares entrada/saída em sequência', () => {
    const c = campos(gerarAEJ().linhas.find((l) => l.startsWith('04|'))!);
    expect(c.length).toBe(7);                // tipo, cod, dur, e1, s1, e2, s2
    expect(c[2]).toBe('480');                // durJornada em minutos
    for (const h of [c[3], c[4], c[5], c[6]]) expect(h).toMatch(/^\d{4}$/);
  });

  it('registro 05 (marcações): 9 campos, tpMarc e fonteMarc válidos, seqEntSaida com 3 dígitos', () => {
    const marcs = gerarAEJ().linhas.filter((l) => l.startsWith('05|'));
    expect(marcs.length).toBe(4);
    for (const l of marcs) {
      const c = campos(l);
      expect(c.length).toBe(9);
      expect(c[2]).toMatch(DH);              // dataHoraMarc
      expect(['E', 'S', 'D']).toContain(c[4]);
      expect(c[5]).toMatch(/^\d{3}$/);       // seqEntSaida — 3 posições
      expect(['O', 'I', 'P', 'X', 'T']).toContain(c[6]);
    }
  });

  it('registro 05 exige motivo quando a marcação é D (desconsiderada) ou I (incluída)', () => {
    for (const l of gerarAEJ().linhas.filter((l) => l.startsWith('05|'))) {
      const c = campos(l);
      if (c[4] === 'D' || c[6] === 'I') expect(c[8]!.length).toBeGreaterThan(0);
    }
  });

  it('registro 05 informa o horário contratual na primeira entrada', () => {
    const primeira = campos(gerarAEJ().linhas.filter((l) => l.startsWith('05|'))
      .find((l) => campos(l)[4] === 'E' && campos(l)[5] === '001')!);
    expect(primeira[7]!.length).toBeGreaterThan(0);
  });

  it('registro 07: tipoAusenOuComp só aceita 1..4 e banco de horas é "3"', () => {
    const aus = gerarAEJ().linhas.filter((l) => l.startsWith('07|'));
    expect(aus.length).toBe(2);
    for (const l of aus) {
      const c = campos(l);
      expect(c.length).toBe(6);
      expect(['1', '2', '3', '4']).toContain(c[2]);
      expect(c[3]).toMatch(DATA);
      if (c[2] === '3') {
        // qtMinutos e tipoMovBH são obrigatórios no movimento de banco
        expect(c[4]).toMatch(/^\d+$/);
        expect(['1', '2']).toContain(c[5]);
      }
    }
    const banco = aus.map(campos).find((c) => c[2] === '3');
    expect(banco, 'movimento de banco de horas deve sair com tipo "3"').toBeDefined();
    expect(banco![4]).toBe('60');
    expect(banco![5]).toBe('1'); // 1 = inclusão de horas no banco
  });

  it('registro 08 identifica o PTRP com 7 campos', () => {
    const c = campos(gerarAEJ().linhas.find((l) => l.startsWith('08|'))!);
    expect(c.length).toBe(7);
    expect(c[3]).toBe('1');                  // tpIdtDesenv
    expect(c[4]).toMatch(/^\d{14}$/);
  });

  it('registro 99 (trailer) confere com a contagem real de cada tipo', () => {
    const { linhas } = gerarAEJ();
    const tr = campos(linhas.find((l) => l.startsWith('99|'))!);
    expect(tr.length).toBe(9);
    const conta = (t: string) => linhas.filter((l) => l.startsWith(`${t}|`)).length;
    expect(Number(tr[1])).toBe(conta('01'));
    expect(Number(tr[2])).toBe(conta('02'));
    expect(Number(tr[3])).toBe(conta('03'));
    expect(Number(tr[4])).toBe(conta('04'));
    expect(Number(tr[5])).toBe(conta('05'));
    expect(Number(tr[6])).toBe(conta('06'));
    expect(Number(tr[7])).toBe(conta('07'));
    expect(Number(tr[8])).toBe(conta('08'));
  });

  it('assinatura tem 100 posições com o texto literal', () => {
    const { linhas } = gerarAEJ();
    const ass = linhas[linhas.length - 1]!;
    expect(ass.length).toBe(100);
    expect(ass.trimEnd()).toBe('ASSINATURA_DIGITAL_EM_ARQUIVO_P7S');
  });
});

describe('o gerador RECUSA arquivo fora do leiaute', () => {
  const base = {
    fuso: '-0300',
    rep: REP,
    ptrp: { nome: 'PontoSnap', versao: '1.0.0', tpIdtDesenv: 1, idtDesenv: '98765432000188', razaoNome: 'TUTTS LTDA', email: 'a@b.com' },
    empregados: [{ cpf: '12345678901', nome: 'FULANO' }],
  };

  it('tipoAusenOuComp fora de 1..4 (era esse o bug: banco saía como "5")', () => {
    expect(() => montarAEJ({ ...base, ausencias: [{ cpf: '12345678901', tipo: 5, data: new Date(), qtMinutos: 60, tipoMovBH: 1 }] }))
      .toThrow(/tipoAusenOuComp/);
  });

  it('movimento de banco sem qtMinutos ou sem tipoMovBH', () => {
    expect(() => montarAEJ({ ...base, ausencias: [{ cpf: '12345678901', tipo: 3, data: new Date() }] })).toThrow(/qtMinutos/);
    expect(() => montarAEJ({ ...base, ausencias: [{ cpf: '12345678901', tipo: 3, data: new Date(), qtMinutos: 60 }] })).toThrow(/tipoMovBH/);
  });

  it('tpMarc ou fonteMarc fora dos valores previstos', () => {
    const m = { cpf: '12345678901', dtMarcacao: new Date(), seqEntSaida: 1 };
    expect(() => montarAEJ({ ...base, tratamentos: [{ ...m, tpMarc: 'X' }] })).toThrow(/tpMarc/);
    expect(() => montarAEJ({ ...base, tratamentos: [{ ...m, tpMarc: 'E', fonteMarc: 'Z' }] })).toThrow(/fonteMarc/);
  });

  it('marcação desconsiderada ou incluída sem motivo', () => {
    const m = { cpf: '12345678901', dtMarcacao: new Date(), seqEntSaida: 1 };
    expect(() => montarAEJ({ ...base, tratamentos: [{ ...m, tpMarc: 'D' }] })).toThrow(/motivo/);
    expect(() => montarAEJ({ ...base, tratamentos: [{ ...m, tpMarc: 'S', fonteMarc: 'I' }] })).toThrow(/motivo/);
  });
});
