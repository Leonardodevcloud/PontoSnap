import PDFDocument from 'pdfkit';
import type { RepConfig } from '@ponto/shared';
import { offsetMin } from '../datetime.js';

export interface DadosComprovante {
  rep: Pick<RepConfig, 'razaoSocial' | 'tipoIdEmpregador' | 'documentoEmpregador' | 'numeroInpi'>;
  empregado: { nome: string; cpf: string };
  marcacao: { nsr: number; dtMarcacao: Date; hashRegistro?: string };
  localPrestacao: string;
  /** Fuso do tenant. Ausente = Brasília (-0300). */
  fuso?: string;
}

const fmtDoc = (d: string): string => {
  const s = String(d || '').replace(/\D/g, '');
  if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return s;
};

const fmtDataHora = (data: Date, fuso: string): string => {
  const l = new Date(data.getTime() + offsetMin(fuso) * 60000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(l.getUTCDate())}/${p(l.getUTCMonth() + 1)}/${l.getUTCFullYear()} ` +
    `${p(l.getUTCHours())}:${p(l.getUTCMinutes())}:${p(l.getUTCSeconds())}`;
};

/** Gera o Comprovante de Registro de Ponto (PDF). Assinatura PAdES é etapa à parte. */
export function gerarComprovante(dados: DadosComprovante): Promise<Buffer> {
  const { rep, empregado, marcacao, localPrestacao, fuso = '-0300' } = dados;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [297, 420], margins: { top: 24, left: 24, right: 24, bottom: 24 } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const roxo = '#7c3aed';
    const linha = (y: number) => doc.moveTo(24, y).lineTo(273, y).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
    const campo = (rotulo: string, valor: string) => {
      doc.fillColor('#6b7280').font('Helvetica').fontSize(7).text(rotulo);
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(9).text(valor || '-');
      doc.moveDown(0.35);
    };

    doc.fillColor(roxo).font('Helvetica-Bold').fontSize(11)
      .text('Comprovante de Registro', { align: 'center' })
      .text('de Ponto do Trabalhador', { align: 'center' });
    doc.moveDown(0.5); linha(doc.y); doc.moveDown(0.5);

    campo('EMPREGADOR', rep.razaoSocial);
    campo(rep.tipoIdEmpregador === 2 ? 'CPF' : 'CNPJ', fmtDoc(rep.documentoEmpregador));
    campo('LOCAL DE PRESTAÇÃO', localPrestacao);
    linha(doc.y); doc.moveDown(0.5);

    campo('TRABALHADOR', empregado.nome);
    campo('CPF', fmtDoc(empregado.cpf));
    linha(doc.y); doc.moveDown(0.5);

    doc.fillColor('#6b7280').font('Helvetica').fontSize(7).text('DATA E HORA DA MARCAÇÃO');
    doc.fillColor(roxo).font('Helvetica-Bold').fontSize(14).text(fmtDataHora(marcacao.dtMarcacao, fuso));
    doc.moveDown(0.4);
    campo('NSR (Nº SEQUENCIAL DE REGISTRO)', String(marcacao.nsr).padStart(9, '0'));
    linha(doc.y); doc.moveDown(0.5);

    doc.fillColor('#6b7280').font('Helvetica').fontSize(6)
      .text(`REP-P • Registro INPI: ${rep.numeroInpi}`, { align: 'center' })
      .text(`Hash: ${(marcacao.hashRegistro || '').slice(0, 32)}...`, { align: 'center' })
      .text('Documento assinado digitalmente (ICP-Brasil / PAdES)', { align: 'center' });

    doc.end();
  });
}

/** Gancho de assinatura PAdES — depende do certificado ICP-Brasil do tenant. */
export async function assinarComprovantePAdES(
  _pdf: Buffer,
  _cert: { pfxBuffer: Buffer; senha: string },
): Promise<Buffer> {
  throw new Error('assinarComprovantePAdES: plugar certificado ICP-Brasil (.pfx) do empregador');
}
