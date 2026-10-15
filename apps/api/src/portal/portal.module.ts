import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { PessoalModule } from '../pessoal/pessoal.module';
import { PortalConviteController, PortalPrestadorController, PortalRhController } from './portal.controller';
import { PortalService } from './portal.service';
import { PortalCronService } from './portal-cron.service';

/** Portal do prestador (MEI/motorista): acesso restrito, valor do mês e envio da nota. */
@Module({
  imports: [AuthModule, NotificacaoModule, PessoalModule],
  controllers: [PortalConviteController, PortalPrestadorController, PortalRhController],
  providers: [PortalService, PortalCronService],
})
export class PortalModule {}
