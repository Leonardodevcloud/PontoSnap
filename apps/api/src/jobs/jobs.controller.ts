import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { JobsService } from './jobs.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';

@Controller('jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  private tenant(u: PayloadAcesso): string {
    if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
    return u.tenantId;
  }

  @Post('relatorio-competencia')
  criarRelatorio(@UsuarioAtual() u: PayloadAcesso, @Body() dto: { inicio?: string; fim?: string }) {
    if (!dto?.inicio || !dto?.fim) throw new BadRequestException('Informe inicio e fim (YYYY-MM-DD)');
    return this.jobs.enfileirar(this.tenant(u), 'relatorio-competencia', { inicio: dto.inicio, fim: dto.fim });
  }

  @Get(':id')
  obter(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string) {
    return this.jobs.obter(this.tenant(u), id);
  }
}
