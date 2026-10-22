import type { ResultadoDia } from '@ponto/apuracao-clt';
import { movimentosBancoDoDia, type DestinoAtraso, type DestinoFalta } from './destinacao';

/**
 * A conta do mês, por extenso — o que o RH e o funcionário veem para não
 * ficar dúvida: previsto, faltas (à parte), trabalhado, o que sobrou, o que
 * faltou, quanto foi abatido um pelo outro e para onde vai o resultado.
 *
 * Usa os MESMOS movimentos do banco (movimentosBancoDoDia), então "vai para o
 * banco" bate com o banco de horas centavo por centavo... minuto por minuto.
 */
export interface OpcoesConta {
  destinacaoFaltas: DestinoFalta; destinacaoAtrasos: DestinoAtraso;
  bancoAtivo: boolean; formaCalculo: 'BANCO_HORAS' | 'INTRA_MES' | null;
}
export type DestinoDia = 'BANCO' | 'PAGA' | 'FOLHA' | 'TOLERADO' | 'FALTA' | 'PENDENTE' | 'SEMANA' | 'ZERO';
export interface DiaConta {
  data: string; previstoMin: number; trabalhadoMin: number;
  /** Trabalhado − previsto, antes de tolerância e semana. */
  brutoMin: number;
  /** O que conta de fato no dia (depois da tolerância / compensação da semana). */
  saldoMin: number; faltaMin: number; destino: DestinoDia;
}
export interface ContaMes {
  ate: string;
  previstoMin: number;
  falta: { min: number; dias: string[]; destino: DestinoFalta };
  previstoDiasVeioMin: number;
  trabalhadoMin: number;
  diferencaMin: number;
  /** O que sobrou (excedente) e o que faltou nos dias trabalhados — o que conta, depois da tolerância. */
  sobrouMin: number; faltouMin: number;
  /** Quanto do que faltou foi coberto pelo que sobrou (um abate o outro). */
  abatidoMin: number;
  /** Tolerância (até 10 min/dia) e acertos da semana: diferença entre o bruto e o que conta. */
  ajusteMin: number;
  /** Semana que compensa e ainda não fechou: o resultado entra quando fechar. */
  semanaAbertaMin: number;
  /** Resultado líquido do mês (fora as faltas). */
  resultadoMin: number;
  /** Para onde vai. Com banco: o que entra no banco (bate com o extrato). */
  destino: {
    tipo: 'BANCO' | 'FOLHA';
    paraBancoMin: number;
    /** Sem banco: extra paga. */
    extraPagaMin: number;
    /** Atraso descontado na folha (sem banco, ou regra "descontar"). */
    atrasoFolhaMin: number;
    atrasoToleradoMin: number;
    destinoAtraso: DestinoAtraso;
    formaCalculo: 'BANCO_HORAS' | 'INTRA_MES' | null;
  };
  pendentes: { dias: string[]; trabalhadoMin: number };
  dias: DiaConta[];
}

export function montarContaMes(diasRes: ResultadoDia[], o: OpcoesConta, hoje: string): ContaMes {
  const dest = { destinacaoFaltas: o.destinacaoFaltas, destinacaoAtrasos: o.destinacaoAtrasos, bancoAtivo: o.bancoAtivo };
  const atrasoEf: DestinoAtraso = o.destinacaoAtrasos === 'BANCO' && !o.bancoAtivo ? 'DESCONTA' : o.destinacaoAtrasos;
  const faltaEf: DestinoFalta = o.destinacaoFaltas === 'BANCO' && !o.bancoAtivo ? 'DESCONTA' : o.destinacaoFaltas;
  const c: ContaMes = {
    ate: hoje, previstoMin: 0, falta: { min: 0, dias: [], destino: faltaEf }, previstoDiasVeioMin: 0, trabalhadoMin: 0, diferencaMin: 0,
    sobrouMin: 0, faltouMin: 0, abatidoMin: 0, ajusteMin: 0, semanaAbertaMin: 0, resultadoMin: 0,
    destino: { tipo: o.bancoAtivo ? 'BANCO' : 'FOLHA', paraBancoMin: 0, extraPagaMin: 0, atrasoFolhaMin: 0, atrasoToleradoMin: 0, destinoAtraso: atrasoEf, formaCalculo: o.bancoAtivo ? o.formaCalculo : null },
    pendentes: { dias: [], trabalhadoMin: 0 }, dias: [],
  };
  let ultimo = '';
  const semanas = new Map<string, { pos: number; neg: number }>();
  for (const d of diasRes) {
    if (d.data > hoje) continue;
    ultimo = d.data;
    const previsto = d.minutosContratados, trab = d.minutosTrabalhados;
    if (d.pendente || d.paresIncompletos) {
      c.pendentes.dias.push(d.data); c.pendentes.trabalhadoMin += trab;
      if (previsto || trab) c.dias.push({ data: d.data, previstoMin: previsto, trabalhadoMin: trab, brutoMin: trab - previsto, saldoMin: 0, faltaMin: 0, destino: 'PENDENTE' });
      continue;
    }
    c.previstoMin += previsto; c.trabalhadoMin += trab;
    const falta = d.faltaMin;
    if (falta > 0) { c.falta.min += falta; c.falta.dias.push(d.data); }
    const bruto = trab - (previsto - falta);
    const semAberta = !!d.semana && d.semana.estado !== 'FECHADA';
    if (semAberta) c.semanaAbertaMin += bruto - d.saldoMin;
    else c.ajusteMin += d.saldoMin - bruto;
    // Sobrou / faltou: o que CONTA em cada dia (depois da tolerância — os mesmos
    // números de extras/atrasos da tela). Na semana que compensa, o dia é
    // zerado e a semana fecha junto: aí vale o que a pessoa fez no dia.
    if (falta === 0) {
      const semanaFechada = !!d.semana && d.semana.estado === 'FECHADA';
      const v = semanaFechada ? bruto : semAberta ? 0 : d.saldoMin;
      if (v > 0) c.sobrouMin += v; else if (v < 0) c.faltouMin += -v;
      if (semanaFechada) {
        const w = semanas.get(d.semana!.inicio) ?? { pos: 0, neg: 0 };
        if (bruto > 0) w.pos += bruto; else w.neg += -bruto;
        semanas.set(d.semana!.inicio, w);
      }
    }
    c.resultadoMin += d.saldoMin;

    // Para onde vai (mesma regra do banco e da folha).
    if (o.bancoAtivo) {
      const movs = movimentosBancoDoDia(d, dest);
      c.destino.paraBancoMin += movs.reduce((s, m) => s + m.minutos, 0);
    } else if (d.saldoMin > 0) c.destino.extraPagaMin += d.saldoMin;
    if (d.saldoMin < 0 && falta === 0) {
      if (atrasoEf === 'DESCONTA') c.destino.atrasoFolhaMin += -d.saldoMin;
      else if (atrasoEf === 'TOLERA') c.destino.atrasoToleradoMin += -d.saldoMin;
    }

    const destino: DestinoDia = falta > 0 ? 'FALTA'
      : semAberta ? 'SEMANA'
      : d.saldoMin > 0 ? (o.bancoAtivo ? 'BANCO' : 'PAGA')
      : d.saldoMin < 0 ? (atrasoEf === 'BANCO' ? 'BANCO' : atrasoEf === 'TOLERA' ? 'TOLERADO' : 'FOLHA')
      : bruto !== 0 ? 'TOLERADO' : 'ZERO';
    if (previsto || trab || falta) c.dias.push({ data: d.data, previstoMin: previsto, trabalhadoMin: trab, brutoMin: bruto, saldoMin: d.saldoMin, faltaMin: falta, destino });
  }
  c.ate = ultimo || hoje;
  c.previstoDiasVeioMin = c.previstoMin - c.falta.min;
  c.diferencaMin = c.trabalhadoMin - c.previstoDiasVeioMin;
  // Um abate o outro: no banco (atraso abate do banco) o mês inteiro se
  // compensa; sem isso, só dentro de cada semana que "compensa na semana".
  c.abatidoMin = o.bancoAtivo && atrasoEf === 'BANCO'
    ? Math.min(c.sobrouMin, c.faltouMin)
    : [...semanas.values()].reduce((s, w) => s + Math.min(w.pos, w.neg), 0);
  return c;
}
