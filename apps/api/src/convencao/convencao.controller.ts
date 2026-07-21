import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { ConvencaoService } from './convencao.service';
import { ConvencaoDto } from './dto/convencao.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';

@Controller('convencoes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConvencaoController {
  constructor(private readonly conv: ConvencaoService) {}

  private tenant(u: PayloadAcesso): string {
    if (!u.tenantId) throw new Error('Sem tenant no token');
    return u.tenantId;
  }

  @Get()
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  listar(@UsuarioAtual() u: PayloadAcesso) {
    return this.conv.listar(this.tenant(u));
  }

  @Post()
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  criar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: ConvencaoDto) {
    return this.conv.criar(this.tenant(u), dto);
  }

  @Patch(':id')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  atualizar(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string, @Body() dto: ConvencaoDto) {
    return this.conv.atualizar(this.tenant(u), id, dto);
  }

  @Delete(':id')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  remover(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string) {
    return this.conv.remover(this.tenant(u), id);
  }

  /** Lê o PDF anexado e devolve um rascunho de Regra pra o RH conferir. */
  @Post(':id/gerar-regra')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  gerarRegra(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string) {
    return this.conv.gerarRegra(this.tenant(u), id);
  }
}
