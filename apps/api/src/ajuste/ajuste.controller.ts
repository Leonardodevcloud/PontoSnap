import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { AjusteService } from './ajuste.service';
import { SolicitarAjusteDto, DecidirAjusteDto } from './dto/ajuste.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';

@Controller('ajustes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AjusteController {
  constructor(private readonly ajustes: AjusteService) {}

  private tenant(u: PayloadAcesso): string {
    if (!u.tenantId) throw new Error('Sem tenant no token');
    return u.tenantId;
  }

  /** Funcionário pede o ajuste do próprio ponto. */
  @Post('meus')
  @Perfis(Perfil.COLABORADOR)
  async pedir(@UsuarioAtual() u: PayloadAcesso, @Body() dto: SolicitarAjusteDto) {
    const t = this.tenant(u);
    const empregadoId = await this.ajustes.empregadoDoUsuario(u.sub, t);
    return this.ajustes.solicitar(t, { ...dto, empregadoId }, 'FUNCIONARIO');
  }

  @Get('meus')
  @Perfis(Perfil.COLABORADOR)
  async meus(@UsuarioAtual() u: PayloadAcesso) {
    const t = this.tenant(u);
    return this.ajustes.meus(t, await this.ajustes.empregadoDoUsuario(u.sub, t));
  }

  /** RH: fila de pedidos aguardando decisão. */
  @Get('pendentes')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  pendentes(@UsuarioAtual() u: PayloadAcesso) {
    return this.ajustes.pendentes(this.tenant(u));
  }

  /** RH: histórico de um funcionário. */
  @Get('empregado/:id')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  doEmpregado(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string) {
    return this.ajustes.meus(this.tenant(u), id);
  }

  @Patch(':id/decidir')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  decidir(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string, @Body() dto: DecidirAjusteDto) {
    return this.ajustes.decidir(this.tenant(u), id, dto.aprovar, dto.motivo ?? null, u.email ?? 'RH');
  }

  /** RH lança o ajuste direto (já aprovado) — ex.: tirar batida a mais. */
  @Post('lancar')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  lancar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: SolicitarAjusteDto) {
    return this.ajustes.solicitar(this.tenant(u), dto as never, 'RH');
  }

  /** Batidas de um dia (pra escolher qual desconsiderar). */
  @Get('batidas')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH, Perfil.COLABORADOR)
  async batidas(@UsuarioAtual() u: PayloadAcesso, @Query('empregadoId') empregadoId: string, @Query('data') data: string) {
    const t = this.tenant(u);
    const id = u.perfil === Perfil.COLABORADOR ? await this.ajustes.empregadoDoUsuario(u.sub, t) : empregadoId;
    return this.ajustes.batidasDoDia(t, id, data);
  }
}
