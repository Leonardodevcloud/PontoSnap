import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { CertificadoService } from './certificado.service';
import { SalvarCertificadoDto } from './dto/certificado.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';

@Controller('certificado')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.ADMIN_CLIENTE)
export class CertificadoController {
  constructor(private readonly certs: CertificadoService) {}
  private tenant(u: PayloadAcesso): string {
    if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
    return u.tenantId;
  }

  @Post() salvar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: SalvarCertificadoDto) {
    return this.certs.salvar(this.tenant(u), Buffer.from(dto.pfxBase64, 'base64'), dto.senha);
  }
  @Get() info(@UsuarioAtual() u: PayloadAcesso) {
    return this.certs.info(this.tenant(u));
  }
}
