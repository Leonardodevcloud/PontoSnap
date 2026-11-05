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
    /** Banco de horas: anterior + mês = acumulado (só quando há banco). */
    bancoSaldoAnterior?: string;
    bancoSaldoMes?: string;
    bancoSaldoAcumulado?: string;
    /**
     * Fechamento do mês (reconciliação). Campos ausentes/0 não são impressos.
     *   diferenca          = trabalhado − previsto
     *   extrasMes          = horas extras do mês (sem o feriado pago à parte)
     *   feriadoTrabalhado  = feriado/domingo 100% pago na folha (verba própria)
     *   atrasos            = atrasos e saídas antecipadas
     *   faltas             = faltas de dia inteiro
     *   indenizacoes       = intervalo/interjornada +50% (verba, fora do saldo)
     *   saldoLiquido       = extras produtivas − atrasos (sem indenização)
     *   toleranciaSumula366= (trabalhado − previsto) − saldo líquido
     */
    diferenca?: string;
    extrasMes?: string;
    feriadoTrabalhado?: string;
    atrasos?: string;
    faltas?: string;
    indenizacoes?: string;
    saldoLiquido?: string;
    toleranciaSumula366?: string;
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

const VERDE_SELO = '#0E7A50';

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

const TINTA = '#0F1B33';
const CORAL = '#2457D6';
const CINZA = '#55627A';
const LINHA = '#D3DAE6';
const CAB_BG = '#E6EDFC';

const fmtData = (iso: string) => { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; };
const diaSemana = (iso: string, fuso: string) =>
  ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(`${iso}T12:00:00${fuso}`).getUTCDay()];
const fmtDoc = (d: string) => {
  const s = String(d ?? '').replace(/\D/g, '');
  if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return d ?? '';
};

/** "0800-1200 1300-1700" → "08:00-12:00 13:00-17:00". Texto livre ("8h00 livre") passa intacto. */
function formatarJornadaEsperada(v: string): string {
  if (!v) return '—';
  return v.replace(/\b(\d{2})(\d{2})\b/g, '$1:$2');
}

/** "8h01" → 481 · "" → 0 · "-0h30" → -30. É o formato que as linhas do espelho usam. */
function minutosDeHhmm(v: string | undefined): number {
  const m = /^(-?)(\d+)h(\d{2})$/.exec((v ?? '').trim());
  if (!m) return 0;
  const n = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -n : n;
}

function hhmmDeMinutos(min: number): string {
  if (min === 0) return '';
  const a = Math.abs(min);
  return `${min < 0 ? '-' : ''}${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}`;
}

/** Onde fica a linha de assinatura, em % da página (para a assinatura eletrônica cair no lugar). */
export interface CampoAssinaturaPdf { pagina: number; x: number; y: number }
export interface CamposEspelho { funcionario: CampoAssinaturaPdf; gestor: CampoAssinaturaPdf }

export function gerarEspelhoPontoPdf(d: DadosEspelho): Promise<Buffer> {
  return gerarEspelhoPontoPdfComCampos(d).then((r) => r.buffer);
}

/** Igual ao gerarEspelhoPontoPdf, mas diz também onde estão as linhas de assinatura. */
export async function gerarEspelhoPontoPdfComCampos(d: DadosEspelho): Promise<{ buffer: Buffer; campos: CamposEspelho | null }> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 34, bottom: 40, left: 34, right: 34 } });
  let paginas = 1;
  doc.on('pageAdded', () => { paginas++; });
  let campos: CamposEspelho | null = null;
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
    if (l.tipoDia !== 'TRAB') { doc.rect(34, y, larguraUtil, h).fill('#F5F7FB'); }
    let x = 34;
    doc.fillColor(TINTA).font('Helvetica').fontSize(7);
    const valores: Record<string, string> = {
      data: `${fmtData(l.data).slice(0, 5)} ${diaSemana(l.data, d.fuso)}`,
      tipoDia: l.tipoDia,
      jornadaEsperada: formatarJornadaEsperada(l.jornadaEsperada),
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

  // ---- Linha consolidando cada coluna ----
  if (d.linhas.length > 0) {
    const h = 16;
    if (y + h > doc.page.height - 90) {
      doc.addPage({ size: 'A4', layout: 'landscape', margins: { top: 34, bottom: 40, left: 34, right: 34 } });
      y = 40;
      y = desenharCabecalho(y);
    }
    const soma = (k: keyof LinhaEspelho) => hhmmDeMinutos(d.linhas.reduce((acc, l) => acc + minutosDeHhmm(l[k] as string), 0));
    const totais: Record<string, string> = {
      data: 'Total', tipoDia: '',
      jornadaEsperada: `${d.linhas.filter((l) => l.tipoDia === 'TRAB').length} dia(s) trab.`,
      marcacoesOriginais: '', jornadaRealizada: '',
      horasRealizadas: soma('horasRealizadas'),
      horasPositivas: soma('horasPositivas'),
      atrasosFaltas: soma('atrasosFaltas'),
      horaNoturna: soma('horaNoturna'),
      compensadasDebito: soma('compensadasDebito'),
      compensadasCredito: soma('compensadasCredito'),
      eventos: '',
    };
    doc.rect(34, y, larguraUtil, h).fill(CAB_BG);
    let x = 34;
    doc.font('Helvetica-Bold').fontSize(7).fillColor(TINTA);
    for (const c of cols) {
      doc.text(totais[c.k as string] ?? '', x + 3, y + 4, { width: c.w - 6, align: c.al ?? 'left' });
      x += c.w;
    }
    doc.moveTo(34, y + h).lineTo(34 + larguraUtil, y + h).strokeColor(TINTA).lineWidth(0.6).stroke();
    y += h;
  }

  // ---- Fechamento do mês (reconciliação) ----
  y += 10;
  // altura do bloco: título + 3 faixas (+ banco, se houver)
  const alturaFech = 86 + (d.totais.bancoSaldoAcumulado != null ? 14 : 0);
  if (y + alturaFech > doc.page.height - 70) { doc.addPage({ size: 'A4', layout: 'landscape', margins: { top: 34, bottom: 40, left: 34, right: 34 } }); y = 40; }

  const T = d.totais;
  doc.save().roundedRect(34, y, larguraUtil, alturaFech - 6, 6).lineWidth(0.6).strokeColor(LINHA).stroke().restore();
  doc.font('Helvetica-Bold').fontSize(9).fillColor(TINTA).text('Fechamento do mês', 44, y + 8);

  // Faixa 1 — números-chave (célula rotulada)
  const celula = (x: number, w: number, rot: string, val: string, cor = TINTA) => {
    doc.font('Helvetica').fontSize(6.5).fillColor(CINZA).text(rot.toUpperCase(), x, y + 24, { width: w });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(cor).text(val, x, y + 33, { width: w });
  };
  const col = larguraUtil / 3;
  celula(44, col - 20, 'Horas trabalhadas', T.trabalhado);
  celula(44 + col, col - 20, 'Horas previstas', T.horasNormaisEsperadas);
  celula(44 + col * 2, col - 20, 'Diferença (trab. - prev.)', T.diferenca ?? '0h00', CORAL);

  // Faixa 2 — composição por natureza
  doc.moveTo(44, y + 52).lineTo(34 + larguraUtil - 10, y + 52).strokeColor(LINHA).lineWidth(0.4).stroke();
  const comp = [
    T.extrasMes ? `Horas extras: ${T.extrasMes}` : '',
    T.feriadoTrabalhado ? `Feriado trabalhado (100%, pago à parte): ${T.feriadoTrabalhado}` : '',
    T.indenizacoes ? `Indenização de intervalo (+50%): ${T.indenizacoes}` : '',
    T.atrasos ? `Atrasos/saídas antecipadas: ${T.atrasos}` : '',
    T.faltas ? `Faltas: ${T.faltas}` : '',
  ].filter(Boolean).join('      ');
  doc.font('Helvetica').fontSize(7.5).fillColor(TINTA).text(comp, 44, y + 58, { width: larguraUtil - 20 });

  // Faixa 3 — reconciliação em uma linha
  const recon = [
    `Saldo líquido: ${T.saldoLiquido ?? '0h00'}`,
    T.toleranciaSumula366 ? `Tolerância (Súmula 366): ${T.toleranciaSumula366}` : '',
    'Feriado trabalhado é verba própria 100%, não entra em horas extras. Indenização de intervalo é verba +50%, fora do saldo.',
  ].filter(Boolean).join('   ·   ');
  doc.font('Helvetica-Oblique').fontSize(6.5).fillColor(CINZA).text(recon, 44, y + 72, { width: larguraUtil - 20 });

  y += alturaFech;
  if (d.totais.bancoSaldoAcumulado != null) {
    const banco = [
      `Banco de horas — saldo anterior: ${d.totais.bancoSaldoAnterior ?? '0h00'}`,
      `este mês: ${d.totais.bancoSaldoMes ?? '0h00'}`,
      `acumulado: ${d.totais.bancoSaldoAcumulado}`,
    ].join('       ');
    doc.font('Helvetica').fontSize(8).fillColor(CINZA).text(banco, 44, y, { width: larguraUtil });
    y += 14;
  }

  // ---- Concordância + assinaturas ----
  y += 44;
  if (y > doc.page.height - 104) { doc.addPage({ size: 'A4', layout: 'landscape', margins: { top: 34, bottom: 40, left: 34, right: 34 } }); y = 60; }

  if (d.assinaturaEletronica) {
    carimboAssinatura(doc, 34, y, larguraUtil, d.assinaturaEletronica);
    doc.font('Helvetica').fontSize(7).fillColor(CINZA)
      .text('A jornada é comprovada pelo Arquivo-Fonte de Dados (AFD), assinado digitalmente e imutável. Este espelho é documento de conferência.', 34, y + 84, { width: larguraUtil });
  } else {
    doc.font('Helvetica').fontSize(8.5).fillColor(TINTA)
      .text('Concordo com as marcações acima registradas.', 34, y, { width: larguraUtil });
    const yl = y + 58; // espaço para o carimbo da assinatura eletrônica acima da linha
    const larguraAss = (larguraUtil - 60) / 2;
    doc.moveTo(34, yl).lineTo(34 + larguraAss, yl).strokeColor(TINTA).lineWidth(0.6).stroke();
    doc.moveTo(34 + larguraAss + 60, yl).lineTo(34 + larguraUtil, yl).strokeColor(TINTA).lineWidth(0.6).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(CINZA)
      .text('Assinatura do funcionário', 34, yl + 4, { width: larguraAss, align: 'center' })
      .text('Assinatura do gestor', 34 + larguraAss + 60, yl + 4, { width: larguraAss, align: 'center' });
    // Canto superior esquerdo do carimbo da assinatura: centrado na linha, logo acima dela.
    const W = doc.page.width, H = doc.page.height;
    const LARG = 150, ALT = 38;
    const campo = (x0: number): CampoAssinaturaPdf => ({
      pagina: paginas,
      x: Math.round(((x0 + larguraAss / 2 - LARG / 2) / W) * 1000) / 10,
      y: Math.round(((yl - ALT) / H) * 1000) / 10,
    });
    campos = { funcionario: campo(34), gestor: campo(34 + larguraAss + 60) };
  }

  doc.end();
  return { buffer: await pronto, campos };
}
