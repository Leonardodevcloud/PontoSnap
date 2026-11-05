import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CobrancaModule } from '../cobranca/cobranca.module';
import { TransferenciaService } from './transferencia.service';
import { TransferenciaController } from './transferencia.controller';

@Module({
  imports: [AuthModule, CobrancaModule],
  controllers: [TransferenciaController],
  providers: [TransferenciaService],
})
export class TransferenciaModule {}
