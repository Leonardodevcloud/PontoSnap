import { getDocumentProxy } from 'unpdf';
import type { CampoAutentique } from './autentique.client';

const LARG = 150, ALT = 38;

/**
 * Acha onde o funcionário assina num PDF que não fomos nós que geramos
 * (contracheque da contabilidade): procura o rótulo "assinatura" (a última
 * ocorrência, que no holerite é a do funcionário, embaixo) e põe o campo logo
 * acima dele. Sem texto (PDF escaneado) ou sem o rótulo, cai no rodapé da
 * última página. Nunca lança.
 */
export async function campoAssinaturaDoPdf(buf: Buffer): Promise<CampoAutentique> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf), { verbosity: 0 });
    try {
      const ultima = pdf.numPages;
      let achado: { pagina: number; x: number; y: number; w: number; W: number; H: number } | null = null;
      for (let p = 1; p <= Math.min(pdf.numPages, 4); p++) {
        const pg = await pdf.getPage(p);
        const vp = pg.getViewport({ scale: 1 });
        const tc = await pg.getTextContent();
        for (const it of tc.items as Array<{ str?: string; transform?: number[]; width?: number }>) {
          if (!it.str || !it.transform || !/assinatura/i.test(it.str)) continue;
          if (/empregador|empresa|respons[aá]vel|gestor/i.test(it.str)) continue;
          achado = { pagina: p, x: it.transform[4]!, y: it.transform[5]!, w: it.width ?? 0, W: vp.width, H: vp.height };
        }
      }
      if (achado) {
        const topo = achado.H - achado.y - 12; // pdf.js mede de baixo para cima (linha de base); -12 ≈ topo do texto
        const cx = achado.x + achado.w / 2;
        return {
          pagina: achado.pagina,
          x: lim(((cx - LARG / 2) / achado.W) * 100, 1, 80),
          y: lim(((topo - ALT - 6) / achado.H) * 100, 1, 92),
        };
      }
      return { pagina: ultima, x: 8, y: 88 };
    } finally { await pdf.destroy().catch(() => {}); }
  } catch {
    return { pagina: 1, x: 8, y: 88 };
  }
}

const lim = (v: number, a: number, b: number) => Math.round(Math.min(b, Math.max(a, v)) * 10) / 10;
