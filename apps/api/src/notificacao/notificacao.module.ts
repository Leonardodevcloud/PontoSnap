import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificacaoController } from './notificacao.controller';
import { PushService } from './push.service';
import { NotificacaoCronService } from './notificacao-cron.service';

@Module({
  imports: [AuthModule],
  controllers: [NotificacaoController],
  providers: [PushService, NotificacaoCronService],
  exports: [PushService],
})
export class NotificacaoModule {}
