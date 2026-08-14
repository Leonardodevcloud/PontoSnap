import { Body, Controller, Delete, Get, Param, Patch, Post, StreamableFile, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { PerfilRegraService } from './perfil-regra.service';
import { SalvarPerfilDto } from './dto/perfil-regra.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';

@Controller('perfis-regra')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
export class PerfilRegraController {
  constructor(private readonly perfis: PerfilRegraService) {}
  private tenant(u: PayloadAcesso): string {
    if (!u.tenantId) throw new Error('Sem tenant no token');
    return u.tenantId;
  }

  @Get() listar(@UsuarioAtual() u: PayloadAcesso) {
    return this.perfis.listar(this.tenant(u));
  }
  @Post() criar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: SalvarPerfilDto) {
    return this.perfis.criar(this.tenant(u), dto);
  }
  @Patch(':id') atualizar(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string, @Body() dto: SalvarPerfilDto) {
    return this.perfis.atualizar(this.tenant(u), id, dto);
  }
  @Delete(':id') remover(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string) {
    return this.perfis.remover(this.tenant(u), id);
  }
  @Get(':id/pdf') async pdf(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string) {
    const { nome, buffer } = await this.perfis.pdf(this.tenant(u), id);
    return new StreamableFile(buffer, { type: 'application/pdf', disposition: `inline; filename="${nome}"` });
  }
}
