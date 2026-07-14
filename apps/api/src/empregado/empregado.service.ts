import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { empregado, pontoHorarioContratual, comTenant, type Db } from '@ponto/db';
import { DB } from '../database/database.module';
import { hashPin } from '../auth/pin';

export interface CriarEmpregadoParams {
  cpf: string; nome: string; matricula?: string; pin?: string; pis?: string; salarioMensal?: number;
}

type EmpregadoRow = typeof empregado.$inferSelect;

@Injectable()
export class EmpregadoService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Remove campos sensíveis antes de devolver ao cliente. */
  private semSegredos(e: EmpregadoRow) {
    const { pinHash, ...resto } = e;
    return { ...resto, temPin: pinHash != null };
  }

  async criar(tenantId: string, p: CriarEmpregadoParams) {
    return comTenant(this.db, tenantId, async (tx) => {
      const dup = await tx.select().from(empregado)
        .where(and(eq(empregado.tenantId, tenantId), eq(empregado.cpf, p.cpf))).limit(1);
      if (dup[0]) throw new ConflictException('Já existe empregado com este CPF');

      const pinHash = p.pin ? await hashPin(p.pin) : null;
      const rows = await tx.insert(empregado).values({
        tenantId, cpf: p.cpf, nome: p.nome,
        matricula: p.matricula ?? null, pinHash, pis: p.pis ?? null,
        salarioMensal: p.salarioMensal != null ? String(p.salarioMensal) : null,
      }).returning();
      return this.semSegredos(rows[0]!);
    });
  }

  async listar(tenantId: string) {
    const rows = await comTenant(this.db, tenantId, (tx) => tx.select().from(empregado));
    return rows.map((e) => this.semSegredos(e));
  }

  async obter(tenantId: string, id: string) {
    const rows = await comTenant(this.db, tenantId, (tx) =>
      tx.select().from(empregado).where(and(eq(empregado.id, id), eq(empregado.tenantId, tenantId))).limit(1));
    if (!rows[0]) throw new NotFoundException('Empregado não encontrado');
    return this.semSegredos(rows[0]);
  }

  /** Define/atualiza o PIN do quiosque (armazenado com hash). */
  async definirPin(tenantId: string, id: string, pin: string) {
    const pinHash = await hashPin(pin);
    const rows = await comTenant(this.db, tenantId, (tx) =>
      tx.update(empregado).set({ pinHash })
        .where(and(eq(empregado.id, id), eq(empregado.tenantId, tenantId))).returning());
    if (!rows[0]) throw new NotFoundException('Empregado não encontrado');
    return { id, pinDefinido: true };
  }

  async definirAtivo(tenantId: string, id: string, ativo: boolean) {
    const rows = await comTenant(this.db, tenantId, (tx) =>
      tx.update(empregado).set({ ativo })
        .where(and(eq(empregado.id, id), eq(empregado.tenantId, tenantId))).returning());
    if (!rows[0]) throw new NotFoundException('Empregado não encontrado');
    return this.semSegredos(rows[0]);
  }

  /** Vincula uma escala/horário contratual ao funcionário. */
  async definirHorario(tenantId: string, id: string, horarioContratualId: string) {
    return comTenant(this.db, tenantId, async (tx) => {
      const hor = await tx.select().from(pontoHorarioContratual)
        .where(and(eq(pontoHorarioContratual.id, horarioContratualId), eq(pontoHorarioContratual.tenantId, tenantId))).limit(1);
      if (!hor[0]) throw new NotFoundException('Horário não encontrado');
      const rows = await tx.update(empregado).set({ horarioContratualId })
        .where(and(eq(empregado.id, id), eq(empregado.tenantId, tenantId))).returning();
      if (!rows[0]) throw new NotFoundException('Empregado não encontrado');
      return this.semSegredos(rows[0]);
    });
  }

  async definirSalario(tenantId: string, id: string, salarioMensal: number) {
    const rows = await comTenant(this.db, tenantId, (tx) =>
      tx.update(empregado).set({ salarioMensal: String(salarioMensal) })
        .where(and(eq(empregado.id, id), eq(empregado.tenantId, tenantId))).returning());
    if (!rows[0]) throw new NotFoundException('Empregado não encontrado');
    return this.semSegredos(rows[0]);
  }
}
