import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { AuditoriaService } from './auditoria.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';

/** Só o admin do cliente lê a trilha — é informação sensível de gestão. */
@Controller('auditoria')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.ADMIN_CLIENTE)
export class AuditoriaController {
  constructor(private readonly auditoria: AuditoriaService) {}

  @Get()
  listar(
    @UsuarioAtual() u: PayloadAcesso,
    @Query('usuarioId') usuarioId?: string,
    @Query('outros') outros?: string,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
    return this.auditoria.listar(u.tenantId, { usuarioId, outros: outros === '1', inicio, fim });
  }

  @Get('pessoas')
  pessoas(@UsuarioAtual() u: PayloadAcesso, @Query('inicio') inicio?: string, @Query('fim') fim?: string) {
    if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
    return this.auditoria.pessoas(u.tenantId, { inicio, fim });
  }
}
