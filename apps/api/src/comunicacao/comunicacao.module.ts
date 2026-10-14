import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { ComunicacaoController } from './comunicacao.controller';
import { ComunicacaoService } from './comunicacao.service';
import { ComunicacaoCronService } from './comunicacao-cron.service';

@Module({
  imports: [AuthModule, NotificacaoModule],
  controllers: [ComunicacaoController],
  providers: [ComunicacaoService, ComunicacaoCronService],
})
export class ComunicacaoModule {}
