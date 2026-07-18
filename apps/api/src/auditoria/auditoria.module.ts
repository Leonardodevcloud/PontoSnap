import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Inject } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DB } from '../database/database.module';
import type { Db } from '@ponto/db';
import { AuditoriaService } from './auditoria.service';
import { AuditoriaController } from './auditoria.controller';
import { AuditoriaInterceptor } from './auditoria.interceptor';

@Module({
  imports: [AuthModule],
  controllers: [AuditoriaController],
  providers: [
    AuditoriaService,
    {
      // Interceptor global: captura toda escrita de qualquer módulo.
      provide: APP_INTERCEPTOR,
      useFactory: (db: Db) => new AuditoriaInterceptor(db),
      inject: [DB],
    },
  ],
  exports: [AuditoriaService],
})
export class AuditoriaModule {}
