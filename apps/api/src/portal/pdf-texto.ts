import { getDocumentProxy } from 'unpdf';
import { lerNfsePdf, type LidoNfsePdf, type TextoPdf } from '@ponto/shared';

/**
 * Tira os textos (com posição) de um PDF. PDF gerado por emissor tem texto
 * dentro; escaneado/foto não tem — volta lista vazia. Lê no máximo 3 páginas
 * e desiste depois de alguns segundos (PDF estranho não trava a API).
 */
export async function textosDoPdf(buf: Buffer, maxPaginas = 3, timeoutMs = 8000): Promise<TextoPdf[]> {
  const ler = async (): Promise<TextoPdf[]> => {
    const pdf = await getDocumentProxy(new Uint8Array(buf), { verbosity: 0 });
    const itens: TextoPdf[] = [];
    try {
      for (let p = 1; p <= Math.min(pdf.numPages, maxPaginas); p++) {
        const pg = await pdf.getPage(p);
        const tc = await pg.getTextContent();
        for (const it of tc.items as Array<{ str?: string; transform?: number[]; width?: number }>) {
          if (!it.str || !it.transform) continue;
          itens.push({ str: it.str, x: it.transform[4]!, y: it.transform[5]!, w: it.width ?? 0, pagina: p });
        }
      }
    } finally { await pdf.destroy().catch(() => {}); }
    return itens;
  };
  let timer: NodeJS.Timeout | undefined;
  const limite = new Promise<TextoPdf[]>((_, rej) => { timer = setTimeout(() => rej(new Error('tempo esgotado')), timeoutMs); });
  try { return await Promise.race([ler(), limite]); } finally { clearTimeout(timer); }
}

/** Lê a NFS-e de um PDF em base64. Nunca lança: se não der, volta null. */
export async function lerNfseDoPdf(base64: string): Promise<LidoNfsePdf | null> {
  try {
    const itens = await textosDoPdf(Buffer.from(base64, 'base64'));
    if (itens.length === 0) return null;
    const l = lerNfsePdf(itens);
    return l.leu ? l : null;
  } catch { return null; }
}
