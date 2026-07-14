import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CertificadoModule } from '../certificado/certificado.module';
import { FiscalService } from './fiscal.service';
import { FiscalController } from './fiscal.controller';

@Module({
  imports: [AuthModule, CertificadoModule],
  controllers: [FiscalController],
  providers: [FiscalService],
  exports: [FiscalService],
})
export class FiscalModule {}
