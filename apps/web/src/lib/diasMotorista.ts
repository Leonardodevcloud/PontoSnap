/**
 * Dias trabalhados do motorista numa semana — a mesma regra nas duas telas
 * (Prestadores › Ajustar dias e Folha › painel do motorista).
 *
 * O sistema não recebe ponto do motorista: a semana nasce com os dias
 * PREVISTOS pela base do contrato (seg–sáb ou seg–sex, sem feriado da cidade).
 * O RH tira o dia que ele não rodou (ou põe o que rodou a mais) marcando as
 * datas. Os chips mostram sempre as datas que dão a quantidade da semana.
 */

export type BaseDiasMot = 'SEG_SAB' | 'SEG_SEX';

/** O que a tela precisa da semana (vem de /pessoal/competencia). */
export interface SemanaDias {
  inicio: string;
  diasAuto: number;
  dias: number;
  diasPossiveis?: string[];
  diasDatas?: string[] | null;
  feriados?: string[];
}

export const SEM_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;
export const diaDaSemana = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();

/** Dias previstos da semana pela base do contrato (os mesmos que dão o "previsto" da API). */
export function diasPrevistos(s: SemanaDias, base: BaseDiasMot): string[] {
  const ultimo = base === 'SEG_SAB' ? 6 : 5;
  const fer = new Set(s.feriados ?? []);
  return (s.diasPossiveis ?? []).filter((d) => { const w = diaDaSemana(d); return w >= 1 && w <= ultimo && !fer.has(d); });
}

/**
 * Datas que aparecem marcadas ao abrir a semana:
 * - as que o RH salvou;
 * - sem datas salvas e com a quantidade prevista: os dias previstos;
 * - quantidade mudada à mão, sem datas: null (não dá para saber quais dias).
 */
export function datasIniciais(s: SemanaDias, base: BaseDiasMot): string[] | null {
  if (s.diasDatas?.length) return [...s.diasDatas].sort();
  const prev = diasPrevistos(s, base);
  if (s.dias === s.diasAuto && prev.length === s.diasAuto) return prev;
  if (s.dias === 0) return [];
  return null;
}

/** Liga/desliga um dia. Sem datas conhecidas, começa do zero. */
export function alternarDia(datas: string[] | null, dia: string): string[] {
  const at = datas ?? [];
  return (at.includes(dia) ? at.filter((x) => x !== dia) : [...at, dia]).sort();
}

const mesmas = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Quantidade de dias que a edição representa. */
export const quantidade = (datas: string[] | null, diasManual: number) => (datas ? datas.length : diasManual);

/**
 * Corpo do PUT /pessoal/lancamento para os dias. `null` = nada mudou.
 * - datas iguais às previstas, sem datas salvas antes → volta ao previsto (dias: null);
 * - nenhum dia marcado → dias: 0 (não trabalhou na semana);
 * - outras datas → diasDatas (a quantidade acompanha e a nota sai com as datas);
 * - só a quantidade (sem datas) → dias, ou null se for o previsto.
 */
export function corpoDias(s: SemanaDias, base: BaseDiasMot, datas: string[] | null, diasManual: number):
  { dias: number | null } | { diasDatas: string[] } | null {
  const ini = datasIniciais(s, base);
  if (datas) {
    if (ini && mesmas(ini, datas)) return null;
    if (datas.length === 0) return { dias: 0 };
    if (!s.diasDatas?.length && mesmas(datas, diasPrevistos(s, base))) return { dias: null };
    return { diasDatas: datas };
  }
  if (ini === null && diasManual === s.dias) return null;
  return { dias: diasManual === s.diasAuto ? null : diasManual };
}

/** "26/10, 27/10 e 29/10" */
export function listaDatas(datas: string[]): string {
  const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  return datas.length <= 1 ? datas.map(dm).join('') : `${datas.slice(0, -1).map(dm).join(', ')} e ${dm(datas[datas.length - 1]!)}`;
}
