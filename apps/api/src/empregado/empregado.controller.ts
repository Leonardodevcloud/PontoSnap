import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { EmpregadoService } from './empregado.service';
import { CriarEmpregadoDto, DefinirPinDto, AtivoDto, DefinirHorarioDto, DefinirSalarioDto, AcessoDto } from './dto/empregado.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';

/** O cliente (ADMIN_CLIENTE/RH) gerencia os próprios funcionários. */
@Controller('empregados')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
export class EmpregadoController {
  constructor(private readonly empregados: EmpregadoService) {}

  private tenant(u: PayloadAcesso): string {
    if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
    return u.tenantId;
  }

  @Post() criar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: CriarEmpregadoDto) {
    return this.empregados.criar(this.tenant(u), dto);
  }
  @Get() listar(@UsuarioAtual() u: PayloadAcesso) {
    return this.empregados.listarComAcesso(this.tenant(u));
  }
  @Get(':id') obter(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string) {
    return this.empregados.obter(this.tenant(u), id);
  }
  @Patch(':id/pin') definirPin(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string, @Body() dto: DefinirPinDto) {
    return this.empregados.definirPin(this.tenant(u), id, dto.pin);
  }
  @Patch(':id/ativo') ativo(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string, @Body() dto: AtivoDto) {
    return this.empregados.definirAtivo(this.tenant(u), id, dto.ativo);
  }
  @Patch(':id/horario') horario(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string, @Body() dto: DefinirHorarioDto) {
    return this.empregados.definirHorario(this.tenant(u), id, dto.horarioContratualId);
  }
  /** Cria ou reseta o login do colaborador. A senha provisória aparece uma vez só. */
  @Post(':id/acesso') acesso(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string, @Body() dto: AcessoDto) {
    return this.empregados.criarOuResetarAcesso(this.tenant(u), id, dto.email);
  }
  @Patch(':id/salario') salario(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string, @Body() dto: DefinirSalarioDto) {
    return this.empregados.definirSalario(this.tenant(u), id, dto.salarioMensal);
  }
}
