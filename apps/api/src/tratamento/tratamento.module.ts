import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { TratamentoService } from './tratamento.service';
import { TratamentoController } from './tratamento.controller';

@Module({
  imports: [AuthModule, NotificacaoModule],
  controllers: [TratamentoController],
  providers: [TratamentoService],
  exports: [TratamentoService],
})
export class TratamentoModule {}
