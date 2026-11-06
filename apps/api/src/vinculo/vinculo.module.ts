import { Global, Module } from '@nestjs/common';
import { VinculoController } from './vinculo.controller';
import { VinculoService } from './vinculo.service';
import { AuthModule } from '../auth/auth.module';

/** Global: contracheques, documentos, espelho e assinatura usam o mesmo resolvedor de vínculo. */
@Global()
@Module({ imports: [AuthModule], controllers: [VinculoController], providers: [VinculoService], exports: [VinculoService] })
export class VinculoModule {}
