import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { ArgosService } from './argos.service';
import { ArgosPerguntaDto } from './dto/argos.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';

/** Argos — assistente que explica o ponto (apuração + regras + CLT/CCT). */
@Controller('argos')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
export class ArgosController {
  constructor(private readonly argos: ArgosService) {}

  private tenant(u: PayloadAcesso): string {
    if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
    return u.tenantId;
  }

  @Get('status')
  status() {
    return { ativo: this.argos.ativo };
  }

  @Post('perguntar')
  perguntar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: ArgosPerguntaDto) {
    return this.argos.perguntar(this.tenant(u), u.sub, dto);
  }
}
