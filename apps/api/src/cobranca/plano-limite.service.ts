import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { assinatura, plano, empregado, comTenant, type Db } from '@ponto/db';
import { DB } from '../database/database.module';

export interface UsoDoPlano {
  planoNome: string | null;
  maxFuncionarios: number | null;
  funcionariosAtivos: number;
  restam: number | null;       // null = sem limite
  atingiuLimite: boolean;
}

/**
 * Verifica e impõe os limites do plano contratado.
 *
 * Regra: se a assinatura aponta para um plano com max_funcionarios definido,
 * a empresa não pode ter mais empregados ativos do que esse teto.
 * Se não tem assinatura ou o plano não tem teto → sem restrição (libera).
 *
 * "Suspensa" NÃO bloqueia criação — consistente com a filosofia de billing
 * do PontoSnap (não cortar acesso durante disputa comercial).
 */
@Injectable()
export class PlanoLimiteService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Conta funcionários ativos e compara com o teto do plano. */
  async uso(tenantId: string): Promise<UsoDoPlano> {
    return comTenant(this.db, tenantId, async (tx) => {
      // Busca assinatura → plano
      const ass = (await tx.select().from(assinatura)
        .where(eq(assinatura.tenantId, tenantId)).limit(1))[0];

      let planoNome: string | null = null;
      let maxFuncionarios: number | null = null;

      if (ass?.planoId) {
        const pl = (await tx.select().from(plano)
          .where(eq(plano.id, ass.planoId)).limit(1))[0];
        if (pl) {
          planoNome = pl.nome;
          maxFuncionarios = pl.maxFuncionarios;
        }
      }

      // Conta ativos
      const ativos = await tx.select({ id: empregado.id }).from(empregado)
        .where(and(eq(empregado.tenantId, tenantId), eq(empregado.ativo, true)));
      const funcionariosAtivos = ativos.length;

      const restam = maxFuncionarios != null ? Math.max(0, maxFuncionarios - funcionariosAtivos) : null;
      const atingiuLimite = maxFuncionarios != null && funcionariosAtivos >= maxFuncionarios;

      return { planoNome, maxFuncionarios, funcionariosAtivos, restam, atingiuLimite };
    });
  }

  /**
   * Trava a criação se o plano está no teto.
   * Chamada antes de inserir empregado(s). `qtdNovos` permite validar
   * importação em lote de uma vez (ex.: "vou importar 15, cabe?").
   */
  async exigirVaga(tenantId: string, qtdNovos = 1): Promise<void> {
    const u = await this.uso(tenantId);
    if (u.maxFuncionarios == null) return; // sem teto, libera
    if (u.funcionariosAtivos + qtdNovos > u.maxFuncionarios) {
      throw new ForbiddenException(
        `Limite do plano ${u.planoNome ?? ''} atingido: ` +
        `${u.funcionariosAtivos}/${u.maxFuncionarios} funcionários. ` +
        `Faça upgrade do plano para cadastrar mais.`,
      );
    }
  }
}
