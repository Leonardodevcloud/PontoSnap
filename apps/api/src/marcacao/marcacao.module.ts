import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CertificadoModule } from '../certificado/certificado.module';
import { TratamentoModule } from '../tratamento/tratamento.module';
import { BancoModule } from '../banco/banco.module';
import { MarcacaoService } from './marcacao.service';
import { MarcacaoController } from './marcacao.controller';
import { KioskController } from './kiosk.controller';

@Module({
  imports: [AuthModule, CertificadoModule, TratamentoModule, BancoModule],
  controllers: [MarcacaoController, KioskController],
  providers: [MarcacaoService],
  exports: [MarcacaoService],
})
export class MarcacaoModule {}
