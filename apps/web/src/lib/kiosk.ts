const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';
const CHAVE = 'pontosnap.device';

export const obterDeviceToken = () => localStorage.getItem(CHAVE);
export const definirDeviceToken = (t: string | null) => {
  if (t) localStorage.setItem(CHAVE, t);
  else localStorage.removeItem(CHAVE);
};

export interface RespMarcar {
  empregado: { empregadoId: string; nome: string; cpf: string };
  marcacao: { nsr: number; dtMarcacao: string; hash: string };
}

export async function marcarQuiosque(matricula: string, pin: string): Promise<RespMarcar> {
  const token = obterDeviceToken();
  if (!token) throw new Error('Quiosque não pareado');
  const res = await fetch(`${BASE}/kiosk/marcar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Token': token },
    body: JSON.stringify({ matricula, pin }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Não rolou. Tenta de novo.' }));
    throw new Error(err.message ?? 'Não rolou. Tenta de novo.');
  }
  return res.json();
}
