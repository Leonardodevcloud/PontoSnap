import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ComunicacaoService } from './comunicacao.service';

/** A cada minuto: publica os agendados, manda o lembrete de 24h e limpa mídias órfãs. */
@Injectable()
export class ComunicacaoCronService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ComunicacaoCronService.name);
  private timer: NodeJS.Timeout | null = null;
  private rodando = false;
  constructor(private readonly svc: ComunicacaoService) {}

  onModuleInit() {
    if (process.env.COMUNICADO_CRON === 'off') return;
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.log.log('Rotina de comunicados ativa (1 min)');
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async tick() {
    if (this.rodando) return;
    this.rodando = true;
    try {
      const r = await this.svc.rotina();
      if (r.publicados || r.lembretes) this.log.log(`Comunicados: ${r.publicados} publicados, ${r.lembretes} lembretes`);
    } catch (e) { this.log.error(`Rotina de comunicados: ${(e as Error).message}`); }
    finally { this.rodando = false; }
  }
}
