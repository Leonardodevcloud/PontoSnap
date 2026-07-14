import { Global, Module } from '@nestjs/common';
import { criarDb, type Db } from '@ponto/db';

export const DB = Symbol('DB');

@Global()
@Module({
  providers: [{
    provide: DB,
    useFactory: (): Db => criarDb(process.env.DATABASE_URL ?? ''),
  }],
  exports: [DB],
})
export class DatabaseModule {}
