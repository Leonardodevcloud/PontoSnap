import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AssinaturaService } from './assinatura.service';

/** A cada 30 min: confere na Autentique os documentos pendentes (caso algum webhook se perca). */
@Injectable()
export class AssinaturaCronService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AssinaturaCronService.name);
  private timer: NodeJS.Timeout | null = null;
  private rodando = false;
  constructor(private readonly svc: AssinaturaService) {}
  onModuleInit() {
    if (process.env.ASSINATURA_CRON === 'off') return;
    this.timer = setInterval(() => void this.tick(), 30 * 60_000);
    this.log.log('Conferência de assinaturas (Autentique) ativa (30 min)');
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async tick() {
    if (this.rodando) return;
    this.rodando = true;
    try { await this.svc.rotina(); } catch (e) { this.log.warn(`Rotina falhou: ${(e as Error).message}`); }
    finally { this.rodando = false; }
  }
}
