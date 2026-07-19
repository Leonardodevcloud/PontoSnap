import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { auditoria, tenant, comTenant, type Db } from '@ponto/db';
import { inicioDoDia, fimDoDia } from '@ponto/rep-core';
import { DB } from '../database/database.module';

@Injectable()
export class AuditoriaService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Trilha do próprio cliente, filtrável por usuário e por período. */
  async listar(tenantId: string, f: { usuarioId?: string; inicio?: string; fim?: string; limite?: number }) {
    const limite = Math.min(f.limite ?? 100, 500);
    return comTenant(this.db, tenantId, async (tx) => {
      const fuso = (await tx.select({ fuso: tenant.fuso }).from(tenant).where(eq(tenant.id, tenantId)).limit(1))[0]?.fuso ?? '-0300';
      const conds = [eq(auditoria.tenantId, tenantId)];
      if (f.usuarioId) conds.push(eq(auditoria.usuarioId, f.usuarioId));
      if (f.inicio) conds.push(gte(auditoria.em, inicioDoDia(f.inicio, fuso)));
      if (f.fim) conds.push(lte(auditoria.em, fimDoDia(f.fim, fuso)));
      return tx.select({
        id: auditoria.id, usuarioEmail: auditoria.usuarioEmail, usuarioPerfil: auditoria.usuarioPerfil,
        acao: auditoria.acao, detalhe: auditoria.detalhe, statusHttp: auditoria.statusHttp,
        ip: auditoria.ip, em: auditoria.em,
      }).from(auditoria).where(and(...conds)).orderBy(desc(auditoria.em)).limit(limite);
    });
  }
}
