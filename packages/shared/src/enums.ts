/** Enums de domínio, alinhados ao leiaute da Portaria 671. */

export enum TipoIdentificador { CNPJ = 1, CPF = 2 }

/** Identificador do coletor da marcação (campo 6 do registro tipo 7 do AFD). */
export enum Coletor { MOBILE = 1, BROWSER = 2, DESKTOP = 3, DISPOSITIVO = 4, OUTRO = 5 }

export enum OnlineOffline { ONLINE = 0, OFFLINE = 1 }

/** Tipo da marcação no AEJ (registro tipo 05). */
export enum TpMarc { ENTRADA = 'E', SAIDA = 'S', DESCONSIDERADA = 'D' }

/** Fonte da marcação no AEJ (registro tipo 05). */
export enum FonteMarc {
  ORIGINAL = 'O', INCLUIDA = 'I', PREASSINALADA = 'P', EXCECAO = 'X', OUTRAS = 'T',
}

/** Perfis de acesso (RBAC multi-tenant). */
export enum Perfil {
  MASTER = 'MASTER',
  ADMIN_CLIENTE = 'ADMIN_CLIENTE',
  RH = 'RH',
  COLABORADOR = 'COLABORADOR',
}
