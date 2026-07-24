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
  /** Fuso usado na formatação das datas — entra DENTRO do hash imutável. */
  fuso: string;
}

/**
 * Monta a entrada do SHA-256 (registro tipo 7). PONTO CRÍTICO:
 * a representação exata de cada campo precisa ser validada contra o
 * validador oficial de AFD do MTE. Centralizado aqui de propósito.
 *
 * O fuso entra na formatação das datas e, portanto, DENTRO do hash. Como o
 * hash é imutável, o fuso usado aqui tem de ser o mesmo reproduzido no AFD
 * daquela marcação — por isso ele é gravado por linha (ver MarcacaoGravada).
 */
export function construirEntradaHash(d: DadosHash): string {
  const fuso = d.fuso;
  return [
    String(d.nsr).padStart(9, '0'),
    '7',
    formatarDataHoraAFD(d.dtMarcacao, fuso),
    soDigitos(d.cpf).padStart(11, '0'),
    formatarDataHoraAFD(d.dtGravacao, fuso),
    String(d.coletor).padStart(2, '0'),
    String(d.onlineOffline),
    d.hashAnterior ?? '',
  ].join('');
}

/** SHA-256 em hex maiúsculo, encoding latin1 (ISO 8859-1) como o AFD. */
export function calcularHash(entrada: string): string {
  return createHash('sha256').update(entrada, 'latin1').digest('hex').toUpperCase();
}

/**
 * Função PURA: dada a marcação anterior, resolve NSR e hash da próxima.
 * O fuso é o do tenant no momento da batida; fica gravado na marcação para
 * o AFD reproduzir a formatação exata usada no hash.
 */
export function proximaMarcacao(
  entrada: EntradaMarcacao,
  /**
   * Último registro do REP. `nsr` é o contador do ARQUIVO (compartilhado com
   * os registros 2, 5 e 6); `hashRegistro` é o da última MARCAÇÃO — pode ser
   * nulo mesmo com nsr > 0, quando ainda não houve batida.
   */
  anterior: { nsr: number; hashRegistro: string | null } | null,
  fuso: string,
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
    fuso,
  }));
  return { ...entrada, nsr, hashRegistro, hashAnterior, fuso };
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
      // Marcação sem fuso gravado é anterior ao fuso por linha: foi hasheada
      // com Brasília, então é assim que se reproduz o hash dela. Não é default
      // — é reconstituir o passado.
      fuso: m.fuso ?? '-0300',
    }));
    if (esperado !== m.hashRegistro || (m.hashAnterior ?? null) !== hashAnterior) {
      return { integro: false, nsrQuebrado: m.nsr };
    }
    hashAnterior = m.hashRegistro;
  }
  return { integro: true, nsrQuebrado: null };
}
