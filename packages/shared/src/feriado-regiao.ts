/** Estados (UF, código IBGE e nome). O código IBGE do município começa com o código da UF. */
export const ESTADOS: { uf: string; codigo: number; nome: string }[] = [
  { uf: 'AC', codigo: 12, nome: "Acre" },
  { uf: 'AL', codigo: 27, nome: "Alagoas" },
  { uf: 'AM', codigo: 13, nome: "Amazonas" },
  { uf: 'AP', codigo: 16, nome: "Amapá" },
  { uf: 'BA', codigo: 29, nome: "Bahia" },
  { uf: 'CE', codigo: 23, nome: "Ceará" },
  { uf: 'DF', codigo: 53, nome: "Distrito Federal" },
  { uf: 'ES', codigo: 32, nome: "Espírito Santo" },
  { uf: 'GO', codigo: 52, nome: "Goiás" },
  { uf: 'MA', codigo: 21, nome: "Maranhão" },
  { uf: 'MG', codigo: 31, nome: "Minas Gerais" },
  { uf: 'MS', codigo: 50, nome: "Mato Grosso do Sul" },
  { uf: 'MT', codigo: 51, nome: "Mato Grosso" },
  { uf: 'PA', codigo: 15, nome: "Pará" },
  { uf: 'PB', codigo: 25, nome: "Paraíba" },
  { uf: 'PE', codigo: 26, nome: "Pernambuco" },
  { uf: 'PI', codigo: 22, nome: "Piauí" },
  { uf: 'PR', codigo: 41, nome: "Paraná" },
  { uf: 'RJ', codigo: 33, nome: "Rio de Janeiro" },
  { uf: 'RN', codigo: 24, nome: "Rio Grande do Norte" },
  { uf: 'RO', codigo: 11, nome: "Rondônia" },
  { uf: 'RR', codigo: 14, nome: "Roraima" },
  { uf: 'RS', codigo: 43, nome: "Rio Grande do Sul" },
  { uf: 'SC', codigo: 42, nome: "Santa Catarina" },
  { uf: 'SE', codigo: 28, nome: "Sergipe" },
  { uf: 'SP', codigo: 35, nome: "São Paulo" },
  { uf: 'TO', codigo: 17, nome: "Tocantins" },
];

export type TipoFeriado = 'nacional' | 'estadual' | 'municipal';
/** Onde a pessoa trabalha (para feriados). Município = código IBGE (7 dígitos). */
export interface LocalTrabalho { uf: string | null; municipioIbge: number | null; municipioNome?: string | null }
export interface RegiaoFeriado { tipo: string; uf: string | null; municipioIbge: number | null }

/** UF de um código IBGE de município (os 2 primeiros dígitos são o código do estado). */
export function ufDoMunicipio(codigoIbge: number | null | undefined): string | null {
  if (!codigoIbge || !/^\d{7}$/.test(String(codigoIbge))) return null;
  const cod = Math.floor(codigoIbge / 100000);
  return ESTADOS.find((e) => e.codigo === cod)?.uf ?? null;
}
export const ufValida = (uf: string | null | undefined) => !!uf && ESTADOS.some((e) => e.uf === uf);

/** Local que vale para a pessoa: o dela; sem município próprio, o da empresa. */
export function localEfetivo(proprio: LocalTrabalho | null | undefined, empresa: LocalTrabalho | null | undefined): LocalTrabalho | null {
  if (proprio?.municipioIbge) return proprio;
  if (empresa?.municipioIbge) return empresa;
  return null;
}

/** Feriado estadual/municipal cadastrado antes das regiões: sem região, vale para todos (como era). */
export const feriadoSemRegiao = (f: RegiaoFeriado) =>
  (f.tipo === 'estadual' && !f.uf) || (f.tipo === 'municipal' && !f.municipioIbge);

/**
 * O feriado vale para quem trabalha neste local?
 * Nacional: todos. Estadual: mesma UF. Municipal: mesmo município.
 * Sem região (antigo): todos. Local desconhecido: só nacional e sem região.
 */
export function feriadoValePara(f: RegiaoFeriado, local: LocalTrabalho | null): boolean {
  if (f.tipo !== 'estadual' && f.tipo !== 'municipal') return true;
  if (feriadoSemRegiao(f)) return true;
  if (!local?.municipioIbge) return false;
  const ufLocal = local.uf ?? ufDoMunicipio(local.municipioIbge);
  if (f.tipo === 'estadual') return f.uf === ufLocal;
  return f.municipioIbge === local.municipioIbge;
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function pascoa(ano: number): string {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/**
 * Feriados nacionais do ano (leis 662/49, 6.802/80, 10.607/02, 14.759/23 e a
 * Paixão de Cristo, que a portaria anual do governo federal lista como
 * feriado nacional). Carnaval, Corpus Christi e vésperas são ponto
 * facultativo: não entram.
 */
export function feriadosNacionais(ano: number): { data: string; nome: string }[] {
  const p = new Date(`${pascoa(ano)}T12:00:00Z`); p.setUTCDate(p.getUTCDate() - 2);
  const d = (md: string) => `${ano}-${md}`;
  return [
    { data: d('01-01'), nome: 'Confraternização Universal' },
    { data: p.toISOString().slice(0, 10), nome: 'Paixão de Cristo' },
    { data: d('04-21'), nome: 'Tiradentes' },
    { data: d('05-01'), nome: 'Dia do Trabalho' },
    { data: d('09-07'), nome: 'Independência do Brasil' },
    { data: d('10-12'), nome: 'Nossa Senhora Aparecida' },
    { data: d('11-02'), nome: 'Finados' },
    { data: d('11-15'), nome: 'Proclamação da República' },
    ...(ano >= 2024 ? [{ data: d('11-20'), nome: 'Dia Nacional de Zumbi e da Consciência Negra' }] : []),
    { data: d('12-25'), nome: 'Natal' },
  ].sort((x, y) => x.data.localeCompare(y.data));
}
