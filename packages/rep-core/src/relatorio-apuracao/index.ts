import PDFDocument from 'pdfkit';

export interface DiaRelatorio {
  data: string;          // YYYY-MM-DD
  trabalhadoMin: number;
  contratadoMin: number;
  extra: string;         // pré-formatado, ex.: "1h00@50%"
  noturnoMin: number;
  faltaMin: number;
  sinais: string;        // ex.: "ímpar interv."
}

export interface DadosRelatorioApuracao {
  empregador: string;
  localPrestacao: string;
  numeroInpi: string;
  nome: string;
  matricula: string | null;
  inicio: string;        // YYYY-MM-DD
  fim: string;
  regras: string;
  totais: {
    trabalhadoMin: number; contratadoMin: number; extrasMin: number;
    extra50Min: number; extra100Min: number; noturnoLegalMin: number;
    faltaMin: number; atrasoMin: number; saldoMin: number; bancoMin: number; reflexoDsrMin: number; dsrPerdidoSemanas: number;
  };
  dias: DiaRelatorio[];
  valores?: {
    valorHoraCentavos: number;
    extrasCentavos: number;
    adicionalNoturnoCentavos: number;
    reflexoDsrCentavos: number;
    descontoFaltasCentavos: number;
    descontoAtrasosCentavos: number;
    descontoDsrPerdidoCentavos: number;
    liquidoProventosCentavos: number;
  };
}

const hhmm = (min: number): string => {
  const s = min < 0 ? '-' : '';
  const a = Math.abs(min);
  return `${s}${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}`;
};
const fmtDia = (iso: string) => { const [, m, d] = iso.split('-'); return `${d}/${m}`; };
const reais = (c: number) => `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const diaSem = (iso: string) => ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(`${iso}T12:00:00-0300`).getUTCDay()];

const INK = '#10403F';
const CORAL = '#E5502F';
const ASH = '#5C4F49';
const LINHA = '#E7DED2';

/** Relatório de Apuração CLT (PDF), no visual PontoSnap. Estimativas sinalizadas. */
export function gerarRelatorioApuracaoPdf(d: DadosRelatorioApuracao): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 40, left: 40, right: 40, bottom: 48 } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L = 40, R = 555, W = R - L;

    // cabeçalho
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(18).text('Ponto', L, 40, { continued: true }).fillColor(CORAL).text('Snap');
    doc.fillColor(ASH).font('Helvetica').fontSize(9).text('Relatório de Apuração CLT', L, 64);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(11)
      .text(`${fmtDia(d.inicio)} a ${fmtDia(d.fim)}`, L, 44, { width: W, align: 'right' });
    doc.moveTo(L, 84).lineTo(R, 84).lineWidth(1).strokeColor(INK).stroke();

    // identificação
    let y = 96;
    const par = (rot: string, val: string, x: number, w: number) => {
      doc.fillColor(ASH).font('Helvetica').fontSize(7).text(rot.toUpperCase(), x, y, { width: w });
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text(val || '—', x, y + 9, { width: w });
    };
    par('Empregador', d.empregador, L, 260);
    par('Local de prestação', d.localPrestacao, L + 270, 240);
    y += 30;
    par('Trabalhador', d.nome, L, 260);
    par('Matrícula', d.matricula ?? '—', L + 270, 120);
    par('Regras', d.regras, L + 400, 110);
    y += 34;

    // totais (cards)
    const cards: Array<[string, string, boolean]> = [
      ['Trabalhado', hhmm(d.totais.trabalhadoMin), false],
      ['Contratado', hhmm(d.totais.contratadoMin), false],
      ['Extra 50%', hhmm(d.totais.extra50Min), d.totais.extra50Min > 0],
      ['Extra 100%', hhmm(d.totais.extra100Min), d.totais.extra100Min > 0],
      ['Noturno', hhmm(d.totais.noturnoLegalMin), false],
      ['Faltas', hhmm(d.totais.faltaMin), d.totais.faltaMin > 0],
      ['Atrasos', hhmm(d.totais.atrasoMin), d.totais.atrasoMin > 0],
      [d.totais.saldoMin >= 0 ? 'Saldo credor' : 'Saldo devedor', hhmm(d.totais.saldoMin), false],
      ['Reflexo DSR ~', hhmm(d.totais.reflexoDsrMin), false],
      ['DSR perdido', `${d.totais.dsrPerdidoSemanas} sem`, d.totais.dsrPerdidoSemanas > 0],
    ];
    const cw = (W - 3 * 8) / 4;
    cards.forEach(([k, v, destaque], i) => {
      const col = i % 4, row = Math.floor(i / 4);
      const x = L + col * (cw + 8);
      const cy = y + row * 46;
      doc.roundedRect(x, cy, cw, 40, 6).fillColor(destaque ? '#FFE2D1' : '#FFFFFF').fill();
      doc.roundedRect(x, cy, cw, 40, 6).lineWidth(0.7).strokeColor(LINHA).stroke();
      doc.fillColor(CORAL).font('Helvetica').fontSize(6.5).text(k.toUpperCase(), x + 8, cy + 7, { width: cw - 16 });
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(14).text(v, x + 8, cy + 17, { width: cw - 16 });
    });
    const linhasCards = Math.ceil(cards.length / 4);
    y += 46 * linhasCards + 12;

    // tabela dia a dia
    const cols = [
      { t: 'Dia', w: 70, a: 'left' as const },
      { t: 'Trab.', w: 60, a: 'right' as const },
      { t: 'Contr.', w: 60, a: 'right' as const },
      { t: 'Extra', w: 130, a: 'left' as const },
      { t: 'Noturno', w: 60, a: 'right' as const },
      { t: 'Falta', w: 55, a: 'right' as const },
      { t: 'Sinais', w: 80, a: 'left' as const },
    ];
    const drawHead = (yy: number) => {
      doc.rect(L, yy, W, 18).fillColor('#FBF4E8').fill();
      let x = L + 6;
      doc.fillColor(ASH).font('Helvetica-Bold').fontSize(7);
      for (const c of cols) { doc.text(c.t.toUpperCase(), x, yy + 5, { width: c.w - 6, align: c.a }); x += c.w; }
      return yy + 18;
    };
    y = drawHead(y);

    for (const dia of d.dias) {
      if (y > 770) { doc.addPage(); y = drawHead(48); }
      const vazio = dia.trabalhadoMin === 0 && dia.contratadoMin === 0 && dia.faltaMin === 0;
      const cells = [
        `${fmtDia(dia.data)} ${diaSem(dia.data)}`,
        dia.trabalhadoMin ? hhmm(dia.trabalhadoMin) : '—',
        dia.contratadoMin ? hhmm(dia.contratadoMin) : '—',
        dia.extra || '—',
        dia.noturnoMin ? hhmm(dia.noturnoMin) : '—',
        dia.faltaMin ? hhmm(dia.faltaMin) : '—',
        dia.sinais || '',
      ];
      let x = L + 6;
      doc.font('Helvetica').fontSize(8).fillColor(vazio ? '#B9AEA2' : INK);
      cells.forEach((val, i) => {
        const c = cols[i]!;
        if (i === 5 && dia.faltaMin) doc.fillColor(CORAL).font('Helvetica-Bold');
        else doc.font('Helvetica').fillColor(vazio ? '#B9AEA2' : INK);
        doc.text(val, x, y + 3, { width: c.w - 6, align: c.a });
        x += c.w;
      });
      doc.moveTo(L, y + 15).lineTo(R, y + 15).lineWidth(0.4).strokeColor(LINHA).stroke();
      y += 16;
    }

    // valores em R$ (quando há salário)
    if (d.valores) {
      const v = d.valores;
      if (y > 700) { doc.addPage(); y = 48; }
      y += 10;
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text('Valores (R$)', L, y);
      y += 20;
      const linhaV = (rot: string, val: string, forte = false, desc = false) => {
        doc.fillColor(desc ? CORAL : ASH).font('Helvetica').fontSize(9).text(rot, L, y, { width: 300 });
        doc.fillColor(forte ? INK : desc ? CORAL : INK).font(forte ? 'Helvetica-Bold' : 'Helvetica').fontSize(forte ? 11 : 9)
          .text(val, L, y, { width: W, align: 'right' });
        doc.moveTo(L, y + 15).lineTo(R, y + 15).lineWidth(0.4).strokeColor(LINHA).stroke();
        y += 18;
      };
      linhaV(`Valor-hora (base salário / 220h)`, reais(v.valorHoraCentavos));
      linhaV('Horas extras (base + adicional)', reais(v.extrasCentavos));
      linhaV('Adicional noturno', reais(v.adicionalNoturnoCentavos));
      linhaV('Reflexo de DSR (estimativa)', reais(v.reflexoDsrCentavos));
      if (v.descontoFaltasCentavos) linhaV('(–) Faltas', `- ${reais(v.descontoFaltasCentavos)}`, false, true);
      if (v.descontoAtrasosCentavos) linhaV('(–) Atrasos', `- ${reais(v.descontoAtrasosCentavos)}`, false, true);
      if (v.descontoDsrPerdidoCentavos) linhaV('(–) DSR perdido', `- ${reais(v.descontoDsrPerdidoCentavos)}`, false, true);
      linhaV('Resultado parcial da jornada', reais(v.liquidoProventosCentavos), true);
    }

    // rodapé / disclaimer
    if (y > 720) { doc.addPage(); y = 48; }
    y += 12;
    doc.fillColor(ASH).font('Helvetica').fontSize(7).text(
      'Percentuais na base CLT; o acordo/convenção coletiva do cliente prevalece. Escala seg–sex quando não configurada; ' +
      'feriados do calendário do cliente. O reflexo de DSR é ESTIMATIVA. Este relatório não substitui validação contábil.',
      L, y, { width: W });
    doc.fillColor('#B9AEA2').fontSize(6.5).text(`REP-P • Registro INPI: ${d.numeroInpi}`, L, y + 24, { width: W, align: 'center' });

    doc.end();
  });
}
