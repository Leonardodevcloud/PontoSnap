import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CriptoService } from '../common/cripto.service';
import { DocumentoService } from './documento.service';
import { DocumentoController } from './documento.controller';

@Module({
  imports: [AuthModule],
  controllers: [DocumentoController],
  providers: [DocumentoService, CriptoService],
  exports: [DocumentoService],
})
export class DocumentoModule {}
