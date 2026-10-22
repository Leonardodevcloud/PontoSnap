import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AjudaController } from './ajuda.controller';
import { AjudaService } from './ajuda.service';

/** Central de Ajuda (raio-x de compensação de horas e implantação). */
@Module({ imports: [AuthModule], controllers: [AjudaController], providers: [AjudaService], exports: [AjudaService] })
export class AjudaModule {}
