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
