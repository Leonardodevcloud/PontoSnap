import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { comoMaster, empregado, tenant, usuario, type Db } from '@ponto/db';
import { DB } from '../database/database.module';

/** Um vínculo da pessoa com uma empresa do grupo (o atual e os anteriores, por transferência). */
export interface Vinculo {
  tenantId: string;
  empregadoId: string;
  cpf: string;
  empresa: string;
  /** Primeiro dia no ponto desta empresa (nulo = desde o cadastro). */
  inicio: string | null;
  /** Primeiro dia fora (já na empresa seguinte). Nulo = vínculo atual. */
  saida: string | null;
  atual: boolean;
}

/**
 * Vínculos do funcionário logado: o cadastro atual e, seguindo
 * empregado_anterior_id (gravado só pela transferência entre CNPJs), os das
 * empresas anteriores. Nada é movido entre empresas: o app só passa a mostrar
 * o que é dele em cada uma, e cada registro continua na empresa que o emitiu.
 */
@Injectable()
export class VinculoService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async meus(usuarioId: string): Promise<Vinculo[]> {
    return comoMaster(this.db, async (tx) => {
      const u = (await tx.select({ empregadoId: usuario.empregadoId }).from(usuario).where(eq(usuario.id, usuarioId)).limit(1))[0];
      const lista: Vinculo[] = [];
      let id = u?.empregadoId ?? null;
      const vistos = new Set<string>();
      while (id && !vistos.has(id) && lista.length < 20) {
        vistos.add(id);
        const e = (await tx.select({
          id: empregado.id, cpf: empregado.cpf, tenantId: empregado.tenantId, inicio: empregado.dataInicioPonto, saida: empregado.dataSaida,
          anterior: empregado.empregadoAnteriorId, empresa: tenant.razaoSocial,
        }).from(empregado).innerJoin(tenant, eq(tenant.id, empregado.tenantId)).where(eq(empregado.id, id)).limit(1))[0];
        if (!e) break;
        lista.push({ tenantId: e.tenantId, empregadoId: e.id, cpf: e.cpf, empresa: e.empresa, inicio: e.inicio ?? null, saida: lista.length ? e.saida ?? null : null, atual: lista.length === 0 });
        id = e.anterior;
      }
      return lista;
    });
  }

  /**
   * O vínculo pedido (tenantId de uma empresa anterior), ou o atual. Só aceita
   * empresas da cadeia do próprio funcionário.
   */
  async resolver(usuarioId: string, tenantAtual: string, tenantPedido?: string | null): Promise<Vinculo> {
    const vs = await this.meus(usuarioId);
    if (!vs.length) throw new ForbiddenException('Este acesso não está vinculado a um funcionário.');
    if (!tenantPedido || tenantPedido === tenantAtual) {
      const atual = vs.find((v) => v.tenantId === tenantAtual) ?? vs[0]!;
      return atual;
    }
    const v = vs.find((x) => x.tenantId === tenantPedido);
    if (!v) throw new ForbiddenException('Empresa fora dos seus vínculos.');
    return v;
  }
}
