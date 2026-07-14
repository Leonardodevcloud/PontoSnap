import { Inject, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { pontoJob, comTenant, comoMaster, type Db } from '@ponto/db';
import { DB } from '../database/database.module';
import { TratamentoService } from '../tratamento/tratamento.service';

type Job = typeof pontoJob.$inferSelect;

@Injectable()
export class JobsService implements OnModuleInit {
  private emExecucao = false;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tratamento: TratamentoService,
  ) {}

  onModuleInit() {
    // processador in-process; desligável em testes com JOBS_LOOP=off
    if (process.env.JOBS_LOOP === 'off') return;
    setInterval(() => void this.tick(), 3000);
  }

  private async tick() {
    if (this.emExecucao) return;
    this.emExecucao = true;
    try { await this.processarPendentes(); } catch { /* silencioso */ } finally { this.emExecucao = false; }
  }

  /** Enfileira um job e retorna imediatamente. */
  async enfileirar(tenantId: string, tipo: string, params: Record<string, unknown>) {
    const j = (await comTenant(this.db, tenantId, (tx) =>
      tx.insert(pontoJob).values({ tenantId, tipo, params }).returning()))[0]!;
    return { id: j.id, tipo: j.tipo, status: j.status };
  }

  async obter(tenantId: string, id: string) {
    const j = (await comTenant(this.db, tenantId, (tx) =>
      tx.select().from(pontoJob).where(and(eq(pontoJob.tenantId, tenantId), eq(pontoJob.id, id))).limit(1)))[0];
    if (!j) throw new NotFoundException('Job não encontrado');
    return { id: j.id, tipo: j.tipo, status: j.status, resultado: j.resultado, erro: j.erro };
  }

  /** Processa até `limite` jobs pendentes (chamável direto em testes). */
  async processarPendentes(limite = 5): Promise<number> {
    const pendentes = await comoMaster(this.db, (tx) =>
      tx.select().from(pontoJob).where(eq(pontoJob.status, 'pendente')).limit(limite));
    for (const job of pendentes) await this.processar(job);
    return pendentes.length;
  }

  private async processar(job: Job) {
    // "claim" otimista: só processa se ainda estiver pendente
    const claim = await comoMaster(this.db, (tx) =>
      tx.update(pontoJob).set({ status: 'processando', atualizadoEm: new Date() })
        .where(and(eq(pontoJob.id, job.id), eq(pontoJob.status, 'pendente'))).returning());
    if (!claim[0]) return;

    try {
      const resultado = await this.executar(job.tenantId, job.tipo, job.params);
      await comoMaster(this.db, (tx) =>
        tx.update(pontoJob).set({ status: 'concluido', resultado, atualizadoEm: new Date() }).where(eq(pontoJob.id, job.id)));
    } catch (e) {
      await comoMaster(this.db, (tx) =>
        tx.update(pontoJob).set({ status: 'erro', erro: (e as Error).message, atualizadoEm: new Date() }).where(eq(pontoJob.id, job.id)));
    }
  }

  private executar(tenantId: string, tipo: string, params: Record<string, unknown>): Promise<unknown> {
    if (tipo === 'relatorio-competencia') {
      const p = params as { inicio: string; fim: string };
      return this.tratamento.relatorioCompetencia(tenantId, p.inicio, p.fim);
    }
    throw new Error(`Tipo de job desconhecido: ${tipo}`);
  }
}
