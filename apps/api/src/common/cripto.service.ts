import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Cifra/decifra segredos em repouso (AES-256-GCM). Formato: iv:tag:cipher (base64). */
@Injectable()
export class CriptoService {
  private chave(): Buffer {
    const raw = process.env.APP_CRYPTO_KEY;
    const key = raw ? Buffer.from(raw, 'base64') : Buffer.alloc(32); // fallback DEV — definir em produção
    if (key.length !== 32) throw new Error('APP_CRYPTO_KEY deve ter 32 bytes em base64');
    return key;
  }

  cifrar(texto: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.chave(), iv);
    const enc = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
    return [iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
  }

  /** Cifra bytes crus (arquivo). Formato: iv(12) + tag(16) + cipher. */
  cifrarBytes(dados: Buffer): Buffer {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.chave(), iv);
    const enc = Buffer.concat([c.update(dados), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), enc]);
  }

  decifrarBytes(blob: Buffer): Buffer {
    if (blob.length < 29) throw new Error('Blob cifrado inválido');
    const d = createDecipheriv('aes-256-gcm', this.chave(), blob.subarray(0, 12));
    d.setAuthTag(blob.subarray(12, 28));
    return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
  }

  decifrar(blob: string): string {
    const [ivB, tagB, encB] = blob.split(':');
    if (!ivB || !tagB || !encB) throw new Error('Blob cifrado inválido');
    const d = createDecipheriv('aes-256-gcm', this.chave(), Buffer.from(ivB, 'base64'));
    d.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([d.update(Buffer.from(encB, 'base64')), d.final()]).toString('utf8');
  }
}
