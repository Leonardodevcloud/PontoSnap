import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AfastamentoService } from './afastamento.service';
import { AfastamentoController } from './afastamento.controller';

@Module({
  imports: [AuthModule],
  controllers: [AfastamentoController],
  providers: [AfastamentoService],
  exports: [AfastamentoService],
})
export class AfastamentoModule {}
