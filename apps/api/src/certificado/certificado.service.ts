import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { certificado, comTenant, type Db } from '@ponto/db';
import { carregarPfx, infoCertificado, type CertificadoICP } from '@ponto/rep-core';
import { DB } from '../database/database.module';
import { CriptoService } from '../common/cripto.service';

@Injectable()
export class CertificadoService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly cripto: CriptoService,
  ) {}

  /** Salva (cifrado) o .pfx do tenant, validando-o antes. */
  async salvar(tenantId: string, pfxBuffer: Buffer, senha: string) {
    const icp = carregarPfx(pfxBuffer, senha); // lança se pfx/senha inválidos
    const info = infoCertificado(icp.certificadoPem);
    const pfxCifrado = this.cripto.cifrar(pfxBuffer.toString('base64'));
    const senhaCifrada = this.cripto.cifrar(senha);

    await comTenant(this.db, tenantId, async (tx) => {
      await tx.delete(certificado).where(eq(certificado.tenantId, tenantId));
      await tx.insert(certificado).values({
        tenantId, pfxCifrado, senhaCifrada, cn: info.cn, validade: info.validade,
      });
    });
    return { cn: info.cn, validade: info.validade };
  }

  /** Carrega o certificado decifrado para assinatura. */
  async carregar(tenantId: string): Promise<{ icp: CertificadoICP; pfxBuffer: Buffer; senha: string }> {
    const row = (await comTenant(this.db, tenantId, (tx) =>
      tx.select().from(certificado).where(eq(certificado.tenantId, tenantId)).limit(1)))[0];
    if (!row) throw new NotFoundException('Certificado não cadastrado para este tenant');
    const pfxBuffer = Buffer.from(this.cripto.decifrar(row.pfxCifrado), 'base64');
    const senha = this.cripto.decifrar(row.senhaCifrada);
    return { icp: carregarPfx(pfxBuffer, senha), pfxBuffer, senha };
  }

  async temCertificado(tenantId: string): Promise<boolean> {
    const row = (await comTenant(this.db, tenantId, (tx) =>
      tx.select({ id: certificado.id }).from(certificado).where(eq(certificado.tenantId, tenantId)).limit(1)))[0];
    return !!row;
  }

  /** Info pública (sem segredos). */
  async info(tenantId: string) {
    const row = (await comTenant(this.db, tenantId, (tx) =>
      tx.select({ cn: certificado.cn, validade: certificado.validade, ativo: certificado.ativo })
        .from(certificado).where(eq(certificado.tenantId, tenantId)).limit(1)))[0];
    if (!row) throw new NotFoundException('Certificado não cadastrado');
    return row;
  }
}
