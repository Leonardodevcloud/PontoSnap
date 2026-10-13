import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TratamentoModule } from '../tratamento/tratamento.module';
import { PessoalService } from './pessoal.service';
import { PessoalController } from './pessoal.controller';
import { CriptoService } from '../common/cripto.service';
import { AtencaoService } from './atencao.service';
import { AtencaoController } from './atencao.controller';

@Module({
  imports: [AuthModule, TratamentoModule],
  controllers: [PessoalController, AtencaoController],
  providers: [PessoalService, CriptoService, AtencaoService],
})
export class PessoalModule {}
