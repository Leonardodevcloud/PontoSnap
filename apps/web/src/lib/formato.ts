/**
 * Fuso ativo da sessão (offset "-0300"). Definido após o login a partir do
 * tenant. Default Brasília — idêntico ao antigo America/Sao_Paulo, que não tem
 * horário de verão desde 2019.
 */
let fusoAtivo = '-0300';
export function definirFusoAtivo(f?: string | null): void { fusoAtivo = f || '-0300'; }
export function fusoDaSessao(): string { return fusoAtivo; }

const offsetMin = (f: string) => (f[0] === '-' ? -1 : 1) * (parseInt(f.slice(1, 3), 10) * 60 + parseInt(f.slice(3, 5), 10));
/** Instante deslocado para o relógio de parede do fuso ativo (formatar em UTC). */
const emLocal = (d: Date): Date => new Date(d.getTime() + offsetMin(fusoAtivo) * 60000);
const p2 = (n: number) => String(n).padStart(2, '0');

export const fmtHora = (iso: string) => {
  const l = emLocal(new Date(iso));
  return `${p2(l.getUTCHours())}:${p2(l.getUTCMinutes())}`;
};

/** Aceita Date ou 'YYYY-MM-DD'. A string é lida ao meio-dia para não escorregar de fuso. */
export const fmtDataCurta = (d: Date | string = new Date()) =>
  emLocal(typeof d === 'string' ? new Date(`${d}T12:00:00${fusoAtivo}`) : d)
    .toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })
    .replace('.', '');

/** Data de hoje "YYYY-MM-DD" no fuso ativo. */
export function hojeLocal(): string {
  return emLocal(new Date()).toISOString().slice(0, 10);
}
/** @deprecated use hojeLocal — mantido para compatibilidade. */
export const hojeSP = hojeLocal;

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
