import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CobrancaModule } from '../cobranca/cobranca.module';
import { BancoModule } from '../banco/banco.module';
import { TransferenciaService } from './transferencia.service';
import { TransferenciaController } from './transferencia.controller';
import { TransferenciaReparoService } from './transferencia-reparo.service';

@Module({
  imports: [AuthModule, CobrancaModule, BancoModule],
  controllers: [TransferenciaController],
  providers: [TransferenciaService, TransferenciaReparoService],
})
export class TransferenciaModule {}
