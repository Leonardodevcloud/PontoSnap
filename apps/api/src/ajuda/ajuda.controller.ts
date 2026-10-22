import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';
import { AjudaService } from './ajuda.service';

const t = (u: PayloadAcesso) => { if (!u.tenantId) throw new BadRequestException('Usuário sem tenant'); return u.tenantId; };

/** Central de Ajuda: raio-x da compensação de horas e checklist de implantação. */
@Controller('ajuda')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
export class AjudaController {
  constructor(private readonly svc: AjudaService) {}
  @Get('compensacao') compensacao(@UsuarioAtual() u: PayloadAcesso) { return this.svc.compensacao(t(u)); }
  @Get('compensacao/:id') compensacaoDe(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string) { return this.svc.compensacaoDe(t(u), id); }
  @Get('implantacao') implantacao(@UsuarioAtual() u: PayloadAcesso) { return this.svc.implantacao(t(u)); }
}
