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
  fuso: string;
}

const soDig = (v: unknown) => String(v ?? '').replace(/\D/g, '');

const TP_MARC = ['E', 'S', 'D'];
const FONTE_MARC = ['O', 'I', 'P', 'X', 'T'];

/**
 * Recusa gerar arquivo fora do leiaute (Anexo VI). O AEJ vai assinado e serve
 * de prova em fiscalização — melhor estourar aqui do que entregar um arquivo
 * inválido que ninguém percebe.
 */
function validar(p: MontarAEJParams): void {
  for (const t of p.tratamentos ?? []) {
    if (!TP_MARC.includes(t.tpMarc)) {
      throw new Error(`AEJ registro 05: tpMarc "${t.tpMarc}" inválido (esperado E, S ou D)`);
    }
    const fonte = t.fonteMarc ?? 'O';
    if (!FONTE_MARC.includes(fonte)) {
      throw new Error(`AEJ registro 05: fonteMarc "${fonte}" inválida (esperado O, I, P, X ou T)`);
    }
    if ((t.tpMarc === 'D' || fonte === 'I') && !t.motivo?.trim()) {
      throw new Error('AEJ registro 05: motivo é obrigatório quando tpMarc="D" ou fonteMarc="I"');
    }
  }
  for (const a of p.ausencias ?? []) {
    // 1=DSR, 2=falta não justificada, 3=movimento no banco, 4=folga compensatória
    if (![1, 2, 3, 4].includes(a.tipo)) {
      throw new Error(`AEJ registro 07: tipoAusenOuComp "${a.tipo}" inválido (esperado 1 a 4)`);
    }
    if (a.tipo === 3) {
      if (a.qtMinutos == null) throw new Error('AEJ registro 07: qtMinutos é obrigatório no movimento de banco de horas');
      if (a.tipoMovBH !== 1 && a.tipoMovBH !== 2) {
        throw new Error(`AEJ registro 07: tipoMovBH "${a.tipoMovBH}" inválido (1=inclusão, 2=compensação)`);
      }
    }
  }
}
const linha = (...campos: unknown[]): string =>
  campos.map((c) => (c === null || c === undefined ? '' : String(c))).join('|');

export function montarAEJ(p: MontarAEJParams): { conteudo: Buffer; nomeArquivo: string; totalRegistros: number } {
  validar(p);
  const { rep, ptrp, empregados = [], horarios = [], tratamentos = [], ausencias = [], dataGeracao = new Date(), fuso } = p;
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
      t.tpMarc, String(t.seqEntSaida).padStart(3, '0'), t.fonteMarc ?? 'O', t.codHorContratual ?? '', t.motivo ?? '')); cont.t5++;
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
