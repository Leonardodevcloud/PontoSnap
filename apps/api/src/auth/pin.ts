import bcrypt from 'bcryptjs';

const CUSTO = 10;

/** Valida formato do PIN: 4 a 8 dígitos numéricos. */
export function pinValido(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

/** Gera hash do PIN. Lança se o formato for inválido. */
export async function hashPin(pin: string): Promise<string> {
  if (!pinValido(pin)) throw new Error('PIN deve ter de 4 a 8 dígitos');
  return bcrypt.hash(pin, CUSTO);
}

export function verificarPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}
