import PDFDocument from 'pdfkit';

/**
 * Demonstrativo de Espelho de Ponto — o documento que o funcionário confere e
 * assina. Diferente do relatório de apuração (que fecha folha), este mostra o
 * que a pessoa bateu, dia a dia, para ela concordar.
 *
 * No REP-P, a prova da jornada é o AFD (imutável, assinado com o certificado).
 * Este espelho é um documento DERIVADO, de conferência — por isso ele mostra,
 * quando há ajuste aprovado, a marcação ORIGINAL e a TRATADA, para o
 * funcionário assinar sabendo exatamente o que mudou e por quê.
 */
export interface LinhaEspelho {
  data: string;                 // YYYY-MM-DD
  tipoDia: 'TRAB' | 'FOLGA' | 'FERIADO' | 'DSR' | 'ATESTADO' | 'FALTA';
  jornadaEsperada: string;      // ex.: "08:00-12:00 13:00-17:00" ou "—"
  marcacoesOriginais: string;   // ex.: "08:01 12:03 13:00 17:04"
  jornadaRealizada: string;     // pares tratados, ex.: "08:01-12:03 13:00-17:04"
  horasRealizadas: string;      // "08:19"
  horasPositivas: string;       // extra/crédito do dia — "00:19" ou ""
  atrasosFaltas: string;        // "" ou "00:14"
  horaNoturna: string;          // "" ou "00:20"
  compensadasDebito: string;    // banco - débito
  compensadasCredito: string;   // banco - crédito
  eventos: string;              // "Feriado (…)", "Gestor decidiu abonar", etc.
}

export interface DadosEspelho {
  empresa: string;
  cnpj: string;
  cep?: string;
  endereco?: string;
  nome: string;
  matricula: string | null;
  cpf: string;
  pis?: string;
  admissao?: string;
  departamento?: string;
  cargo?: string;
  competenciaInicio: string;    // YYYY-MM-DD
  competenciaFim: string;
  fuso: string;
  linhas: LinhaEspelho[];
  totais: {
    trabalhado: string;         // "178:48"
    horasNormaisEsperadas: string;
    diurno?: string;
    saldoBanco?: string;
  };
  /** Concordância eletrônica do funcionário — imprime o carimbo de assinatura digital. */
  assinaturaEletronica?: {
    nome: string;
    cpf: string;
    em: string;               // "06/08/2026 09:42"
    via: string;              // "PIN no app + auditoria"
    hashDocumento?: string;   // hash do próprio espelho, para conferência
    referencia?: string;      // id/número do registro de auditoria
  } | null;
  geradoEm?: Date;
}

/** Estrela de 4 pontas — assinatura visual da marca PontoSnap. */
function estrelaFlash(doc: PDFKit.PDFDocument, cx: number, cy: number, r: number, cor: string): void {
  doc.save().fillColor(cor);
  const pts: [number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const ang = Math.PI / 2 + (i * Math.PI) / 4;
    const rr = i % 2 === 0 ? r : r * 0.4;
    pts.push([cx + Math.cos(ang) * rr, cy - Math.sin(ang) * rr]);
  }
  doc.moveTo(pts[0]![0], pts[0]![1]);
  for (const p of pts.slice(1)) doc.lineTo(p[0], p[1]);
  doc.closePath().fill();
  doc.restore();
}

const VERDE_SELO = '#0FA968';

/** Carimbo redondo "assinado digitalmente" com os dados que comprovam a assinatura. */
function carimboAssinatura(
  doc: PDFKit.PDFDocument, x: number, y: number, larguraUtil: number,
  a: NonNullable<DadosEspelho['assinaturaEletronica']>,
): void {
  const cx = x + 48;
  const cy = y + 48;
  doc.save();
  doc.lineWidth(2).strokeColor(VERDE_SELO).circle(cx, cy, 42).stroke();
  doc.lineWidth(0.8).strokeColor(VERDE_SELO).circle(cx, cy, 35).stroke();
  estrelaFlash(doc, cx, cy - 14, 10, VERDE_SELO);
  doc.fillColor(VERDE_SELO).font('Helvetica-Bold').fontSize(7.5)
    .text('ASSINADO', cx - 38, cy - 2, { width: 76, align: 'center' })
    .text('DIGITALMENTE', cx - 38, cy + 6, { width: 76, align: 'center' });
  doc.fillColor(TINTA).font('Helvetica').fontSize(5)
    .text('PONTOSNAP · REP-P', cx - 38, cy + 18, { width: 76, align: 'center' });
  doc.restore();

  const tx = x + 118;
  doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(10).text(a.nome, tx, y + 12, { width: larguraUtil - 118 });
  doc.fillColor(CINZA).font('Helvetica').fontSize(8.5)
    .text(`CPF ${fmtDoc(a.cpf)}`, tx, y + 28)
    .text(`Assinado em ${a.em} · ${a.via}`, tx, y + 41);
  if (a.hashDocumento) {
    doc.fillColor(CINZA).font('Courier').fontSize(6.5)
      .text(`hash do documento: ${a.hashDocumento}${a.referencia ? `  ·  ref ${a.referencia}` : ''}`, tx, y + 58, { width: larguraUtil - 118 });
  }
}

const TINTA = '#10403F';
const CORAL = '#E5502F';
const CINZA = '#5C4F49';
const LINHA = '#D9CFC1';
const CAB_BG = '#FBEFE6';

const fmtData = (iso: string) => { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; };
const diaSemana = (iso: string, fuso: string) =>
  ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(`${iso}T12:00:00${fuso}`).getUTCDay()];
const fmtDoc = (d: string) => {
  const s = String(d ?? '').replace(/\D/g, '');
  if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return d ?? '';
};

export function gerarEspelhoPontoPdf(d: DadosEspelho): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 34, bottom: 40, left: 34, right: 34 } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const pronto = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));

  const larguraUtil = doc.page.width - 68;

  // ---- Cabeçalho ----
  doc.fillColor(CORAL).font('Helvetica-Bold').fontSize(17).text('flash'.length ? 'PontoSnap' : '', 34, 30);
  doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(15).text('Demonstrativo de Espelho de Ponto', 34, 30, { width: larguraUtil, align: 'center' });
  const ger = d.geradoEm ?? new Date();
  doc.font('Helvetica').fontSize(7.5).fillColor(CINZA)
    .text(`Documento gerado em ${ger.toLocaleDateString('pt-BR')} ${ger.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`, 34, 30, { width: larguraUtil, align: 'right' })
    .text(`${fmtData(d.competenciaInicio)} a ${fmtData(d.competenciaFim)}`, 34, 41, { width: larguraUtil, align: 'right' });

  let y = 62;
  const infoEsq = [
    `Empresa: ${d.empresa}`,
    `CNPJ: ${fmtDoc(d.cnpj)}${d.cep ? `   CEP: ${d.cep}` : ''}`,
    d.endereco ? `Endereço: ${d.endereco}` : '',
  ].filter(Boolean);
  const infoDir = [
    `Nome: ${d.nome}`,
    `Matrícula: ${d.matricula ?? '—'}    CPF: ${fmtDoc(d.cpf)}${d.pis ? `    PIS: ${d.pis}` : ''}`,
    [d.admissao ? `Admissão: ${fmtData(d.admissao)}` : '', d.cargo ? `Cargo: ${d.cargo}` : ''].filter(Boolean).join('    '),
  ].filter(Boolean);
  doc.font('Helvetica').fontSize(8).fillColor(TINTA);
  infoEsq.forEach((t, i) => doc.text(t, 34, y + i * 11, { width: larguraUtil / 2 - 6 }));
  infoDir.forEach((t, i) => doc.text(t, 34 + larguraUtil / 2, y + i * 11, { width: larguraUtil / 2 }));
  y += infoEsq.length * 11 + 8;

  // ---- Tabela ----
  const cols: { k: keyof LinhaEspelho | 'dia'; lb: string; w: number; al?: 'left' | 'center' }[] = [
    { k: 'data', lb: 'Data', w: 52, al: 'center' },
    { k: 'tipoDia', lb: 'Tipo', w: 40, al: 'center' },
    { k: 'jornadaEsperada', lb: 'Jornada esperada', w: 108 },
    { k: 'marcacoesOriginais', lb: 'Marcações originais', w: 108 },
    { k: 'jornadaRealizada', lb: 'Jornada realizada', w: 108 },
    { k: 'horasRealizadas', lb: 'Realizadas', w: 46, al: 'center' },
    { k: 'horasPositivas', lb: 'Positivas', w: 42, al: 'center' },
    { k: 'atrasosFaltas', lb: 'Atr./Faltas', w: 46, al: 'center' },
    { k: 'horaNoturna', lb: 'Noturna', w: 40, al: 'center' },
    { k: 'compensadasDebito', lb: 'Déb.', w: 34, al: 'center' },
    { k: 'compensadasCredito', lb: 'Créd.', w: 34, al: 'center' },
    { k: 'eventos', lb: 'Eventos', w: larguraUtil - (52 + 40 + 108 * 3 + 46 + 42 + 46 + 40 + 34 + 34) },
  ];

  const desenharCabecalho = (yy: number) => {
    doc.rect(34, yy, larguraUtil, 18).fill(CAB_BG);
    let x = 34;
    doc.font('Helvetica-Bold').fontSize(7).fillColor(TINTA);
    for (const c of cols) {
      doc.text(c.lb, x + 3, yy + 5, { width: c.w - 6, align: c.al ?? 'left' });
      x += c.w;
    }
    return yy + 18;
  };

  y = desenharCabecalho(y);

  const alturaLinha = (l: LinhaEspelho) => {
    // eventos ou colunas de marcação podem quebrar em 2 linhas
    doc.font('Helvetica').fontSize(7);
    const alturas = [
      doc.heightOfString(l.marcacoesOriginais || '—', { width: 108 - 6 }),
      doc.heightOfString(l.jornadaRealizada || '—', { width: 108 - 6 }),
      doc.heightOfString(l.eventos || '', { width: cols[cols.length - 1]!.w - 6 }),
    ];
    return Math.max(14, ...alturas.map((a) => a + 5));
  };

  doc.font('Helvetica').fontSize(7);
  for (const l of d.linhas) {
    const h = alturaLinha(l);
    if (y + h > doc.page.height - 90) {
      doc.addPage({ size: 'A4', layout: 'landscape', margins: { top: 34, bottom: 40, left: 34, right: 34 } });
      y = 40;
      y = desenharCabecalho(y);
    }
    // zebra leve para folga/feriado
    if (l.tipoDia !== 'TRAB') { doc.rect(34, y, larguraUtil, h).fill('#FBF7F0'); }
    let x = 34;
    doc.fillColor(TINTA).font('Helvetica').fontSize(7);
    const valores: Record<string, string> = {
      data: `${fmtData(l.data).slice(0, 5)} ${diaSemana(l.data, d.fuso)}`,
      tipoDia: l.tipoDia,
      jornadaEsperada: l.jornadaEsperada || '—',
      marcacoesOriginais: l.marcacoesOriginais || '—',
      jornadaRealizada: l.jornadaRealizada || '—',
      horasRealizadas: l.horasRealizadas || '',
      horasPositivas: l.horasPositivas || '',
      atrasosFaltas: l.atrasosFaltas || '',
      horaNoturna: l.horaNoturna || '',
      compensadasDebito: l.compensadasDebito || '',
      compensadasCredito: l.compensadasCredito || '',
      eventos: l.eventos || '',
    };
    for (const c of cols) {
      const v = valores[c.k as string] ?? '';
      if (c.k === 'eventos' && v) doc.fillColor(CORAL); else doc.fillColor(TINTA);
      doc.text(v, x + 3, y + 3, { width: c.w - 6, align: c.al ?? 'left' });
      x += c.w;
    }
    doc.moveTo(34, y + h).lineTo(34 + larguraUtil, y + h).strokeColor(LINHA).lineWidth(0.4).stroke();
    y += h;
  }

  // ---- Totais ----
  y += 8;
  if (y > doc.page.height - 110) { doc.addPage({ size: 'A4', layout: 'landscape', margins: { top: 34, bottom: 40, left: 34, right: 34 } }); y = 40; }
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(TINTA);
  doc.text('Totais do período', 34, y);
  doc.font('Helvetica').fontSize(8).fillColor(CINZA);
  const tot = [
    `Total trabalhado: ${d.totais.trabalhado}`,
    `Horas normais esperadas: ${d.totais.horasNormaisEsperadas}`,
    d.totais.diurno ? `Horas diurnas: ${d.totais.diurno}` : '',
    d.totais.saldoBanco ? `Saldo do banco: ${d.totais.saldoBanco}` : '',
  ].filter(Boolean).join('       ');
  doc.text(tot, 34, y + 13, { width: larguraUtil });

  // ---- Concordância + assinaturas ----
  y += 44;
  if (y > doc.page.height - 80) { doc.addPage({ size: 'A4', layout: 'landscape', margins: { top: 34, bottom: 40, left: 34, right: 34 } }); y = 60; }

  if (d.assinaturaEletronica) {
    carimboAssinatura(doc, 34, y, larguraUtil, d.assinaturaEletronica);
    doc.font('Helvetica').fontSize(7).fillColor(CINZA)
      .text('A jornada é comprovada pelo Arquivo-Fonte de Dados (AFD), assinado digitalmente e imutável. Este espelho é documento de conferência.', 34, y + 84, { width: larguraUtil });
  } else {
    doc.font('Helvetica').fontSize(8.5).fillColor(TINTA)
      .text('Concordo com as marcações acima registradas.', 34, y, { width: larguraUtil });
    const yl = y + 42;
    const larguraAss = (larguraUtil - 60) / 2;
    doc.moveTo(34, yl).lineTo(34 + larguraAss, yl).strokeColor(TINTA).lineWidth(0.6).stroke();
    doc.moveTo(34 + larguraAss + 60, yl).lineTo(34 + larguraUtil, yl).strokeColor(TINTA).lineWidth(0.6).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(CINZA)
      .text('Assinatura do funcionário', 34, yl + 4, { width: larguraAss, align: 'center' })
      .text('Assinatura do gestor', 34 + larguraAss + 60, yl + 4, { width: larguraAss, align: 'center' });
  }

  doc.end();
  return pronto;
}
