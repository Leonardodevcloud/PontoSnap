const TZ = 'America/Sao_Paulo';

export const fmtHora = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });

export const fmtDataCurta = (d = new Date()) =>
  d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', timeZone: TZ })
    .replace('.', '');

export function hojeSP(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function minutosParaHhMm(min: number): string {
  const s = min < 0 ? '-' : '';
  const a = Math.abs(min);
  return `${s}${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}`;
}

/** Rótulo E/S alternado pela posição da batida no dia. */
export const rotuloPorIndice = (i: number) => (i % 2 === 0 ? 'Entrada' : 'Saída');

export const reaisDeCentavos = (c: number) =>
  'R$ ' + (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
