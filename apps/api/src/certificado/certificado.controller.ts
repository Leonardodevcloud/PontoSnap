import { Controller, Get, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { CertificadoService } from './certificado.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';

/**
 * Status do certificado da plataforma. É só leitura: o certificado é o e-CPF
 * do desenvolvedor, carregado de variável de ambiente (segredo de
 * infraestrutura), não enviado pela interface nem por cliente.
 */
@Controller('certificado')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.MASTER)
export class CertificadoController {
  constructor(private readonly certs: CertificadoService) {}

  /** Diz se o certificado está configurado e, se sim, o CN e a validade. */
  @Get('status')
  async status() {
    if (!(await this.certs.temCertificado())) {
      return { configurado: false };
    }
    const info = await this.certs.info();
    return { configurado: true, ...info };
  }
}
