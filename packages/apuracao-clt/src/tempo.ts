/** Minutos desde 00:00 no fuso de Brasília (UTC-3). */
export function minutosDoDia(d: Date): number {
  const h = (d.getUTCHours() - 3 + 24) % 24;
  return h * 60 + d.getUTCMinutes();
}

/** Diferença em minutos (b - a). */
export const diffMin = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60000);

/** Dia da semana no fuso -0300 (0 = domingo). */
export function diaSemana(dataISO: string): number {
  return new Date(`${dataISO}T12:00:00-0300`).getUTCDay();
}

export const hhmm = (min: number): string => {
  const s = min < 0 ? '-' : '';
  const a = Math.abs(min);
  return `${s}${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}`;
};

/** Converte 'HHMM' ou 'HH:MM' em minutos desde 00:00. */
export function minutosDeHHMM(v: string): number {
  const t = String(v).replace(':', '').padStart(4, '0');
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(2, 4));
}
