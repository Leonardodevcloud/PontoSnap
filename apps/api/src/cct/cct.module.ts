import { Module } from '@nestjs/common';
import { CctController } from './cct.controller';
import { CctService } from './cct.service';

@Module({
  controllers: [CctController],
  providers: [CctService],
})
export class CctModule {}
