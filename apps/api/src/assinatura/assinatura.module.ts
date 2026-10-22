import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TratamentoModule } from '../tratamento/tratamento.module';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { CriptoService } from '../common/cripto.service';
import { AssinaturaService } from './assinatura.service';
import { AssinaturaCronService } from './assinatura-cron.service';
import { AssinaturaMeusController, AssinaturaRhController, AutentiqueWebhookController } from './assinatura.controller';

/** Espelho de ponto e contracheque para assinatura eletrônica (Autentique). */
@Module({
  imports: [AuthModule, TratamentoModule, NotificacaoModule],
  controllers: [AssinaturaMeusController, AssinaturaRhController, AutentiqueWebhookController],
  providers: [AssinaturaService, AssinaturaCronService, CriptoService],
})
export class AssinaturaModule {}
