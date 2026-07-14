import forge from 'node-forge';

/** Certificado ICP-Brasil normalizado em PEM. */
export interface CertificadoICP {
  certificadoPem: string;
  chavePrivadaPem: string;
}

// OIDs com tipos concretos (evita string|undefined do noUncheckedIndexedAccess).
const OID = forge.pki.oids as unknown as {
  pkcs8ShroudedKeyBag: string; certBag: string; sha256: string;
  contentType: string; data: string; messageDigest: string; signingTime: string;
};

/** Carrega um certificado a partir de um arquivo .pfx/.p12 (ICP-Brasil A1). */
export function carregarPfx(pfx: Buffer, senha: string): CertificadoICP {
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary')));
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, senha);

  const keyBag = p12.getBags({ bagType: OID.pkcs8ShroudedKeyBag })[OID.pkcs8ShroudedKeyBag]?.[0];
  const certBag = p12.getBags({ bagType: OID.certBag })[OID.certBag]?.[0];
  if (!keyBag?.key || !certBag?.cert) throw new Error('PFX inválido: chave ou certificado ausente');

  return {
    chavePrivadaPem: forge.pki.privateKeyToPem(keyBag.key),
    certificadoPem: forge.pki.certificateToPem(certBag.cert),
  };
}

/**
 * Assinatura CAdES DESTACADA (detached) — gera o conteúdo do arquivo .p7s (DER).
 * Usada para AFD e AEJ, nomeados como `arquivo.txt.p7s`.
 */
export function assinarCAdESDestacado(conteudo: Buffer, cert: CertificadoICP): Buffer {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(conteudo.toString('binary'));

  const certificate = forge.pki.certificateFromPem(cert.certificadoPem);
  const privateKey = forge.pki.privateKeyFromPem(cert.chavePrivadaPem);
  p7.addCertificate(certificate);
  p7.addSigner({
    key: privateKey as forge.pki.rsa.PrivateKey,
    certificate,
    digestAlgorithm: OID.sha256,
    authenticatedAttributes: [
      { type: OID.contentType, value: OID.data },
      { type: OID.messageDigest },
      { type: OID.signingTime, value: new Date().toString() },
    ],
  });

  p7.sign({ detached: true });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return Buffer.from(der, 'binary');
}

/** Extrai CN e validade (notAfter) de um certificado em PEM. */
export function infoCertificado(certificadoPem: string): { cn: string | null; validade: Date | null } {
  const cert = forge.pki.certificateFromPem(certificadoPem);
  const campo = cert.subject.getField('CN') as { value?: string } | null;
  return { cn: campo?.value ?? null, validade: cert.validity.notAfter ?? null };
}
