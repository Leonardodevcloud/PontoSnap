import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { AjusteController } from './ajuste.controller';
import { AjusteService } from './ajuste.service';

@Module({
  imports: [AuthModule, NotificacaoModule],
  controllers: [AjusteController],
  providers: [AjusteService],
  exports: [AjusteService],
})
export class AjusteModule {}
