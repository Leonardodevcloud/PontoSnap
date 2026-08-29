import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CobrancaService } from './cobranca.service';
import { PlanoLimiteService } from './plano-limite.service';
import { CobrancaMasterController, AssinaturaClienteController } from './cobranca.controller';

@Module({
  imports: [AuthModule],
  controllers: [CobrancaMasterController, AssinaturaClienteController],
  providers: [CobrancaService, PlanoLimiteService],
  exports: [CobrancaService, PlanoLimiteService],
})
export class CobrancaModule {}
