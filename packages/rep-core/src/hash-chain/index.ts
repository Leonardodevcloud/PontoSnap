import { createHash } from 'node:crypto';
import type { EntradaMarcacao, MarcacaoGravada } from '@ponto/shared';
import { formatarDataHoraAFD, soDigitos } from '../datetime.js';

export interface DadosHash {
  nsr: number;
  dtMarcacao: Date;
  cpf: string;
  dtGravacao: Date;
  coletor: number;
  onlineOffline: number;
  hashAnterior: string | null;
}

/**
 * Monta a entrada do SHA-256 (registro tipo 7). PONTO CRÍTICO:
 * a representação exata de cada campo precisa ser validada contra o
 * validador oficial de AFD do MTE. Centralizado aqui de propósito.
 */
export function construirEntradaHash(d: DadosHash): string {
  return [
    String(d.nsr).padStart(9, '0'),
    '7',
    formatarDataHoraAFD(d.dtMarcacao),
    soDigitos(d.cpf).padStart(11, '0'),
    formatarDataHoraAFD(d.dtGravacao),
    String(d.coletor).padStart(2, '0'),
    String(d.onlineOffline),
    d.hashAnterior ?? '',
  ].join('');
}

/** SHA-256 em hex maiúsculo, encoding latin1 (ISO 8859-1) como o AFD. */
export function calcularHash(entrada: string): string {
  return createHash('sha256').update(entrada, 'latin1').digest('hex').toUpperCase();
}

/** Função PURA: dada a marcação anterior, resolve NSR e hash da próxima. */
export function proximaMarcacao(
  entrada: EntradaMarcacao,
  anterior: { nsr: number; hashRegistro: string } | null,
): MarcacaoGravada {
  const nsr = (anterior?.nsr ?? 0) + 1;
  const hashAnterior = anterior?.hashRegistro ?? null;
  const hashRegistro = calcularHash(construirEntradaHash({
    nsr,
    dtMarcacao: entrada.dtMarcacao,
    cpf: entrada.cpf,
    dtGravacao: entrada.dtGravacao,
    coletor: entrada.coletor,
    onlineOffline: entrada.onlineOffline,
    hashAnterior,
  }));
  return { ...entrada, nsr, hashRegistro, hashAnterior };
}

/** Recalcula a cadeia e retorna o primeiro NSR onde ela quebra (ou null). */
export function verificarCadeia(
  marcacoes: MarcacaoGravada[],
): { integro: boolean; nsrQuebrado: number | null } {
  let hashAnterior: string | null = null;
  const ordenadas = [...marcacoes].sort((a, b) => a.nsr - b.nsr);
  for (const m of ordenadas) {
    const esperado = calcularHash(construirEntradaHash({
      nsr: m.nsr,
      dtMarcacao: m.dtMarcacao,
      cpf: m.cpf,
      dtGravacao: m.dtGravacao,
      coletor: m.coletor,
      onlineOffline: m.onlineOffline,
      hashAnterior,
    }));
    if (esperado !== m.hashRegistro || (m.hashAnterior ?? null) !== hashAnterior) {
      return { integro: false, nsrQuebrado: m.nsr };
    }
    hashAnterior = m.hashRegistro;
  }
  return { integro: true, nsrQuebrado: null };
}
