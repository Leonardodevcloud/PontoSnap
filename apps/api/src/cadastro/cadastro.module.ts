import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CriptoService } from '../common/cripto.service';
import { CadastroController } from './cadastro.controller';
import { CadastroService } from './cadastro.service';

@Module({
  imports: [AuthModule],
  controllers: [CadastroController],
  providers: [CadastroService, CriptoService],
  exports: [CadastroService],
})
export class CadastroModule {}
