import bcrypt from 'bcryptjs';

const CUSTO = 12;

/** Gera hash de senha (bcrypt, custo 12). */
export function hashSenha(senha: string): Promise<string> {
  return bcrypt.hash(senha, CUSTO);
}

/** Verifica senha contra o hash. */
export function verificarSenha(senha: string, hash: string): Promise<boolean> {
  return bcrypt.compare(senha, hash);
}
