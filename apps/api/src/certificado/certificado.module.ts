import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CriptoService } from '../common/cripto.service';
import { CertificadoService } from './certificado.service';
import { CertificadoController } from './certificado.controller';

@Module({
  imports: [AuthModule],
  controllers: [CertificadoController],
  providers: [CriptoService, CertificadoService],
  exports: [CertificadoService],
})
export class CertificadoModule {}
