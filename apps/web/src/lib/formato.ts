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
/**
 * Rótulo da marcação na posição `i`, dado o total de marcações do dia.
 * Regra: a primeira é Entrada, a última é Saída, e o miolo alterna
 * Saída/Retorno do descanso. Sábado com 2 marcações vira Entrada/Saída,
 * sem inventar descanso que não existiu.
 */
export function rotuloMarcacao(i: number, total: number): string {
  if (i === 0) return 'Entrada';
  const ultimo = total - 1;
  if (i > ultimo) return i % 2 === 1 ? 'Saída' : 'Entrada'; // excedente: o RH trata
  if (i === ultimo) return 'Saída';
  return i % 2 === 1 ? 'Saída descanso' : 'Retorno descanso';
}

/** Rótulo da PRÓXIMA marcação. `jaBatidas` = quantas já existem hoje. */
export function rotuloProxima(jaBatidas: number, esperadas: number): string {
  if (jaBatidas === 0) return 'Entrada';
  if (esperadas > 0) return rotuloMarcacao(jaBatidas, esperadas);
  return jaBatidas % 2 === 1 ? 'Saída' : 'Retorno descanso';
}

export const reaisDeCentavos = (c: number) =>
  'R$ ' + (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
