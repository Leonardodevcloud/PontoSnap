import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PortalService } from './portal.service';

/** A cada 10 min: lembrete diário (9h, fuso da empresa) de quem ainda não mandou a nota. */
@Injectable()
export class PortalCronService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PortalCronService.name);
  private timer: NodeJS.Timeout | null = null;
  private rodando = false;
  constructor(private readonly svc: PortalService) {}

  onModuleInit() {
    if (process.env.PORTAL_CRON === 'off') return;
    this.timer = setInterval(() => void this.tick(), 10 * 60_000);
    this.log.log('Lembrete de notas dos prestadores ativo (10 min)');
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async tick() {
    if (this.rodando) return;
    this.rodando = true;
    try {
      const r = await this.svc.rotina();
      if (r.lembretes) this.log.log(`Notas: ${r.lembretes} lembretes`);
    } catch (e) { this.log.error(`Rotina do portal: ${(e as Error).message}`); }
    finally { this.rodando = false; }
  }
}
