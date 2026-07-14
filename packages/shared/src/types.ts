import type { Coletor, OnlineOffline, TipoIdentificador } from './enums.js';

/** Configuração do REP-P de um tenant (empregador). Vira o cabeçalho do AFD. */
export interface RepConfig {
  tipoIdEmpregador: TipoIdentificador;
  documentoEmpregador: string;   // CNPJ/CPF do empregador (só dígitos)
  cnoCaepf?: string | null;
  razaoSocial: string;
  numeroInpi: string;            // registro do software no INPI (constante na plataforma)
  tipoIdDesenvolvedor: TipoIdentificador;
  documentoDesenvolvedor: string;
}

/** Dados de uma batida, antes de entrar na cadeia. */
export interface EntradaMarcacao {
  cpf: string;
  dtMarcacao: Date;
  dtGravacao: Date;
  coletor: Coletor;
  onlineOffline: OnlineOffline;
}

/** Marcação já gravada, com NSR e cadeia de hash resolvidos. */
export interface MarcacaoGravada extends EntradaMarcacao {
  nsr: number;
  hashRegistro: string;
  hashAnterior: string | null;
}
