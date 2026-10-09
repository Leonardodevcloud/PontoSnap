/**
 * Pix "copia e cola" (BR Code estático, padrão EMV do Banco Central).
 * Gera o texto que vira QR Code; o app do banco lê chave, nome e valor.
 */

export type TipoChave = 'CPF' | 'CNPJ' | 'TELEFONE' | 'EMAIL' | 'ALEATORIA';

function cpfValido(d: string): boolean {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

/** Normaliza a chave como o DICT espera (CPF/CNPJ só dígitos, telefone +55…, e-mail minúsculo). */
export function normalizarChave(bruta: string): { chave: string; tipo: TipoChave } | null {
  const v = bruta.trim();
  if (!v) return null;
  if (v.includes('@')) return { chave: v.toLowerCase(), tipo: 'EMAIL' };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return { chave: v.toLowerCase(), tipo: 'ALEATORIA' };
  const d = v.replace(/\D/g, '');
  if (v.startsWith('+')) return d.length >= 12 && d.length <= 13 ? { chave: `+${d}`, tipo: 'TELEFONE' } : null;
  if (d.length === 14) return { chave: d, tipo: 'CNPJ' };
  // 11 dígitos: CPF se o dígito verificador bater; senão celular com DDD.
  if (d.length === 11 && (cpfValido(d) && !/[()]/.test(v))) return { chave: d, tipo: 'CPF' };
  if (d.length === 10 || d.length === 11) return { chave: `+55${d}`, tipo: 'TELEFONE' };
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return { chave: `+${d}`, tipo: 'TELEFONE' };
  return null;
}

const campo = (id: string, valor: string) => `${id}${String(valor.length).padStart(2, '0')}${valor}`;
/** Nome/cidade no BR Code: ASCII, maiúsculo, sem acento, com limite de tamanho. */
const ascii = (s: string, max: number) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, '').trim().toUpperCase().slice(0, max) || 'NA';

export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function brCodePix(o: { chave: string; nome: string; cidade?: string; valorCent?: number | null; txid?: string; mensagem?: string }): string {
  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', o.chave) + (o.mensagem ? campo('02', o.mensagem.slice(0, 40)) : '');
  const corpo =
    campo('00', '01') +
    campo('26', conta) +
    campo('52', '0000') +
    campo('53', '986') +
    (o.valorCent && o.valorCent > 0 ? campo('54', (o.valorCent / 100).toFixed(2)) : '') +
    campo('58', 'BR') +
    campo('59', ascii(o.nome, 25)) +
    campo('60', ascii(o.cidade ?? 'BRASIL', 15)) +
    campo('62', campo('05', (o.txid ?? '***').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***')) +
    '6304';
  return corpo + crc16(corpo);
}
