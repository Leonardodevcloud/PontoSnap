import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TratamentoModule } from '../tratamento/tratamento.module';
import { PessoalService } from './pessoal.service';
import { PessoalController } from './pessoal.controller';
import { CriptoService } from '../common/cripto.service';

@Module({
  imports: [AuthModule, TratamentoModule],
  controllers: [PessoalController],
  providers: [PessoalService, CriptoService],
})
export class PessoalModule {}
