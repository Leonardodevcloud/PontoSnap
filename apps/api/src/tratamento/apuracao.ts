/**
 * Motor de apuração de jornada (base). Trabalha sobre batidas cegas pareadas
 * em entrada/saída. Calcula trabalhado, contratado, saldo e horas noturnas.
 *
 * ATENÇÃO: é a fundação. NÃO cobre ainda: DSR, feriados, adicional noturno com
 * hora reduzida (52min30s), regras de acordo/convenção coletiva e banco de horas
 * com política — isso é um motor CLT dedicado, à parte.
 */
export interface ResumoJornada {
  minutosTrabalhados: number;
  minutosContratados: number;
  saldoMinutos: number;        // positivo = extra; negativo = devedor
  minutosNoturnos: number;     // janela 22:00–05:00 (horário de Brasília, UTC-3)
  paresIncompletos: boolean;   // número ímpar de batidas
}

/** Minutos dentro da janela noturna (22:00–05:00) no intervalo [ent, sai). */
function minutosNoturnos(ent: Date, sai: Date): number {
  let n = 0;
  const cur = new Date(ent);
  while (cur.getTime() < sai.getTime()) {
    const horaBrasilia = (cur.getUTCHours() - 3 + 24) % 24;
    if (horaBrasilia >= 22 || horaBrasilia < 5) n++;
    cur.setUTCMinutes(cur.getUTCMinutes() + 1);
  }
  return n;
}

export function apurarJornada(marcacoes: Date[], durJornadaMin: number): ResumoJornada {
  const ord = [...marcacoes].sort((a, b) => a.getTime() - b.getTime());
  let trabalhados = 0;
  let noturnos = 0;
  for (let i = 0; i + 1 < ord.length; i += 2) {
    const ent = ord[i]!;
    const sai = ord[i + 1]!;
    trabalhados += Math.max(0, Math.round((sai.getTime() - ent.getTime()) / 60000));
    noturnos += minutosNoturnos(ent, sai);
  }
  return {
    minutosTrabalhados: trabalhados,
    minutosContratados: durJornadaMin,
    saldoMinutos: trabalhados - durJornadaMin,
    minutosNoturnos: noturnos,
    paresIncompletos: ord.length % 2 !== 0,
  };
}
