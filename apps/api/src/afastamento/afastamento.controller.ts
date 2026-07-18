import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { AfastamentoService } from './afastamento.service';
import { CriarAfastamentoDto } from './dto/afastamento.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';

/** Férias, INSS e licenças. Quem declara é o RH. */
@Controller('afastamentos')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
export class AfastamentoController {
  constructor(private readonly afast: AfastamentoService) {}
  private tenant(u: PayloadAcesso): string {
    if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
    return u.tenantId;
  }

  @Post()
  criar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: CriarAfastamentoDto) {
    return this.afast.criar(this.tenant(u), u.sub, dto);
  }

  @Get()
  listar(@UsuarioAtual() u: PayloadAcesso, @Query('empregadoId') empregadoId?: string) {
    return this.afast.listar(this.tenant(u), empregadoId);
  }

  @Delete(':id')
  remover(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string) {
    return this.afast.remover(this.tenant(u), id);
  }
}
