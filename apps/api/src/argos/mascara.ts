/**
 * Máscara de dados pessoais antes de enviar à IA externa, e restauração na
 * resposta. O mesmo valor vira sempre o mesmo marcador na conversa. CPF, CNPJ,
 * chave Pix e telefone saem mascarados; nomes informados também. A IA trabalha
 * com os marcadores ([PESSOA_1], [CPF_1]) e a gente devolve os valores reais no
 * texto final.
 */
const RE_CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const RE_CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const RE_TEL = /\b(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g;

export type MapaMascara = Map<string, string>; // marcador -> valor real

function marcador(mapa: MapaMascara, valor: string, prefixo: string): string {
  for (const [m, orig] of mapa) if (orig === valor) return m;
  const n = [...mapa.keys()].filter((k) => k.startsWith(`[${prefixo}_`)).length + 1;
  const m = `[${prefixo}_${n}]`;
  mapa.set(m, valor);
  return m;
}

export function mascarar(texto: string, nomes: string[], mapa: MapaMascara): string {
  let out = texto
    .replace(RE_CNPJ, (v) => marcador(mapa, v, 'CNPJ'))
    .replace(RE_CPF, (v) => marcador(mapa, v, 'CPF'))
    .replace(RE_TEL, (v) => marcador(mapa, v, 'TEL'));
  for (const nome of nomes) {
    const n = nome?.trim();
    if (!n || n.length < 3) continue;
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(esc, 'gi'), () => marcador(mapa, n, 'PESSOA'));
  }
  return out;
}

export function restaurar(texto: string, mapa: MapaMascara): string {
  let out = texto;
  for (const [m, orig] of mapa) out = out.split(m).join(orig);
  return out;
}
