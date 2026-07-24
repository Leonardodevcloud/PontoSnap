import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { tenant, comoMaster, comTenant, type Db } from '@ponto/db';
import { DB } from '../database/database.module';
import { registrarEventoRep, EVENTO_DISPONIVEL, EVENTO_INDISPONIVEL } from './evento-rep';

/**
 * Registro 6 do AFD — eventos sensíveis. Para o REP-P, o leiaute prevê
 * "07": disponibilidade de serviço e "08": indisponibilidade de serviço.
 *
 * Como cada cliente tem o seu REP (e a sua sequência de NSR), o evento é
 * gravado uma vez por cliente ativo, na subida e na parada da API.
 */
@Injectable()
export class DisponibilidadeService {
  private readonly log = new Logger('Disponibilidade');

  constructor(@Inject(DB) private readonly db: Db) {}

  async registrar(tipoEvento: number): Promise<number> {
    const tenants = await comoMaster(this.db, (tx) =>
      tx.select({ id: tenant.id }).from(tenant).where(eq(tenant.ativo, true)));
    let gravados = 0;
    for (const t of tenants) {
      try {
        const nsr = await comTenant(this.db, t.id, (tx) =>
          registrarEventoRep(tx as never, t.id, { tipo: 6, tipoEvento }));
        if (nsr != null) gravados++;
      } catch (e) {
        // Um cliente com problema não pode impedir a API de subir nem de parar.
        this.log.warn(`Evento de serviço não gravado para o tenant ${t.id}: ${(e as Error).message}`);
      }
    }
    return gravados;
  }

  aoSubir() { return this.registrar(EVENTO_DISPONIVEL); }
  aoParar() { return this.registrar(EVENTO_INDISPONIVEL); }
}
