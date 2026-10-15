/** Leitura de NFS-e em XML (usada no app do prestador e na API). Sem dependência. */

export interface LidoNfse { numero: string | null; data: string | null; valorCent: number | null; cnpjPrestador: string | null; cnpjTomador: string | null }

const tag = (xml: string, nomes: string[]): string | null => {
  for (const n of nomes) {
    const m = new RegExp(`<(?:\\w+:)?${n}(?:\\s[^>]*)?>\\s*([^<]+?)\\s*</(?:\\w+:)?${n}>`, 'i').exec(xml);
    if (m) return m[1]!.trim();
  }
  return null;
};
const bloco = (xml: string, nomes: string[]): string | null => {
  for (const n of nomes) {
    const m = new RegExp(`<(?:\\w+:)?${n}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${n}>`, 'i').exec(xml);
    if (m) return m[1]!;
  }
  return null;
};
const docDe = (x: string | null) => (x ? tag(x, ['CNPJ', 'Cnpj', 'CPF', 'Cpf']) : null)?.replace(/\D/g, '') || null;

/**
 * Lê número, data, valor e CNPJs de uma NFS-e em XML — padrão nacional
 * (nNFSe, dhEmi, vServ/vLiq, prest/toma) e ABRASF (Numero, DataEmissao,
 * ValorServicos, PrestadorServico/TomadorServico). O que não achar vem null.
 */
export function lerNfseXml(xml: string): LidoNfse {
  const numero = tag(xml, ['nNFSe', 'NumeroNfse', 'Numero', 'nNF']);
  const dataBruta = tag(xml, ['dhEmi', 'DataEmissao', 'dEmi', 'DataEmissaoNfse', 'dhProc']);
  const data = dataBruta && /^\d{4}-\d{2}-\d{2}/.test(dataBruta) ? dataBruta.slice(0, 10) : null;
  const valor = tag(xml, ['vLiq', 'ValorLiquidoNfse', 'vServ', 'ValorServicos', 'vNF']);
  const valorCent = valor && /^\d+(\.\d+)?$/.test(valor) ? Math.round(Number(valor) * 100) : null;
  const prest = bloco(xml, ['prest', 'emit', 'PrestadorServico', 'Prestador', 'IdentificacaoPrestador']);
  const toma = bloco(xml, ['toma', 'TomadorServico', 'Tomador', 'IdentificacaoTomador']);
  return { numero: numero?.replace(/^0+(?=\d)/, '') ?? null, data, valorCent, cnpjPrestador: docDe(prest), cnpjTomador: docDe(toma) };
}

