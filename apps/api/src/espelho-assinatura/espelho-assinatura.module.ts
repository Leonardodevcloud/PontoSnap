import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TratamentoModule } from '../tratamento/tratamento.module';
import { EspelhoAssinaturaController } from './espelho-assinatura.controller';
import { EspelhoAssinaturaService } from './espelho-assinatura.service';

@Module({
  imports: [AuthModule, TratamentoModule],
  controllers: [EspelhoAssinaturaController],
  providers: [EspelhoAssinaturaService],
  exports: [EspelhoAssinaturaService],
})
export class EspelhoAssinaturaModule {}
