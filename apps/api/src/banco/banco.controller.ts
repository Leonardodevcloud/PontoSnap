import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { BancoService } from './banco.service';
import { ConfigBancoDto, MovimentoDto, LancarCompetenciaDto, LancarLoteDto, FolgaDto } from './dto/banco.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';

/** Banco de horas: configuração e lançamentos ficam com o RH. */
@Controller('banco')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BancoController {
  constructor(private readonly banco: BancoService) {}
  private tenant(u: PayloadAcesso): string {
    if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
    return u.tenantId;
  }

  @Get('config')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  config(@UsuarioAtual() u: PayloadAcesso) {
    return this.banco.obterConfig(this.tenant(u));
  }

  /** Quem segue o padrão da empresa e quem tem regra própria de banco. */
  @Get('cobertura')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  cobertura(@UsuarioAtual() u: PayloadAcesso) {
    return this.banco.cobertura(this.tenant(u));
  }

  /** Só o admin do cliente define o acordo — é decisão contratual, não operacional. */
  @Post('config')
  @Perfis(Perfil.ADMIN_CLIENTE)
  definirConfig(@UsuarioAtual() u: PayloadAcesso, @Body() dto: ConfigBancoDto) {
    return this.banco.definirConfig(this.tenant(u), dto);
  }

  @Get('extrato')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  extrato(
    @UsuarioAtual() u: PayloadAcesso,
    @Query('empregadoId') empregadoId?: string,
    @Query('hoje') hoje?: string,
  ) {
    if (!empregadoId) throw new BadRequestException('Informe empregadoId');
    return this.banco.saldo(this.tenant(u), empregadoId, hoje ?? new Date().toISOString().slice(0, 10));
  }

  @Post('movimento')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  movimento(@UsuarioAtual() u: PayloadAcesso, @Body() dto: MovimentoDto) {
    return this.banco.lancarMovimento(this.tenant(u), dto);
  }

  @Post('lancar-competencia')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  lancar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: LancarCompetenciaDto) {
    return this.banco.lancarCompetencia(this.tenant(u), dto.empregadoId, dto.competencia);
  }

  /** Lança a competência para todos os funcionários ativos de uma vez. */
  @Post('lancar-lote')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  lancarLote(@UsuarioAtual() u: PayloadAcesso, @Body() dto: LancarLoteDto) {
    return this.banco.lancarCompetenciaLote(this.tenant(u), dto.competencia);
  }

  /** Histórico de competências já lançadas (agrupado, com detalhe por funcionário). */
  @Get('competencias')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  competencias(@UsuarioAtual() u: PayloadAcesso) {
    return this.banco.historicoCompetencias(this.tenant(u));
  }

  /** Registra uma folga compensatória: debita o banco e não conta como falta. */
  @Post('folga')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  folga(@UsuarioAtual() u: PayloadAcesso, @Body() dto: FolgaDto) {
    return this.banco.registrarFolga(this.tenant(u), dto.empregadoId, dto.data, dto.minutos ?? null);
  }
}
