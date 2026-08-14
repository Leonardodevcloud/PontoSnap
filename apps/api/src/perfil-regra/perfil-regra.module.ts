import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PerfilRegraController } from './perfil-regra.controller';
import { PerfilRegraService } from './perfil-regra.service';

@Module({
  imports: [AuthModule],
  controllers: [PerfilRegraController],
  providers: [PerfilRegraService],
  exports: [PerfilRegraService],
})
export class PerfilRegraModule {}
