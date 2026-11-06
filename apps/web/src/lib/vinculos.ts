import { useEffect, useState } from 'react';
import { api } from './api';

/**
 * Vínculos do funcionário com as empresas do grupo: o atual e os anteriores
 * (transferência entre CNPJs). Nada foi movido de empresa: cada contracheque,
 * documento e espelho continua na empresa que o emitiu, e o app passa o
 * `vinculo` (tenantId) quando o registro é de uma empresa anterior.
 */
export interface Vinculo {
  tenantId: string;
  empresa: string;
  /** Primeiro dia nesta empresa (nulo = desde o cadastro). */
  inicio: string | null;
  /** Primeiro dia fora (já na empresa seguinte). Nulo = atual. */
  saida: string | null;
  atual: boolean;
}

/** Os vínculos da pessoa; lista vazia se der erro (o app segue como antes). */
export function useVinculos(): Vinculo[] | null {
  const [vs, setVs] = useState<Vinculo[] | null>(null);
  useEffect(() => {
    let vivo = true;
    api.get<Vinculo[]>('/meus-vinculos').then((r) => { if (vivo) setVs(r); }).catch(() => { if (vivo) setVs([]); });
    return () => { vivo = false; };
  }, []);
  return vs;
}

/** Parâmetro de query para registros de empresa anterior ('' no atual). */
export const paramVinculo = (v: { tenantId: string; atual: boolean } | null | undefined, sep: '?' | '&' = '?') =>
  v && !v.atual ? `${sep}vinculo=${encodeURIComponent(v.tenantId)}` : '';

const fimDoMes = (comp: string) => {
  const [a, m] = comp.split('-').map(Number);
  return `${comp}-${String(new Date(Date.UTC(a!, m!, 0)).getUTCDate()).padStart(2, '0')}`;
};

/** Vínculos que cobrem algum dia da competência YYYY-MM (do mais novo ao mais antigo). */
export function vinculosDoMes(vs: Vinculo[], comp: string): Vinculo[] {
  const ini = `${comp}-01`, fim = fimDoMes(comp);
  return vs.filter((v) => (!v.inicio || v.inicio <= fim) && (!v.saida || v.saida > ini));
}

/** O vínculo do dia YYYY-MM-DD (o atual, se a data não cair em nenhum). */
export function vinculoDoDia(vs: Vinculo[], data: string): Vinculo | null {
  return vs.find((v) => (!v.inicio || v.inicio <= data) && (!v.saida || v.saida > data)) ?? vs.find((v) => v.atual) ?? null;
}

/** dd/mm/aaaa */
export const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Último dia na empresa (a saída é o primeiro dia fora). */
export function ultimoDia(saida: string): string {
  const d = new Date(`${saida}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Linha de período: "desde 01/11/2026" ou "até 31/10/2026". */
export const periodoVinculo = (v: Vinculo) =>
  v.atual ? (v.inicio ? `desde ${dataBR(v.inicio)}` : '') : v.saida ? `até ${dataBR(ultimoDia(v.saida))}` : '';

/** Nome curto da empresa para frases ("IG Serviços de Entregas Ltda" → "IG Serviços de Entregas"). */
export const empresaCurta = (nome: string) => nome.replace(/\s+(ltda|eireli|s\/?a|me|epp)\.?$/i, '').trim();
