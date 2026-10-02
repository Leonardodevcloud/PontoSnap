import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { BancoService } from './banco.service';

/**
 * Fechamento automático do banco de horas.
 *
 * A sincronização já acontece em toda consulta de saldo; este cron só garante
 * que o mês vira mesmo que ninguém abra a tela — assim o histórico do RH e
 * o saldo do funcionário já estão prontos na manhã do dia 1.
 *
 * Roda 30s depois do boot e depois a cada 6 horas. É idempotente e barato
 * quando não há nada a fechar (uma consulta por funcionário com banco).
 */
@Injectable()
export class BancoCronService implements OnModuleInit {
  private readonly log = new Logger(BancoCronService.name);
  private rodando = false;

  constructor(private readonly banco: BancoService) {}

  onModuleInit() {
    if (process.env.BANCO_CRON === 'off') return;
    setTimeout(() => void this.tick(), 30_000);
    setInterval(() => void this.tick(), 6 * 3600_000);
    this.log.log('Fechamento automático do banco de horas ativo (a cada 6h)');
  }

  private async tick() {
    if (this.rodando) return; // não sobrepõe execuções
    this.rodando = true;
    try { await this.banco.sincronizarTodos(); }
    catch (e) { this.log.error(`Fechamento automático falhou: ${(e as Error).message}`); }
    finally { this.rodando = false; }
  }
}
