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


// ───────────────────────── PDF (DANFSe e modelos de prefeitura) ─────────────────────────

/** Um pedaço de texto do PDF com a posição na página (y cresce para cima, como no PDF). */
export interface TextoPdf { str: string; x: number; y: number; w: number; pagina: number }

export interface LidoNfsePdf extends LidoNfse {
  /** Chave de acesso da NFS-e nacional (50 dígitos), se achada e válida. */
  chave: string | null;
  /** true = achou ao menos número ou valor (vale mostrar "li sua nota"). */
  leu: boolean;
}

const RE_DOC = /\b(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/;
const RE_DINHEIRO = /(?:R\$\s*)?(?<v>\d{1,3}(?:\.\d{3})*,\d{2})\b/;
const RE_DATA = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;
const RE_NUMERO = /^\s*(?:n[º°o.]*\s*)?(?<v>\d{1,15})\s*$/i;
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (s: string) => semAcento(s).toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Chave de acesso da NFS-e nacional: cMun(7) ambGer(1) tpInsc(1) inscFed(14)
 * nNFSe(13) AAMM(4) cód(9) DV(1). Daqui saem o CNPJ/CPF de quem emitiu e o
 * número, sem depender do layout do PDF.
 */
export function lerChaveNfse(chave: string): { doc: string; numero: string; anoMes: string } | null {
  const c = chave.replace(/\D/g, '');
  if (c.length !== 50) return null;
  const tp = c[8];
  const insc = c.slice(9, 23);
  if (tp !== '1' && tp !== '2') return null;
  const doc = tp === '1' ? insc.slice(3) : insc;
  const numero = c.slice(23, 36).replace(/^0+(?=\d)/, '');
  const aamm = c.slice(36, 40);
  const mes = Number(aamm.slice(2));
  if (mes < 1 || mes > 12) return null;
  return { doc, numero, anoMes: `20${aamm.slice(0, 2)}-${aamm.slice(2)}` };
}

/** Ordem de leitura: página, de cima para baixo, da esquerda para a direita. */
function ordenar(itens: TextoPdf[]): TextoPdf[] {
  return itens.filter((i) => i.str.trim()).sort((a, b) => a.pagina - b.pagina || (Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x));
}

/**
 * Valor de um rótulo pela posição: o que está à direita na mesma linha ou logo
 * abaixo, alinhado com o rótulo. Funciona tanto em "Rótulo: valor" quanto no
 * layout em tabela do DANFSe (rótulos numa linha, valores na de baixo).
 */
function valorDoRotulo(itens: TextoPdf[], rotulo: RegExp, valor: RegExp): string | null {
  for (const r of itens) {
    const n = norm(r.str);
    // Layout da Reforma Tributária: "VALOR LÍQUIDO DA NFS-e + IBS/CBS" não é o valor da nota.
    if (!rotulo.test(n) || /\b(ibs|cbs)\b/.test(n)) continue;
    // Mesmo item: "Valor Líquido: R$ 1.234,56"
    const dp = r.str.indexOf(':');
    if (dp >= 0) { const m = valor.exec(r.str.slice(dp + 1).trim()); if (m) return m.groups?.v ?? m[0]; }
    else { const m = valor.exec(r.str); if (m) return m.groups?.v ?? m[0]; } // "VALOR TOTAL = R$ 1.150,00"
    const mesmaPagina = itens.filter((i) => i.pagina === r.pagina && i !== r);
    const direita = mesmaPagina.filter((i) => Math.abs(i.y - r.y) <= 3 && i.x > r.x + 1).sort((a, b) => a.x - b.x);
    for (const i of direita.slice(0, 3)) { const m = valor.exec(i.str); if (m) return m.groups?.v ?? m[0]; }
    const abaixo = mesmaPagina.filter((i) => r.y - i.y > 2 && r.y - i.y < 30 && i.x < r.x + Math.max(r.w, 40) && i.x + Math.max(i.w, 10) > r.x - 25)
      .sort((a, b) => (b.y - a.y) || Math.abs(a.x - r.x) - Math.abs(b.x - r.x));
    for (const i of abaixo.slice(0, 4)) { const m = valor.exec(i.str); if (m) return m.groups?.v ?? m[0]; }
  }
  return null;
}

/** Primeiro CPF/CNPJ depois de um título de seção (antes da próxima seção). */
function docDaSecao(ordem: TextoPdf[], inicio: RegExp, fim: RegExp): string | null {
  const i = ordem.findIndex((t) => inicio.test(norm(t.str)));
  if (i < 0) return null;
  for (const t of ordem.slice(i + 1, i + 40)) {
    if (fim.test(norm(t.str))) break;
    const m = RE_DOC.exec(t.str);
    if (m) return m[1]!.replace(/\D/g, '');
  }
  return null;
}

const centavos = (s: string | null) => (s ? Math.round(Number(s.replace(/[^\d,]/g, '').replace(',', '.')) * 100) : null);
const dataIso = (s: string | null) => { const m = s ? RE_DATA.exec(s) : null; return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

/**
 * Lê número, data, valor e CNPJs de uma NFS-e em PDF a partir dos textos com
 * posição. DANFSe nacional pelos rótulos fixos + chave de acesso; modelos de
 * prefeitura pelos rótulos mais comuns. O que não achar vem null — nunca chuta.
 */
export function lerNfsePdf(itensBrutos: TextoPdf[]): LidoNfsePdf {
  const itens = ordenar(itensBrutos);
  const texto = itens.map((i) => i.str).join(' ');

  // Chave de acesso (pode vir com espaços entre os grupos).
  let chave: string | null = null;
  for (const m of texto.matchAll(/\d[\d ]{48,75}\d/g)) {
    const c = m[0].replace(/\s/g, '');
    for (let k = 0; k + 50 <= c.length; k++) if (lerChaveNfse(c.slice(k, k + 50))) { chave = c.slice(k, k + 50); break; }
    if (chave) break;
  }
  const daChave = chave ? lerChaveNfse(chave) : null;

  const numRotulo = valorDoRotulo(itens, /^(numero|n[º°o]\.?) (da )?(nfs-?e|nota)|^numero da nota|^n[º°o]\.? nfs-?e/, RE_NUMERO);
  const numero = daChave?.numero ?? numRotulo?.replace(/^0+(?=\d)/, '') ?? null;

  const data = dataIso(valorDoRotulo(itens, /emissao/, RE_DATA));

  const valorTxt = valorDoRotulo(itens, /valor liquido/, RE_DINHEIRO)
    ?? valorDoRotulo(itens, /^valor (total )?(da nota|da nfs-?e|do servico|dos servicos)/, RE_DINHEIRO);
  const valorCent = centavos(valorTxt);

  const FIM_TOMADOR = /^(intermediario|servico prestado|discriminacao|descricao|tributacao|valor total)/;
  const cnpjPrestador = daChave?.doc
    ?? docDaSecao(itens, /^(emitente|prestador( do servico| de servicos)?)\b/, /^tomador/);
  const cnpjTomador = docDaSecao(itens, /^tomador/, FIM_TOMADOR);

  return { numero, data, valorCent, cnpjPrestador, cnpjTomador, chave, leu: !!(numero || valorCent != null) };
}
