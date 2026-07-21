import type { ResultadoPeriodo, ResultadoDia } from '@ponto/apuracao-clt';

export type DestinoFalta = 'DESCONTA' | 'BANCO' | 'ABONA';
export type DestinoAtraso = 'DESCONTA' | 'BANCO' | 'TOLERA';

export interface OpcoesDestinacao {
  destinacaoFaltas: DestinoFalta;
  destinacaoAtrasos: DestinoAtraso;
  /** Banco efetivamente ativo pro funcionário. Se não, "BANCO" vira "DESCONTA". */
  bancoAtivo: boolean;
}

export interface ResumoDestinacao {
  falta: { min: number; destino: DestinoFalta };
  atraso: { min: number; destino: DestinoAtraso };
  extra: { min: number; destino: 'BANCO' | 'PAGA' };
}

/** BANCO só vale se o banco estiver ativo; senão, o valor é sinalizado como desconto. */
function efetivo<T extends 'DESCONTA' | 'BANCO' | 'ABONA' | 'TOLERA'>(d: T, bancoAtivo: boolean): T {
  return (d === 'BANCO' && !bancoAtivo ? ('DESCONTA' as T) : d);
}

/** Resumo do mês: pra onde vão faltas, atrasos e extras, segundo a regra. */
export function resumirDestinacao(r: ResultadoPeriodo, o: OpcoesDestinacao): ResumoDestinacao {
  return {
    falta: { min: r.totalFaltaMin, destino: efetivo(o.destinacaoFaltas, o.bancoAtivo) },
    atraso: { min: r.totalAtrasoMin, destino: efetivo(o.destinacaoAtrasos, o.bancoAtivo) },
    extra: { min: r.totalExtrasMin, destino: o.bancoAtivo ? 'BANCO' : 'PAGA' },
  };
}

export interface MovDia { minutos: number; tipo: 'CREDITO' | 'DEBITO'; descricao: string; }

/**
 * Movimentos de banco de um dia, conforme a destinação da regra.
 * - Extra (saldoMin > 0): sempre credita.
 * - Atraso/saída antecipada (saldoMin < 0 em dia trabalhado): debita só se a
 *   destinação de atrasos for BANCO.
 * - Falta (faltaMin, que fica FORA do saldoMin): debita só se a destinação de
 *   faltas for BANCO. É por isso que precisa ser tratada à parte.
 */
export function movimentosBancoDoDia(dia: ResultadoDia, o: OpcoesDestinacao): MovDia[] {
  if (dia.paresIncompletos) return [];
  const movs: MovDia[] = [];
  if (dia.saldoMin > 0) {
    movs.push({ minutos: dia.saldoMin, tipo: 'CREDITO', descricao: 'Hora extra' });
  } else if (dia.saldoMin < 0 && dia.faltaMin === 0 && efetivo(o.destinacaoAtrasos, o.bancoAtivo) === 'BANCO') {
    movs.push({ minutos: dia.saldoMin, tipo: 'DEBITO', descricao: 'Atraso ou saída antecipada' });
  }
  if (dia.faltaMin > 0 && efetivo(o.destinacaoFaltas, o.bancoAtivo) === 'BANCO') {
    movs.push({ minutos: -dia.faltaMin, tipo: 'DEBITO', descricao: 'Falta injustificada' });
  }
  return movs;
}
