import PDFDocument from 'pdfkit';

export interface LinhaCiencia { nome: string; cpf: string; abertoEm: string | null; cienteEm: string | null }
export interface DadosCienciaComunicado {
  empregador: string;
  titulo: string;
  publicadoEm: string;
  autor: string;
  pedirCiencia: boolean;
  geradoEm: string;
  linhas: LinhaCiencia[];
}

const INK = '#10403F';
const CORAL = '#E5502F';
const ASH = '#5C4F49';
const LINHA = '#E7DED2';
const OK = '#0B7A4B';
const cpfFmt = (c: string) => c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');

/** Comprovante de ciência de um comunicado interno (PDF retrato). */
export function gerarCienciaComunicadoPdf(d: DadosCienciaComunicado): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 40, left: 40, right: 40, bottom: 44 } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L = 40, R = 555, W = R - L;
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(18).text('Ponto', L, 40, { continued: true }).fillColor(CORAL).text('Snap');
    doc.fillColor(ASH).font('Helvetica').fontSize(9).text(d.pedirCiencia ? 'Comprovante de ciência de comunicado' : 'Comprovante de leitura de comunicado', L, 64);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text(d.empregador, L, 44, { width: W, align: 'right' });
    doc.moveTo(L, 84).lineTo(R, 84).lineWidth(1).strokeColor(INK).stroke();

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(14).text(d.titulo, L, 98, { width: W });
    const yMeta = doc.y + 4;
    const cientes = d.linhas.filter((l) => (d.pedirCiencia ? l.cienteEm : l.abertoEm)).length;
    doc.fillColor(ASH).font('Helvetica').fontSize(9)
      .text(`Publicado em ${d.publicadoEm} por ${d.autor} · ${d.linhas.length} destinatários · ${cientes} ${d.pedirCiencia ? 'deram ciência' : 'leram'}`, L, yMeta, { width: W });

    const cols = [
      { t: 'Funcionário', w: 190 }, { t: 'CPF', w: 95 }, { t: 'Abriu em', w: 115 }, { t: d.pedirCiencia ? 'Ciência em' : 'Situação', w: 115 },
    ];
    const head = (yy: number) => {
      doc.rect(L, yy, W, 18).fillColor('#FBF4E8').fill();
      let x = L + 6;
      doc.fillColor(ASH).font('Helvetica-Bold').fontSize(7.5);
      for (const c of cols) { doc.text(c.t.toUpperCase(), x, yy + 5, { width: c.w - 6 }); x += c.w; }
      return yy + 18;
    };
    let y = head(doc.y + 14);
    for (const l of d.linhas) {
      if (y > 770) { doc.addPage(); y = head(48); }
      const ultimo = d.pedirCiencia ? (l.cienteEm ?? 'pendente') : (l.abertoEm ? 'leu' : 'não abriu');
      const cel = [l.nome, cpfFmt(l.cpf), l.abertoEm ?? '—', ultimo];
      let x = L + 6;
      cel.forEach((v, i) => {
        const pend = i === 3 && (v === 'pendente' || v === 'não abriu');
        doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(pend ? CORAL : i === 3 ? OK : INK);
        doc.text(v, x, y + 4, { width: cols[i]!.w - 6, lineBreak: false, ellipsis: true });
        x += cols[i]!.w;
      });
      doc.moveTo(L, y + 17).lineTo(R, y + 17).lineWidth(0.4).strokeColor(LINHA).stroke();
      y += 18;
    }
    y += 14;
    if (y > 760) { doc.addPage(); y = 48; }
    doc.fillColor(ASH).font('Helvetica').fontSize(7.5).text(
      d.pedirCiencia
        ? 'A ciência foi registrada pelo próprio funcionário, no app, ao tocar em "Li e estou ciente", com data e hora do servidor (fuso da empresa).'
        : 'A leitura é registrada quando o funcionário abre o comunicado no app, com data e hora do servidor (fuso da empresa).',
      L, y, { width: W });
    doc.fillColor('#B9AEA2').fontSize(7).text(`Gerado em ${d.geradoEm}`, L, y + 14, { width: W, align: 'right' });
    doc.end();
  });
}
