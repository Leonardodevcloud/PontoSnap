import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TratamentoModule } from '../tratamento/tratamento.module';
import { ArgosService } from './argos.service';
import { ArgosController } from './argos.controller';
import { DeepSeekService } from './deepseek.service';
import { VozArgosService } from './voz.service';

@Module({
  imports: [AuthModule, TratamentoModule],
  controllers: [ArgosController],
  providers: [ArgosService, DeepSeekService, VozArgosService],
})
export class ArgosModule {}
