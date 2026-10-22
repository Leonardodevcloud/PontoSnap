import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';
import { UsuariosService, type Escopo } from './usuarios.service';
import { AtivoUsuarioDto, CriarUsuarioDto, EditarUsuarioDto, EmailUsuarioDto } from './usuarios.dto';

const MASTER: Escopo = { tipo: 'MASTER' };

/** Master: usuários de qualquer empresa (Clientes › empresa › Usuários). */
@Controller('tenants/:tenantId/usuarios')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.MASTER)
export class UsuariosMasterController {
  constructor(private readonly svc: UsuariosService) {}
  @Get() listar(@Param('tenantId', ParseUUIDPipe) t: string) { return this.svc.listar(t, MASTER); }
  @Post() criar(@Param('tenantId', ParseUUIDPipe) t: string, @Body() dto: CriarUsuarioDto) { return this.svc.criar(t, MASTER, dto); }
  @Patch(':id') editar(@Param('tenantId', ParseUUIDPipe) t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EditarUsuarioDto) { return this.svc.editar(t, MASTER, id, dto); }
  @Post(':id/senha') senha(@Param('tenantId', ParseUUIDPipe) t: string, @Param('id', ParseUUIDPipe) id: string) { return this.svc.senhaNova(t, MASTER, id); }
  @Patch(':id/email') email(@Param('tenantId', ParseUUIDPipe) t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EmailUsuarioDto) { return this.svc.trocarEmail(t, MASTER, id, dto.email, !!dto.reenviar); }
  @Patch(':id/ativo') ativo(@Param('tenantId', ParseUUIDPipe) t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtivoUsuarioDto) { return this.svc.ativo(t, MASTER, id, dto.ativo); }
}

/** Admin do cliente: usuários da própria empresa (Configurações › Usuários). */
@Controller('usuarios')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.ADMIN_CLIENTE)
export class UsuariosAdminController {
  constructor(private readonly svc: UsuariosService) {}
  private async esc(u: PayloadAcesso) {
    if (!u.tenantId) throw new BadRequestException('Usuário sem empresa');
    return { t: u.tenantId, e: await this.svc.escopoAdmin(u.sub, u.tenantId) };
  }
  @Get() async listar(@UsuarioAtual() u: PayloadAcesso) { const { t, e } = await this.esc(u); return this.svc.listar(t, e); }
  @Post() async criar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: CriarUsuarioDto) { const { t, e } = await this.esc(u); return this.svc.criar(t, e, dto); }
  @Patch(':id') async editar(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EditarUsuarioDto) { const { t, e } = await this.esc(u); return this.svc.editar(t, e, id, dto); }
  @Post(':id/senha') async senha(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string) { const { t, e } = await this.esc(u); return this.svc.senhaNova(t, e, id); }
  @Patch(':id/email') async email(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EmailUsuarioDto) { const { t, e } = await this.esc(u); return this.svc.trocarEmail(t, e, id, dto.email, !!dto.reenviar); }
  @Patch(':id/ativo') async ativo(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtivoUsuarioDto) { const { t, e } = await this.esc(u); return this.svc.ativo(t, e, id, dto.ativo); }
}
