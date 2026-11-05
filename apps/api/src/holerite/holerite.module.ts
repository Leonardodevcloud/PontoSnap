import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CriptoService } from '../common/cripto.service';
import { PushService } from '../notificacao/push.service';
import { HoleriteService } from './holerite.service';
import { HoleriteController } from './holerite.controller';

@Module({
  imports: [AuthModule],
  controllers: [HoleriteController],
  providers: [HoleriteService, CriptoService, PushService],
  exports: [HoleriteService],
})
export class HoleriteModule {}
