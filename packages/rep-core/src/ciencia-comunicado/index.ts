import PDFDocument from 'pdfkit';

export interface LinhaCiencia { nome: string; cpf: string; abertoEm: string | null; cienteEm: string | null; voto?: string | null; votou?: boolean }
export interface DadosCienciaComunicado {
  empregador: string;
  titulo: string;
  publicadoEm: string;
  autor: string;
  pedirCiencia: boolean;
  geradoEm: string;
  linhas: LinhaCiencia[];
  /** Resultado da enquete (se o comunicado tem). No voto anônimo, sem coluna de voto. */
  enquete?: { pergunta: string; anonima: boolean; encerrada: boolean; total: number; opcoes: { texto: string; votos: number }[] } | null;
}

const INK = '#0F1B33';
const CORAL = '#2457D6';
const ERRO = '#C2362B';
const ASH = '#55627A';
const LINHA = '#E2E7F0';
const OK = '#0E7A50';
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

    // Resultado da enquete, antes da lista.
    if (d.enquete) {
      let yy = doc.y + 14;
      doc.rect(L, yy, W, 18 + d.enquete.opcoes.length * 16 + 8).fillColor('#F0F3F9').fill();
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(10)
        .text(`Enquete: ${d.enquete.pergunta}`, L + 10, yy + 6, { width: W - 20 });
      doc.fillColor(ASH).font('Helvetica').fontSize(8)
        .text(`${d.enquete.total} ${d.enquete.total === 1 ? 'voto' : 'votos'}${d.enquete.encerrada ? ' · encerrada' : ' · parcial'}${d.enquete.anonima ? ' · voto anônimo' : ''}`, L + 10, yy + 6, { width: W - 20, align: 'right' });
      yy += 24;
      const max = Math.max(1, ...d.enquete.opcoes.map((o) => o.votos));
      for (const o of d.enquete.opcoes) {
        const pct = d.enquete.total ? Math.round((o.votos / d.enquete.total) * 100) : 0;
        doc.fillColor(INK).font('Helvetica').fontSize(8.5).text(o.texto, L + 10, yy, { width: 170, lineBreak: false, ellipsis: true });
        doc.rect(L + 190, yy + 1, 240 * (o.votos / max), 8).fillColor(o.votos === max && o.votos > 0 ? OK : '#A9B6CC').fill();
        doc.fillColor(ASH).fontSize(8).text(`${o.votos} · ${pct}%`, L + 440, yy, { width: 60, align: 'right' });
        yy += 16;
      }
      doc.y = yy + 4;
    }

    const comVoto = !!d.enquete && !d.enquete.anonima;
    const comParticipacao = !!d.enquete && d.enquete.anonima;
    const cols = comVoto || comParticipacao
      ? [{ t: 'Funcionário', w: 150 }, { t: 'CPF', w: 85 }, { t: 'Abriu em', w: 95 }, { t: d.pedirCiencia ? 'Ciência em' : 'Situação', w: 85 }, { t: comVoto ? 'Voto' : 'Votou', w: 100 }]
      : [{ t: 'Funcionário', w: 190 }, { t: 'CPF', w: 95 }, { t: 'Abriu em', w: 115 }, { t: d.pedirCiencia ? 'Ciência em' : 'Situação', w: 115 }];
    const head = (yy: number) => {
      doc.rect(L, yy, W, 18).fillColor('#F0F3F9').fill();
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
      if (comVoto) cel.push(l.voto ?? 'não votou');
      if (comParticipacao) cel.push(l.votou ? 'sim' : 'não votou');
      let x = L + 6;
      cel.forEach((v, i) => {
        const pend = (i === 3 && (v === 'pendente' || v === 'não abriu')) || (i === 4 && v === 'não votou');
        doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(pend ? ERRO : i >= 3 ? OK : INK);
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
    doc.fillColor('#A3AEC2').fontSize(7).text(`Gerado em ${d.geradoEm}`, L, y + 14, { width: W, align: 'right' });
    doc.end();
  });
}
