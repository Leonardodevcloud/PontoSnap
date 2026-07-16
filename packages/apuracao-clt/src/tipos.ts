/**
 * Regras de apuração — capturam a política da empresa + o acordo/convenção
 * coletiva (CCT/ACT). São o ponto de configuração do motor: mudou a categoria,
 * muda o objeto de regras, não o código.
 */
export interface RegrasApuracao {
  /** Tolerância diária total sem gerar extra/falta (Súmula 366 TST). */
  toleranciaDiariaMin: number;
  /** Tolerância por marcação. */
  toleranciaPorMarcacaoMin: number;
  noturno: {
    /** Aplica a hora noturna reduzida de 52min30s (Art. 73 §1º). */
    reduzida: boolean;
    inicioMin: number; // minutos desde 00:00 (22:00 = 1320)
    fimMin: number;    // 05:00 = 300
    adicionalPct: number; // 20
    prorrogacao: boolean; // Súmula 60 II: prorrogação da jornada noturna segue noturna
  };
  extra: {
    diaUtilPct: number;        // 50
    domingoFeriadoPct: number; // 100
    limiteDiarioMin: number;   // 120 (2h) — sinaliza excesso
  };
  intervalo: {
    penalidade: boolean; // Art. 71 §4º — indeniza o suprimido +50%
    faixas: Array<{ acimaMin: number; minimoMin: number }>; // ex.: >6h→60min; 4–6h→15min
  };
  /** Interjornada mínima entre o fim de um dia e o início do próximo (Art. 66). */
  interjornadaMinimaMin: number; // 660 (11h)
  /** Se true, o saldo positivo vai para banco de horas em vez de extra paga. */
  bancoDeHoras: boolean;
  /** Se true, atraso/saída antecipada do dia se compensam com a extra do mesmo dia. */
  compensarAtrasoComExtra: boolean;
  /** Jornada semanal contratada (para reflexo de DSR). */
  jornadaSemanalMin: number;
}

export interface EntradaDia {
  data: string;                 // YYYY-MM-DD (fuso -0300)
  marcacoes: Date[];            // batidas cegas do dia
  jornadaContratadaMin: number; // jornada esperada no dia
  ehDomingo?: boolean;          // domingo (DSR) — extra 100%
  ehFeriado?: boolean;          // feriado — extra 100%
  ehDescanso?: boolean;         // folga que não é domingo/feriado (ex.: sábado) — extra 50%
  ausenciaAbonadaMin?: number;  // abono legal (Art. 473 etc.) reduz o esperado
  saidaDiaAnterior?: Date;      // última saída do dia anterior (interjornada)
  janelaPrevista?: Array<{ entrada: string; saida: string }>; // horário previsto (HHMM) p/ apurar atraso/extra por marcação
  regime?: 'normal' | 'r12x36'; // 12x36: sem interjornada de 11h, feriado neutro (Art. 59-A)
}

export interface ExtraClassificada {
  min: number;
  adicionalPct: number; // 50 | 100 | ...
  motivo: string;
}

export interface ResultadoDia {
  data: string;
  /** Eco das batidas do dia — quem lê o resultado quase sempre quer mostrá-las junto. */
  marcacoes: Date[];
  minutosTrabalhados: number;
  minutosContratados: number;
  minutosNoturnosReais: number;
  minutosNoturnosLegais: number; // com redução aplicada (base do adicional)
  extras: ExtraClassificada[];
  extrasTotalMin: number;
  faltaMin: number;
  faltaInjustificada: boolean;
  ehDescansoDia: boolean;
  atrasoMin: number;             // atraso + saída antecipada (após tolerância/compensação)
  saldoMin: number;              // líquido do dia (+ extra / - devedor)
  intervaloGozadoMin: number;
  penalidadeIntervaloMin: number;
  penalidadeInterjornadaMin: number;
  violacaoInterjornada: boolean;
  paresIncompletos: boolean;
  observacoes: string[];
}

export interface ResultadoPeriodo {
  dias: ResultadoDia[];
  totalTrabalhadoMin: number;
  totalContratadoMin: number;
  totalExtrasMin: number;
  extrasPorAdicional: Record<string, number>; // "50" -> min, "100" -> min
  totalNoturnoLegalMin: number;
  totalFaltaMin: number;
  totalAtrasoMin: number;
  saldoPeriodoMin: number;
  bancoDeHorasMin: number;   // saldo levado a banco (se política de banco)
  reflexoDsrMin: number;     // ESTIMATIVA do reflexo em DSR (semanal)
  dsrPerdidoSemanas: number; // semanas com falta injustificada (Lei 605/49)
  diasComViolacao: string[];
}
