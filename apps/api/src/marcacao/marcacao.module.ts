import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CertificadoModule } from '../certificado/certificado.module';
import { MarcacaoService } from './marcacao.service';
import { MarcacaoController } from './marcacao.controller';
import { KioskController } from './kiosk.controller';

@Module({
  imports: [AuthModule, CertificadoModule],
  controllers: [MarcacaoController, KioskController],
  providers: [MarcacaoService],
  exports: [MarcacaoService],
})
export class MarcacaoModule {}
