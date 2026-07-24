import type { RepConfig, MarcacaoGravada } from '@ponto/shared';
import { formatarDataHoraAFD, dataD, soDigitos } from '../datetime.js';

/** CRC-16/KERMIT (CCITT-TRUE). Autoteste: "123456789" -> "2189". */
export function crc16Kermit(str: string): string {
  let crc = 0;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) & 0xff;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? (crc >>> 1) ^ 0x8408 : (crc >>> 1);
    }
  }
  return (crc & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}

// Autoteste em tempo de carga do módulo.
if (crc16Kermit('123456789') !== '2189') {
  throw new Error('CRC-16/KERMIT quebrado — autoteste falhou');
}

const alfa = (v: unknown, tam: number): string => String(v ?? '').slice(0, tam).padEnd(tam, ' ');
const num = (v: unknown, tam: number): string => soDigitos(v).slice(-tam).padStart(tam, '0');
const comCRC = (conteudo: string): string => conteudo + crc16Kermit(conteudo);

/** Registro tipo "1" — Cabeçalho (302 chars). */
export function registro1(rep: RepConfig, dataInicial: Date, dataFinal: Date, dataGeracao: Date, fuso = '-0300'): string {
  const conteudo =
    num('0', 9) +                                       // 1  "000000000"
    '1' +                                               // 2  tipo
    String(rep.tipoIdEmpregador) +                      // 3  1=CNPJ 2=CPF
    num(rep.documentoEmpregador, 14) +                  // 4  doc empregador
    (rep.cnoCaepf ? num(rep.cnoCaepf, 14) : alfa('', 14)) + // 5  CNO/CAEPF
    alfa(rep.razaoSocial, 150) +                        // 6  razão social
    num(rep.numeroInpi, 17) +                           // 7  nº INPI (campo N: só dígitos)
    dataD(dataInicial) +                                // 8  data inicial
    dataD(dataFinal) +                                  // 9  data final
    formatarDataHoraAFD(dataGeracao, fuso) +            // 10 geração
    '003' +                                             // 11 versão
    String(rep.tipoIdDesenvolvedor) +                   // 12
    num(rep.documentoDesenvolvedor, 14) +               // 13 doc desenvolvedor
    alfa('', 30);                                       // 14 modelo (vazio REP-P)
  return comCRC(conteudo);                              // 15 CRC-16
}

/** Registro tipo "7" — Marcação REP-P (137 chars, sem CRC). */
export function registro7(m: MarcacaoGravada): string {
  // Fuso da PRÓPRIA marcação: tem de bater com o usado no hash imutável.
  const fuso = m.fuso ?? '-0300';
  return num(m.nsr, 9) + '7' +
    formatarDataHoraAFD(m.dtMarcacao, fuso) +
    num(m.cpf, 12) +
    formatarDataHoraAFD(m.dtGravacao, fuso) +
    num(m.coletor, 2) +
    String(m.onlineOffline) +
    alfa(m.hashRegistro, 64);
}

/**
 * Registro tipo "2" — Inclusão ou alteração da identificação da empresa no
 * REP (331 chars, com CRC).
 */
export interface EventoEmpresaAFD {
  nsr: number; dtGravacao: Date; fuso?: string;
  docResponsavel?: string | null;
  tipoIdEmpregador: number; documentoEmpregador: string;
  cnoCaepf?: string | null; razaoSocial: string; localPrestacao?: string | null;
}
export function registro2(e: EventoEmpresaAFD): string {
  const fuso = e.fuso ?? '-0300';
  const conteudo =
    num(e.nsr, 9) +                                        // 1  NSR
    '2' +                                                   // 2  tipo
    formatarDataHoraAFD(e.dtGravacao, fuso) +               // 3  gravação
    num(e.docResponsavel ?? '', 14) +                       // 4  CPF do responsável
    String(e.tipoIdEmpregador) +                            // 5  1=CNPJ 2=CPF
    num(e.documentoEmpregador, 14) +                        // 6  doc do empregador
    (e.cnoCaepf ? num(e.cnoCaepf, 14) : alfa('', 14)) +     // 7  CNO/CAEPF
    alfa(e.razaoSocial, 150) +                              // 8  razão social
    alfa(e.localPrestacao ?? '', 100);                      // 9  local de prestação
  return comCRC(conteudo);                                  // 10 CRC-16
}

/**
 * Registro tipo "5" — Inclusão, alteração ou exclusão de empregado no REP
 * (118 chars, com CRC).
 */
export interface EventoEmpregadoAFD {
  nsr: number; dtGravacao: Date; fuso?: string;
  operacao: 'I' | 'A' | 'E';
  cpf: string; nome: string;
  dadosIdentificacao?: string | null;
  docResponsavel?: string | null;
}
export function registro5(e: EventoEmpregadoAFD): string {
  const fuso = e.fuso ?? '-0300';
  const conteudo =
    num(e.nsr, 9) +                                        // 1  NSR
    '5' +                                                   // 2  tipo
    formatarDataHoraAFD(e.dtGravacao, fuso) +               // 3  gravação
    e.operacao +                                            // 4  I / A / E
    num(e.cpf, 12) +                                        // 5  CPF do empregado
    alfa(e.nome, 52) +                                      // 6  nome
    alfa(e.dadosIdentificacao ?? '', 4) +                   // 7  demais dados
    num(e.docResponsavel ?? '', 11);                        // 8  CPF do responsável
  return comCRC(conteudo);                                  // 9  CRC-16
}

/**
 * Registro tipo "6" — Eventos sensíveis (36 chars, SEM CRC: a regra 8 do
 * leiaute manda gravar CRC só nos tipos "1" a "5").
 * No REP-P valem "07" (disponibilidade) e "08" (indisponibilidade de serviço).
 */
export const EVENTO_DISPONIVEL = 7;
export const EVENTO_INDISPONIVEL = 8;
export interface EventoSensivelAFD { nsr: number; dtGravacao: Date; tipoEvento: number; fuso?: string; }
export function registro6(e: EventoSensivelAFD): string {
  return num(e.nsr, 9) + '6' +
    formatarDataHoraAFD(e.dtGravacao, e.fuso ?? '-0300') +
    num(e.tipoEvento, 2);
}

export interface ContadoresAFD { t2: number; t3: number; t4: number; t5: number; t6: number; t7: number; }

/** Registro tipo "9" — Trailer (64 chars, sem CRC). */
export function registro9(c: ContadoresAFD): string {
  return '999999999' +
    num(c.t2, 9) + num(c.t3, 9) + num(c.t4, 9) +
    num(c.t5, 9) + num(c.t6, 9) + num(c.t7, 9) + '9';
}

/** Linha de assinatura (100 chars). No REP-P, texto literal (.p7s à parte). */
export function registroAssinatura(): string {
  return alfa('ASSINATURA_DIGITAL_EM_ARQUIVO_P7S', 100);
}

export interface EventosAFD {
  empresa?: EventoEmpresaAFD[];
  empregado?: EventoEmpregadoAFD[];
  sensivel?: EventoSensivelAFD[];
}

export interface MontarAFDParams {
  rep: RepConfig;
  marcacoes: MarcacaoGravada[];
  /** Registros 2, 5 e 6 — compartilham a MESMA sequência de NSR das marcações. */
  eventos?: EventosAFD;
  dataGeracao?: Date;
  /** Fuso atual do tenant — só para o cabeçalho (data de geração). Cada
   *  marcação carrega o seu próprio fuso no registro 7. */
  fuso?: string;
}

export interface ArquivoGerado {
  conteudo: Buffer;
  nomeArquivo: string;
  totalRegistros: number;
}

export function montarAFD({ rep, marcacoes, eventos = {}, dataGeracao = new Date(), fuso = '-0300' }: MontarAFDParams): ArquivoGerado {
  const datas = marcacoes.map((m) => m.dtMarcacao).sort((a, b) => a.getTime() - b.getTime());
  const dataInicial = datas[0] ?? dataGeracao;
  const dataFinal = datas[datas.length - 1] ?? dataGeracao;

  // Regra 4 do leiaute: os registros saem ordenados pelo NSR — e o NSR é uma
  // sequência única, então marcações e eventos se intercalam por ele.
  const corpo: { nsr: number; linha: string }[] = [
    ...marcacoes.map((m) => ({ nsr: Number(m.nsr), linha: registro7(m) })),
    ...(eventos.empresa ?? []).map((e) => ({ nsr: Number(e.nsr), linha: registro2(e) })),
    ...(eventos.empregado ?? []).map((e) => ({ nsr: Number(e.nsr), linha: registro5(e) })),
    ...(eventos.sensivel ?? []).map((e) => ({ nsr: Number(e.nsr), linha: registro6(e) })),
  ].sort((a, b) => a.nsr - b.nsr);

  const linhas: string[] = [registro1(rep, dataInicial, dataFinal, dataGeracao, fuso)];
  for (const r of corpo) linhas.push(r.linha);
  linhas.push(registro9({
    t2: eventos.empresa?.length ?? 0,
    t3: 0,
    t4: 0,
    t5: eventos.empregado?.length ?? 0,
    t6: eventos.sensivel?.length ?? 0,
    t7: marcacoes.length,
  }));
  linhas.push(registroAssinatura());

  const texto = linhas.map((l) => l + '\r\n').join('');
  const nomeArquivo = 'AFD' + soDigitos(rep.numeroInpi) + soDigitos(rep.documentoEmpregador) + 'REP_P.txt';
  return { conteudo: Buffer.from(texto, 'latin1'), nomeArquivo, totalRegistros: linhas.length };
}
