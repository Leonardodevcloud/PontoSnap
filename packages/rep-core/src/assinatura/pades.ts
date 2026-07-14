import signpdf from '@signpdf/signpdf';
import { P12Signer } from '@signpdf/signer-p12';
import { plainAddPlaceholder } from '@signpdf/placeholder-plain';

/**
 * Assinatura PAdES em PDF (comprovante). Recebe o .pfx do empregador.
 * Insere o placeholder de assinatura e assina com o certificado ICP-Brasil.
 */
export async function assinarPdfPAdES(
  pdf: Buffer,
  pfx: { pfxBuffer: Buffer; senha: string },
  meta: { motivo?: string; local?: string; nome?: string } = {},
): Promise<Buffer> {
  const comPlaceholder = plainAddPlaceholder({
    pdfBuffer: pdf,
    reason: meta.motivo ?? 'Comprovante de Registro de Ponto',
    location: meta.local ?? '',
    name: meta.nome ?? '',
    contactInfo: '',
  });
  const signer = new P12Signer(pfx.pfxBuffer, { passphrase: pfx.senha });
  return signpdf.sign(comPlaceholder, signer);
}
