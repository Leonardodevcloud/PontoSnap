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
import { PerfilRegraModule } from './perfil-regra/perfil-regra.module';
import { EspelhoAssinaturaModule } from './espelho-assinatura/espelho-assinatura.module';
import { AjusteModule } from './ajuste/ajuste.module';
import { DocumentoModule } from './documento/documento.module';
import { AfastamentoModule } from './afastamento/afastamento.module';
import { AuditoriaModule } from './auditoria/auditoria.module';
import { CobrancaModule } from './cobranca/cobranca.module';
import { FiscalModule } from './fiscal/fiscal.module';
import { HealthModule } from './health/health.module';
import { NotificacaoModule } from './notificacao/notificacao.module';
import { JobsModule } from './jobs/jobs.module';
import { PessoalModule } from './pessoal/pessoal.module';
import { CadastroModule } from './cadastro/cadastro.module';
import { ComunicacaoModule } from './comunicacao/comunicacao.module';
import { PortalModule } from './portal/portal.module';
import { AssinaturaModule } from './assinatura/assinatura.module';
import { AjudaModule } from './ajuda/ajuda.module';

@Module({
  imports: [
    DatabaseModule, EmailModule, AuthModule, TenantModule, EmpregadoModule, CertificadoModule,
    MarcacaoModule, TratamentoModule,
    BancoModule, CctModule, PerfilRegraModule, EspelhoAssinaturaModule, AjusteModule, DocumentoModule, AfastamentoModule, AuditoriaModule, CobrancaModule, FiscalModule, HealthModule, JobsModule, NotificacaoModule, PessoalModule, CadastroModule, ComunicacaoModule, PortalModule, AssinaturaModule, AjudaModule,
  ],
})
export class AppModule {}
