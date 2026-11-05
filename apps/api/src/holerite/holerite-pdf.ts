import { extractText, getDocumentProxy } from 'unpdf';
import { PDFDocument } from 'pdf-lib';

const MESES: Record<string, string> = {
  janeiro: '01', fevereiro: '02', marco: '03', abril: '04', maio: '05', junho: '06',
  julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12',
};

export const soDigitos = (s: string) => s.replace(/\D/g, '');

/** Normaliza nome para comparação: sem acento, caixa alta, só letras e espaço. */
export function normalizarNome(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface HoleriteBloco {
  /** Páginas (1-based) deste holerite — uma pessoa pode ocupar mais de uma. */
  paginas: number[];
  cpf: string | null;      // só dígitos
  nome: string | null;     // como veio no PDF
  competencia: string | null; // AAAA-MM
  liquidoCentavos: number | null;
}

function parsePagina(t: string, pagina: number) {
  const cpf = t.match(/(\d{3}\.\d{3}\.\d{3}-\d{2})/)?.[1] ?? null;
  const nome = t.match(/Empregado\s*\n?\s*(?:\d{4,6}\s+)?([A-ZÀ-Ú][A-ZÀ-Ú'.\s]{4,70}?)\s*(?:\n|Cargo|CPF)/)?.[1] ?? null;
  const comp = t.match(/Compet[êe]ncia\s*\n?\s*([A-Za-zçÇ]+)\s+de\s+(\d{4})/i);
  const liq = t.match(/L[íi]quido a Receber\s*\n?\s*([\d.]+,\d{2})/i)?.[1] ?? null;
  return {
    pagina,
    cpf: cpf ? soDigitos(cpf) : null,
    nome: nome ? nome.trim().replace(/\s+/g, ' ') : null,
    competencia: comp ? `${comp[2] ?? ''}-${MESES[normalizarNome(comp[1] ?? '').toLowerCase()] ?? '01'}` : null,
    liquidoCentavos: liq ? Math.round(parseFloat(liq.replace(/\./g, '').replace(',', '.')) * 100) : null,
  };
}

/** Lê o PDF da contabilidade e devolve um bloco por pessoa (agrupa páginas consecutivas do mesmo CPF). */
export async function lerHolerites(buf: Buffer): Promise<{ competencia: string | null; totalPaginas: number; blocos: HoleriteBloco[] }> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const paginas = (text as string[]).map((t, i) => parsePagina(t ?? '', i + 1));

  const blocos: HoleriteBloco[] = [];
  for (const p of paginas) {
    const ult = blocos[blocos.length - 1];
    // mesmo CPF em páginas seguidas = mesma pessoa (via/contravia, holerite de 2 páginas…)
    if (ult && p.cpf && ult.cpf === p.cpf) { ult.paginas.push(p.pagina); continue; }
    blocos.push({ paginas: [p.pagina], cpf: p.cpf, nome: p.nome, competencia: p.competencia, liquidoCentavos: p.liquidoCentavos });
  }
  const competencia = paginas.find((p) => p.competencia)?.competencia ?? null;
  return { competencia, totalPaginas: totalPages, blocos };
}

/** Recorta as páginas (1-based) em um PDF novo. */
export async function recortar(buf: Buffer, paginas: number[]): Promise<Buffer> {
  const src = await PDFDocument.load(buf);
  const out = await PDFDocument.create();
  const copiadas = await out.copyPages(src, paginas.map((p) => p - 1));
  copiadas.forEach((p) => out.addPage(p));
  return Buffer.from(await out.save());
}
