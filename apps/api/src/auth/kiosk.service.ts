import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { dispositivo, empregado, comTenant, comoMaster, type Db } from '@ponto/db';
import { DB } from '../database/database.module';
import { verificarPin } from './pin';

@Injectable()
export class KioskService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Admin registra um tablet. Retorna o token bruto UMA única vez. */
  async registrarDispositivo(tenantId: string, nome: string) {
    const secret = randomBytes(24).toString('hex');
    const tokenHash = await bcrypt.hash(secret, 10);
    const linhas = await comTenant(this.db, tenantId, (tx) =>
      tx.insert(dispositivo).values({ tenantId, nome, tokenHash }).returning());
    const d = linhas[0]!;
    return { token: `${d.id}.${secret}`, dispositivoId: d.id, nome };
  }

  /** Guard do quiosque: valida o token do dispositivo e devolve o tenant. */
  async resolverDispositivo(token: string): Promise<{ tenantId: string; dispositivoId: string }> {
    const [id, secret] = token.split('.');
    if (!id || !secret) throw new UnauthorizedException('Token de dispositivo malformado');
    const linhas = await comoMaster(this.db, (tx) =>
      tx.select().from(dispositivo)
        .where(and(eq(dispositivo.id, id), eq(dispositivo.ativo, true))).limit(1));
    const d = linhas[0];
    if (!d) throw new UnauthorizedException('Dispositivo não encontrado');
    const ok = await bcrypt.compare(secret, d.tokenHash);
    if (!ok) throw new UnauthorizedException('Token de dispositivo inválido');
    return { tenantId: d.tenantId, dispositivoId: d.id };
  }

  /**
   * Resolve o empregado por matrícula + PIN — a identidade INEQUÍVOCA da batida.
   * O CPF retornado é o que vai no AFD (registro tipo 7). PIN não é identidade
   * sozinho: a matrícula (única por tenant) localiza; o PIN confirma.
   */
  async identificar(tenantId: string, matricula: string, pin: string) {
    const linhas = await comTenant(this.db, tenantId, (tx) =>
      tx.select().from(empregado)
        .where(and(eq(empregado.tenantId, tenantId), eq(empregado.matricula, matricula), eq(empregado.ativo, true)))
        .limit(1));
    const e = linhas[0];
    if (!e || !e.pinHash) throw new UnauthorizedException('Matrícula ou PIN inválidos');
    const ok = await verificarPin(pin, e.pinHash);
    if (!ok) throw new UnauthorizedException('Matrícula ou PIN inválidos');
    return { empregadoId: e.id, nome: e.nome, cpf: e.cpf };
  }
}
