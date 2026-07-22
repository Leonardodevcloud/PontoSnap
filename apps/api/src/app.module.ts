import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { EmailModule } from './email/email.module';
import { AuthModule } from './auth/auth.module';
import { TenantModule } from './tenant/tenant.module';
import { EmpregadoModule } from './empregado/empregado.module';
import { CertificadoModule } from './certificado/certificado.module';
import { MarcacaoModule } from './marcacao/marcacao.module';
import { TratamentoModule } from './tratamento/tratamento.module';
import { BancoModule } from './banco/banco.module';
import { CctModule } from './cct/cct.module';
import { ConvencaoModule } from './convencao/convencao.module';
import { RegraItemModule } from './regra-item/regra-item.module';
import { AjusteModule } from './ajuste/ajuste.module';
import { DocumentoModule } from './documento/documento.module';
import { AfastamentoModule } from './afastamento/afastamento.module';
import { AuditoriaModule } from './auditoria/auditoria.module';
import { CobrancaModule } from './cobranca/cobranca.module';
import { FiscalModule } from './fiscal/fiscal.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';

@Module({
  imports: [
    DatabaseModule, EmailModule, AuthModule, TenantModule, EmpregadoModule, CertificadoModule,
    MarcacaoModule, TratamentoModule,
    BancoModule, CctModule, ConvencaoModule, RegraItemModule, AjusteModule, DocumentoModule, AfastamentoModule, AuditoriaModule, CobrancaModule, FiscalModule, HealthModule, JobsModule,
  ],
})
export class AppModule {}
