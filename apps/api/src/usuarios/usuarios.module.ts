import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsuariosService } from './usuarios.service';
import { UsuariosAdminController, UsuariosMasterController } from './usuarios.controller';

@Module({
  imports: [AuthModule],
  controllers: [UsuariosMasterController, UsuariosAdminController],
  providers: [UsuariosService],
  exports: [UsuariosService],
})
export class UsuariosModule {}
