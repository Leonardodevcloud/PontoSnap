import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TratamentoModule } from '../tratamento/tratamento.module';
import { BancoService } from './banco.service';
import { BancoController } from './banco.controller';

@Module({
  imports: [AuthModule, TratamentoModule],
  controllers: [BancoController],
  providers: [BancoService],
  exports: [BancoService],
})
export class BancoModule {}
