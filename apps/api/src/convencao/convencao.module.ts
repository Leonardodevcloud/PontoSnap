import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CctModule } from '../cct/cct.module';
import { ConvencaoController } from './convencao.controller';
import { ConvencaoService } from './convencao.service';

@Module({
  imports: [AuthModule, CctModule],
  controllers: [ConvencaoController],
  providers: [ConvencaoService],
})
export class ConvencaoModule {}
