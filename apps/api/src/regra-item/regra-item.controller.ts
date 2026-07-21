import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import type { TipoRegraItem } from '@ponto/db';
import { RegraItemService } from './regra-item.service';
import { RegraItemDto, RegraItemEditDto } from './dto/regra-item.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';

@Controller('regra-itens')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RegraItemController {
  constructor(private readonly itens: RegraItemService) {}

  private tenant(u: PayloadAcesso): string {
    if (!u.tenantId) throw new Error('Sem tenant no token');
    return u.tenantId;
  }

  @Get()
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  listar(@UsuarioAtual() u: PayloadAcesso, @Query('tipo') tipo?: TipoRegraItem) {
    return this.itens.listar(this.tenant(u), tipo);
  }

  @Post()
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  criar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: RegraItemDto) {
    return this.itens.criar(this.tenant(u), dto.tipo, dto.nome, dto.config, dto.padrao);
  }

  @Patch(':id')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  atualizar(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string, @Body() dto: RegraItemEditDto) {
    return this.itens.atualizar(this.tenant(u), id, dto.nome, dto.config, dto.padrao);
  }

  @Delete(':id')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  remover(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string) {
    return this.itens.remover(this.tenant(u), id);
  }
}
