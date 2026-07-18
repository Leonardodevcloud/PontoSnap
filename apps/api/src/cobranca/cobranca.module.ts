import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CobrancaService } from './cobranca.service';
import { CobrancaMasterController, AssinaturaClienteController } from './cobranca.controller';

@Module({
  imports: [AuthModule],
  controllers: [CobrancaMasterController, AssinaturaClienteController],
  providers: [CobrancaService],
  exports: [CobrancaService],
})
export class CobrancaModule {}
