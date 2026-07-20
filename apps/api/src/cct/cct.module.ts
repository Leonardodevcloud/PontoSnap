import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CctController } from './cct.controller';
import { CctService } from './cct.service';

@Module({
  imports: [AuthModule],
  controllers: [CctController],
  providers: [CctService],
})
export class CctModule {}
