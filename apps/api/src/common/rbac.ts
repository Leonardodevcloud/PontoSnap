import type { Perfil } from '@ponto/shared';

/**
 * Decisão pura de RBAC: o perfil do usuário está entre os permitidos?
 * Lista vazia = qualquer usuário autenticado.
 */
export function podeAcessar(perfilUsuario: string, permitidos: Perfil[]): boolean {
  if (permitidos.length === 0) return true;
  return (permitidos as string[]).includes(perfilUsuario);
}
