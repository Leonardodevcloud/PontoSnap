import { Injectable, NotFoundException } from '@nestjs/common';
import { carregarPfx, infoCertificado, type CertificadoICP } from '@ponto/rep-core';

/**
 * Certificado ICP-Brasil (e-CPF A1) do DESENVOLVEDOR da plataforma.
 *
 * É UM certificado só, o seu, que assina os arquivos fiscais de todos os
 * clientes — no REP-P quem assina é o programa (o desenvolvedor), não cada
 * empresa usuária. Por isso ele não é dado de tenant: é segredo de
 * infraestrutura, e mora em variável de ambiente, nunca no banco.
 *
 *   PLATAFORMA_CERT_PFX_B64  → o .pfx inteiro, em base64
 *   PLATAFORMA_CERT_SENHA    → a senha do .pfx
 *
 * Para gerar o base64:
 *   Windows (PowerShell):  [Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx")) > cert.b64.txt
 *   Linux/Mac:             base64 -w0 cert.pfx > cert.b64.txt
 */
@Injectable()
export class CertificadoService {
  private cache: { icp: CertificadoICP; pfxBuffer: Buffer; senha: string } | null = null;

  private lerEnv(): { pfxBuffer: Buffer; senha: string } | null {
    const b64 = process.env.PLATAFORMA_CERT_PFX_B64;
    const senha = process.env.PLATAFORMA_CERT_SENHA;
    if (!b64 || !senha) return null;
    return { pfxBuffer: Buffer.from(b64, 'base64'), senha };
  }

  /**
   * Carrega o certificado da plataforma. O tenantId é aceito por compatibilidade
   * com quem chama, mas ignorado: o certificado é único, não por cliente.
   */
  async carregar(_tenantId?: string): Promise<{ icp: CertificadoICP; pfxBuffer: Buffer; senha: string }> {
    if (this.cache) return this.cache;
    const env = this.lerEnv();
    if (!env) {
      throw new NotFoundException(
        'Certificado da plataforma não configurado. Defina PLATAFORMA_CERT_PFX_B64 e PLATAFORMA_CERT_SENHA no ambiente.');
    }
    // carregarPfx lança se o .pfx ou a senha estiverem errados.
    const icp = carregarPfx(env.pfxBuffer, env.senha);
    this.cache = { icp, pfxBuffer: env.pfxBuffer, senha: env.senha };
    return this.cache;
  }

  async temCertificado(_tenantId?: string): Promise<boolean> {
    const env = this.lerEnv();
    if (!env) return false;
    try { carregarPfx(env.pfxBuffer, env.senha); return true; } catch { return false; }
  }

  /** Info pública do certificado (CN e validade), sem expor segredo. */
  async info(_tenantId?: string) {
    const { icp } = await this.carregar();
    const info = infoCertificado(icp.certificadoPem);
    return { cn: info.cn, validade: info.validade, ativo: true };
  }
}
