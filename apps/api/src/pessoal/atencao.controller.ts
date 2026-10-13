import { BadRequestException, Controller, Get, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';
import { AtencaoService } from './atencao.service';

/** Central "Precisa de atenção" do RH. */
@Controller('atencao')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
export class AtencaoController {
  constructor(private readonly atencao: AtencaoService) {}

  @Get() listar(@UsuarioAtual() u: PayloadAcesso) {
    if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
    return this.atencao.listar(u.tenantId);
  }
}
