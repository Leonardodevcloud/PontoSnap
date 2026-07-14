import PDFDocument from 'pdfkit';

export interface LinhaCompetencia {
  nome: string;
  matricula: string | null;
  temSalario: boolean;
  trabalhadoMin: number;
  extrasMin: number;
  noturnoMin: number;
  faltaMin: number;
  atrasoMin: number;
  extrasCentavos: number;
  liquidoProventosCentavos: number;
}

export interface DadosRelatorioCompetencia {
  empregador: string;
  numeroInpi: string;
  inicio: string;
  fim: string;
  linhas: LinhaCompetencia[];
  totais: {
    trabalhadoMin: number; extrasMin: number; noturnoMin: number; faltaMin: number; atrasoMin: number;
    extrasCentavos: number; liquidoProventosCentavos: number;
  };
}

const hhmm = (min: number) => `${Math.floor(Math.abs(min) / 60)}h${String(Math.abs(min) % 60).padStart(2, '0')}`;
const reais = (c: number) => `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDia = (iso: string) => { const [, m, d] = iso.split('-'); return `${d}/${m}`; };

const INK = '#10403F';
const CORAL = '#E5502F';
const ASH = '#5C4F49';
const LINHA = '#E7DED2';

/** Relatório consolidado da competência (PDF paisagem). */
export function gerarRelatorioCompetenciaPdf(d: DadosRelatorioCompetencia): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 40, left: 40, right: 40, bottom: 44 } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L = 40, R = 802, W = R - L;

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(18).text('Ponto', L, 40, { continued: true }).fillColor(CORAL).text('Snap');
    doc.fillColor(ASH).font('Helvetica').fontSize(9).text('Relatório de Competência', L, 64);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(`${d.empregador}`, L, 44, { width: W, align: 'right' });
    doc.fillColor(ASH).font('Helvetica').fontSize(9).text(`${fmtDia(d.inicio)} a ${fmtDia(d.fim)}`, L, 62, { width: W, align: 'right' });
    doc.moveTo(L, 84).lineTo(R, 84).lineWidth(1).strokeColor(INK).stroke();

    const cols = [
      { t: 'Funcionário', w: 200, a: 'left' as const },
      { t: 'Trab.', w: 70, a: 'right' as const },
      { t: 'Extra', w: 70, a: 'right' as const },
      { t: 'Noturno', w: 70, a: 'right' as const },
      { t: 'Falta', w: 65, a: 'right' as const },
      { t: 'Atraso', w: 65, a: 'right' as const },
      { t: 'Extras R$', w: 100, a: 'right' as const },
      { t: 'Parcial R$', w: 102, a: 'right' as const },
    ];
    const head = (yy: number) => {
      doc.rect(L, yy, W, 18).fillColor('#FBF4E8').fill();
      let x = L + 6;
      doc.fillColor(ASH).font('Helvetica-Bold').fontSize(7.5);
      for (const c of cols) { doc.text(c.t.toUpperCase(), x, yy + 5, { width: c.w - 6, align: c.a }); x += c.w; }
      return yy + 18;
    };

    let y = head(96);
    for (const l of d.linhas) {
      if (y > 540) { doc.addPage(); y = head(48); }
      const cells = [
        l.nome + (l.temSalario ? '' : '  (sem salário)'),
        hhmm(l.trabalhadoMin),
        l.extrasMin ? hhmm(l.extrasMin) : '—',
        l.noturnoMin ? hhmm(l.noturnoMin) : '—',
        l.faltaMin ? hhmm(l.faltaMin) : '—',
        l.atrasoMin ? hhmm(l.atrasoMin) : '—',
        l.temSalario ? reais(l.extrasCentavos) : '—',
        l.temSalario ? reais(l.liquidoProventosCentavos) : '—',
      ];
      let x = L + 6;
      doc.font('Helvetica').fontSize(8.5).fillColor(INK);
      cells.forEach((val, i) => {
        const c = cols[i]!;
        doc.fillColor(i === 4 && l.faltaMin ? CORAL : i === 5 && l.atrasoMin ? CORAL : INK);
        doc.text(val, x, y + 3, { width: c.w - 6, align: c.a });
        x += c.w;
      });
      doc.moveTo(L, y + 15).lineTo(R, y + 15).lineWidth(0.4).strokeColor(LINHA).stroke();
      y += 16;
    }

    // total
    if (y > 540) { doc.addPage(); y = 48; }
    doc.rect(L, y, W, 20).fillColor(INK).fill();
    const tot = [
      'TOTAL', hhmm(d.totais.trabalhadoMin), hhmm(d.totais.extrasMin), hhmm(d.totais.noturnoMin),
      hhmm(d.totais.faltaMin), hhmm(d.totais.atrasoMin), reais(d.totais.extrasCentavos), reais(d.totais.liquidoProventosCentavos),
    ];
    let x = L + 6;
    doc.fillColor('#FFF8EE').font('Helvetica-Bold').fontSize(8.5);
    tot.forEach((val, i) => { const c = cols[i]!; doc.text(val, x, y + 5, { width: c.w - 6, align: c.a }); x += c.w; });
    y += 30;

    doc.fillColor(ASH).font('Helvetica').fontSize(7).text(
      'Valores sobre o salário cadastrado (divisor 220h). Reflexo de DSR é estimativa. Cobre o que a jornada gera — não é a folha completa. Não substitui validação contábil.',
      L, y, { width: W });
    doc.fillColor('#B9AEA2').fontSize(6.5).text(`REP-P • Registro INPI: ${d.numeroInpi}`, L, y + 16, { width: W, align: 'center' });

    doc.end();
  });
}
