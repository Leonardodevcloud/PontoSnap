import type { RepConfig } from '@ponto/shared';
import { formatarDataHoraAFD, dataD } from '../datetime.js';

export interface EmpregadoAEJ { cpf: string; nome: string; matriculaEsocial?: string | null; }
export interface ParEntradaSaida { entrada: string; saida: string; }
export interface HorarioAEJ { codigo: string; durJornadaMin: number; pares: ParEntradaSaida[]; }
export interface TratamentoAEJ {
  cpf: string; dtMarcacao: Date; tpMarc: string; seqEntSaida: number;
  fonteMarc?: string; codHorContratual?: string | null; motivo?: string | null;
}
export interface AusenciaAEJ {
  cpf: string; tipo: number; data: Date; qtMinutos?: number | null; tipoMovBH?: number | null;
}
export interface PtrpInfo {
  nome: string; versao: string; tpIdtDesenv: number; idtDesenv: string; razaoNome: string; email: string;
}
export interface MontarAEJParams {
  rep: RepConfig; ptrp: PtrpInfo;
  empregados?: EmpregadoAEJ[]; horarios?: HorarioAEJ[];
  tratamentos?: TratamentoAEJ[]; ausencias?: AusenciaAEJ[];
  dataGeracao?: Date;
  /** Fuso do tenant para formatar as datas do arquivo. */
  fuso?: string;
}

const soDig = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const linha = (...campos: unknown[]): string =>
  campos.map((c) => (c === null || c === undefined ? '' : String(c))).join('|');

export function montarAEJ(p: MontarAEJParams): { conteudo: Buffer; nomeArquivo: string; totalRegistros: number } {
  const { rep, ptrp, empregados = [], horarios = [], tratamentos = [], ausencias = [], dataGeracao = new Date(), fuso = '-0300' } = p;
  const linhas: string[] = [];
  const cont = { t1: 0, t2: 0, t3: 0, t4: 0, t5: 0, t6: 0, t7: 0, t8: 0 };

  const idRepAej = 1;
  const vinculoPorCpf = new Map<string, number>();
  empregados.forEach((e, i) => vinculoPorCpf.set(soDig(e.cpf), i + 1));

  const datas = tratamentos.map((t) => t.dtMarcacao).sort((a, b) => a.getTime() - b.getTime());
  const dataInicial = datas[0] ?? dataGeracao;
  const dataFinal = datas[datas.length - 1] ?? dataGeracao;

  linhas.push(linha('01', rep.tipoIdEmpregador, rep.documentoEmpregador, rep.cnoCaepf ?? '', '',
    rep.razaoSocial, dataD(dataInicial), dataD(dataFinal), formatarDataHoraAFD(dataGeracao, fuso), '001')); cont.t1++;

  linhas.push(linha('02', idRepAej, '3', rep.numeroInpi)); cont.t2++;

  for (const e of empregados) {
    linhas.push(linha('03', vinculoPorCpf.get(soDig(e.cpf)), soDig(e.cpf), e.nome)); cont.t3++;
  }
  for (const h of horarios) {
    const pares: string[] = [];
    for (const par of h.pares) { pares.push(par.entrada, par.saida); }
    linhas.push(linha('04', h.codigo, h.durJornadaMin, ...pares)); cont.t4++;
  }
  for (const t of tratamentos) {
    linhas.push(linha('05', vinculoPorCpf.get(soDig(t.cpf)), formatarDataHoraAFD(t.dtMarcacao, fuso), idRepAej,
      t.tpMarc, t.seqEntSaida, t.fonteMarc ?? 'O', t.codHorContratual ?? '', t.motivo ?? '')); cont.t5++;
  }
  for (const e of empregados) {
    if (e.matriculaEsocial) {
      linhas.push(linha('06', vinculoPorCpf.get(soDig(e.cpf)), e.matriculaEsocial)); cont.t6++;
    }
  }
  for (const a of ausencias) {
    linhas.push(linha('07', vinculoPorCpf.get(soDig(a.cpf)), a.tipo, dataD(a.data),
      a.qtMinutos ?? '', a.tipoMovBH ?? '')); cont.t7++;
  }
  linhas.push(linha('08', ptrp.nome, ptrp.versao, ptrp.tpIdtDesenv, ptrp.idtDesenv, ptrp.razaoNome, ptrp.email)); cont.t8++;

  linhas.push(linha('99', cont.t1, cont.t2, cont.t3, cont.t4, cont.t5, cont.t6, cont.t7, cont.t8));
  linhas.push('ASSINATURA_DIGITAL_EM_ARQUIVO_P7S'.padEnd(100, ' '));

  const texto = linhas.map((l) => l + '\r\n').join('');
  return { conteudo: Buffer.from(texto, 'latin1'), nomeArquivo: 'AEJ.txt', totalRegistros: linhas.length };
}
