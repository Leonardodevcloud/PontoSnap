import { describe, it, expect } from 'vitest';
import forge from 'node-forge';
import { assinarCAdESDestacado, type CertificadoICP } from '../src/assinatura/cades.js';

function certAutoassinado(): CertificadoICP {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  const attrs = [{ name: 'commonName', value: 'Teste ICP' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    certificadoPem: forge.pki.certificateToPem(cert),
    chavePrivadaPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

describe('assinatura CAdES destacada', () => {
  const cert = certAutoassinado();
  it('produz um PKCS#7 SignedData destacado e parseável', () => {
    const p7s = assinarCAdESDestacado(Buffer.from('conteudo do AFD 123'), cert);
    expect(p7s.length).toBeGreaterThan(0);
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(p7s.toString('binary')));
    const msg = forge.pkcs7.messageFromAsn1(asn1) as unknown as { type: string };
    expect(msg.type).toBe(forge.pki.oids.signedData);
  });
});
