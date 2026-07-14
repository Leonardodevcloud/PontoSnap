import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmpregadoService } from './empregado.service';
import { EmpregadoController } from './empregado.controller';

@Module({
  imports: [AuthModule],
  controllers: [EmpregadoController],
  providers: [EmpregadoService],
  exports: [EmpregadoService],
})
export class EmpregadoModule {}
