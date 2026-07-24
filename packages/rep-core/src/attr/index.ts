import PDFDocument from 'pdfkit';

/**
 * Atestado Técnico e Termo de Responsabilidade — art. 89 da Portaria MTP
 * 671/2021, no formato do modelo oficial publicado no portal gov.br
 * (modelo-do-atestado-tecnico-e-termo-de-responsabilidade.pdf).
 *
 * O documento sai SEM assinatura: a Portaria (art. 89, § 2º) exige assinatura
 * eletrônica qualificada de PESSOA FÍSICA — do responsável legal E do
 * responsável técnico. Ou seja, o PDF é gerado aqui e assinado fora, com o
 * e-CPF de cada um (ou pelo assinador gov.br).
 *
 * Um ATTR por CNPJ matriz do cliente. É o cliente que precisa guardar o
 * documento para apresentar à Inspeção do Trabalho.
 */
export interface DadosATTR {
  /** Quem desenvolve o programa (você). */
  desenvolvedor: { razaoSocial: string; documento: string };
  responsavelLegal: { nome: string; cpf: string };
  responsavelTecnico: { nome: string; cpf: string };
  programa: {
    /** REP-P engloba o PTRP (coleta + armazenamento + tratamento). */
    tipo?: string;
    identificador: string;
    versao: string;
    numeroInpi: string;
    /** Nº do certificado de registro de programa de computador no INPI. */
    certificadoInpi?: string | null;
  };
  /** Empresa usuária que recebe o atestado. */
  destinatario: { razaoSocial: string; documento: string };
  dataEmissao?: Date;
}

const fmtDoc = (d: string): string => {
  const s = String(d ?? '').replace(/\D/g, '');
  if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return d;
};

export function gerarATTR(d: DadosATTR): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 64, left: 64, right: 64 } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const pronto = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));

  const campo = (rotulo: string, valor: string) => {
    doc.font('Helvetica-Bold').fontSize(10).text(`${rotulo}: `, { continued: true });
    doc.font('Helvetica').text(valor || 'N/A');
  };

  doc.font('Helvetica-Bold').fontSize(13)
    .text('ATESTADO TÉCNICO E TERMO DE RESPONSABILIDADE', { align: 'center' });
  doc.moveDown(1.5);

  // Parágrafo de abertura — redação do modelo oficial. O modelo prevê
  // "(razão social ou nome)" e "(CNPJ/CPF)", ou seja, já contempla
  // desenvolvedor pessoa física; aqui só ajustamos a palavra que antecede.
  const ehPF = String(d.desenvolvedor.documento ?? '').replace(/\D/g, '').length === 11;
  doc.font('Helvetica').fontSize(10.5).text(
    `Na qualidade de responsável técnico e de responsável legal ${ehPF ? 'do desenvolvedor' : 'da empresa'} ` +
    `${d.desenvolvedor.razaoSocial}, (CNPJ/CPF nº ${fmtDoc(d.desenvolvedor.documento)}), os signatários abaixo, ` +
    'em atenção ao art. 89 da Portaria MTP nº 671/2021, atestam e declaram que o equipamento e/ou programa ' +
    'identificados abaixo estão em conformidade com a Portaria MTP nº 671/2021.',
    { align: 'justify', lineGap: 2 });
  doc.moveDown(1.2);

  campo('Tipo do REP/PTRP', d.programa.tipo ?? 'REP-P');
  campo('Marca Equipamento', 'N/A');
  campo('Modelo Equipamento', 'N/A');
  campo('Certificado de conformidade', 'N/A');
  campo('Número de fabricação', 'N/A');
  campo('Número de registro no INPI', d.programa.numeroInpi);
  campo('Certificado de registro de programa de computador no INPI', d.programa.certificadoInpi ?? '');
  campo('Identificador do Programa', d.programa.identificador);
  campo('Versão do Programa', d.programa.versao);
  // Os campos de assinatura eletrônica abaixo são exigidos somente do REP-C.
  campo('Assinatura Eletrônica (somente REP-C)', 'N/A');
  campo('Chave pública', 'N/A');
  campo('Algoritmo de criptografia assimétrica', 'N/A');
  campo('Algoritmo de hash', 'N/A');

  doc.moveDown(1.2);
  doc.font('Helvetica').fontSize(10.5).text(
    'Declaramos ainda, que estamos cientes das consequências legais, cíveis e criminais, quanto à falsa ' +
    'declaração, falso atestado e falsidade ideológica. Reiteramos ao usuário que este documento deve ficar ' +
    'disponível para pronta apresentação para a Inspeção do Trabalho.',
    { align: 'justify', lineGap: 2 });

  doc.moveDown(1.2);
  doc.font('Helvetica-Bold').fontSize(10.5).text('Empresa/Pessoa Destinatária:');
  doc.moveDown(0.3);
  campo('Razão Social', d.destinatario.razaoSocial);
  campo('CNPJ/CPF', fmtDoc(d.destinatario.documento));

  doc.moveDown(3);
  const linhaAssinatura = (nome: string, cpf: string, papel: string) => {
    doc.font('Helvetica').fontSize(10).text('___________________________________________');
    doc.text(`${nome} — CPF ${fmtDoc(cpf)}`);
    doc.font('Helvetica-Bold').text(papel);
    doc.moveDown(1.8);
  };
  linhaAssinatura(d.responsavelLegal.nome, d.responsavelLegal.cpf, 'Responsável Legal');
  linhaAssinatura(d.responsavelTecnico.nome, d.responsavelTecnico.cpf, 'Responsável Técnico');

  const emissao = d.dataEmissao ?? new Date();
  doc.font('Helvetica').fontSize(8.5).fillColor('#666').text(
    `Emitido em ${emissao.toLocaleDateString('pt-BR')}. Este documento deve ser assinado eletronicamente ` +
    'pelas pessoas físicas indicadas acima (art. 89, § 2º, da Portaria MTP nº 671/2021).',
    { align: 'center' });

  doc.end();
  return pronto;
}
