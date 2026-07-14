/** Formatadores de data/hora exigidos pelos leiautes AFD e AEJ. */

export const soDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

/**
 * DH do AFD/AEJ: "AAAA-MM-ddThh:mm:00ZZZZZ" (ex.: 2021-04-27T16:44:00-0300).
 * Fuso fixo por ora (-0300, Brasil sem horário de verão desde 2019).
 */
export function formatarDataHoraAFD(data: Date, fuso = '-0300'): string {
  const sinal = fuso[0] === '-' ? -1 : 1;
  const offMin = sinal * (parseInt(fuso.slice(1, 3), 10) * 60 + parseInt(fuso.slice(3, 5), 10));
  const local = new Date(data.getTime() + offMin * 60000);
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())}` +
    `T${p(local.getUTCHours())}:${p(local.getUTCMinutes())}:00${fuso}`;
}

/** Data "AAAA-MM-dd". */
export function dataD(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
