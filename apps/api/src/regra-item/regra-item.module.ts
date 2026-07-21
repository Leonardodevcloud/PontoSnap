import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RegraItemController } from './regra-item.controller';
import { RegraItemService } from './regra-item.service';

@Module({
  imports: [AuthModule],
  controllers: [RegraItemController],
  providers: [RegraItemService],
  exports: [RegraItemService],
})
export class RegraItemModule {}
