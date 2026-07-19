/** Formatadores de data/hora exigidos pelos leiautes AFD e AEJ. */

export const soDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

/**
 * Offset de um fuso "-0300" em minutos (negativo a oeste de Greenwich).
 * O Brasil não tem horário de verão desde 2019, então o offset é fixo por
 * região: -02 (Noronha), -03 (Brasília), -04 (Manaus), -05 (Rio Branco).
 */
export function offsetMin(fuso: string): number {
  const sinal = fuso[0] === '-' ? -1 : 1;
  return sinal * (parseInt(fuso.slice(1, 3), 10) * 60 + parseInt(fuso.slice(3, 5), 10));
}

/**
 * DH do AFD/AEJ: "AAAA-MM-ddThh:mm:00ZZZZZ" (ex.: 2021-04-27T16:44:00-0300).
 * O fuso é parâmetro porque cada tenant (e cada marcação) tem o seu.
 */
export function formatarDataHoraAFD(data: Date, fuso = '-0300'): string {
  const local = new Date(data.getTime() + offsetMin(fuso) * 60000);
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())}` +
    `T${p(local.getUTCHours())}:${p(local.getUTCMinutes())}:00${fuso}`;
}

/** Data "AAAA-MM-dd". */
export function dataD(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Instante UTC do início do dia local (00:00:00) de "YYYY-MM-DD" num dado fuso.
 * Usado como limite inferior de filtros por dia — sem isso, um cliente fora de
 * Brasília perde/ganha batidas na virada do dia.
 */
export const inicioDoDia = (dataISO: string, fuso = '-0300'): Date =>
  new Date(`${dataISO}T00:00:00${fuso}`);

/** Instante UTC do fim do dia local (23:59:59) de "YYYY-MM-DD" num dado fuso. */
export const fimDoDia = (dataISO: string, fuso = '-0300'): Date =>
  new Date(`${dataISO}T23:59:59${fuso}`);

/** Data-calendário local "YYYY-MM-DD" de um instante, no fuso informado. */
export function dataLocalDe(instante: Date, fuso = '-0300'): string {
  return new Date(instante.getTime() + offsetMin(fuso) * 60000).toISOString().slice(0, 10);
}

/**
 * Dia da semana (0=domingo) da data local "YYYY-MM-DD" no fuso informado.
 * Ancora ao meio-dia: meio-dia ±5h nunca cruza a meia-noite, então o dia
 * da semana sai correto para qualquer offset do Brasil.
 */
export function diaDaSemanaLocal(dataISO: string, fuso = '-0300'): number {
  return new Date(`${dataISO}T12:00:00${fuso}`).getUTCDay();
}
