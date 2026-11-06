import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { TransferenciaService } from './transferencia.service';

/**
 * Corrige, uma vez no boot, quem foi transferido entre CNPJs antes de a
 * transferência levar tudo: foto de perfil (CLT e prestador), notificações do
 * celular e os dias que já eram do destino (folgas, atestados, ajustes, avulsos
 * do banco). É idempotente e não sobrescreve nada que já exista no destino —
 * rodar de novo não faz nada. O saldo do banco de horas vem pela sincronização
 * do banco (cron de 6h ou consulta do saldo).
 */
@Injectable()
export class TransferenciaReparoService implements OnModuleInit {
  private readonly log = new Logger(TransferenciaReparoService.name);

  constructor(private readonly svc: TransferenciaService) {}

  onModuleInit() {
    if (process.env.TRANSFERENCIA_REPARO === 'off') return;
    setTimeout(() => {
      this.svc.repararTransferidos()
        .then((r) => { if (r.pessoas) this.log.log(`Transferidos conferidos: ${r.pessoas} (fotos copiadas: ${r.fotos})`); })
        .catch((e) => this.log.error(`Reparo dos transferidos falhou: ${(e as Error).message}`));
    }, 20_000);
  }
}
