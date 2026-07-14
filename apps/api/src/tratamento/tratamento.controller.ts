import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { TratamentoService } from './tratamento.service';
import { CriarHorarioDto, CriarAusenciaDto, CriarTratamentoDto, ApurarDto } from './dto/tratamento.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';

@Controller('tratamento')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
export class TratamentoController {
  constructor(private readonly tratamento: TratamentoService) {}
  private tenant(u: PayloadAcesso): string {
    if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
    return u.tenantId;
  }

  @Post('horarios') criarHorario(@UsuarioAtual() u: PayloadAcesso, @Body() dto: CriarHorarioDto) {
    return this.tratamento.criarHorario(this.tenant(u), dto);
  }
  @Get('horarios') listarHorarios(@UsuarioAtual() u: PayloadAcesso) {
    return this.tratamento.listarHorarios(this.tenant(u));
  }
  @Post('ausencias') criarAusencia(@UsuarioAtual() u: PayloadAcesso, @Body() dto: CriarAusenciaDto) {
    return this.tratamento.criarAusencia(this.tenant(u), dto);
  }
  @Post('marcacoes') criarTratamento(@UsuarioAtual() u: PayloadAcesso, @Body() dto: CriarTratamentoDto) {
    return this.tratamento.criarTratamento(this.tenant(u), dto);
  }
  @Get('marcacoes') listar(@UsuarioAtual() u: PayloadAcesso, @Query('empregadoId') empregadoId?: string) {
    return this.tratamento.listarTratamentos(this.tenant(u), empregadoId);
  }
  @Post('apurar') apurar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: ApurarDto) {
    return this.tratamento.apurarDia(this.tenant(u), dto.empregadoId, dto.data);
  }

  @Get('espelho') espelho(
    @UsuarioAtual() u: PayloadAcesso,
    @Query('empregadoId') empregadoId?: string,
    @Query('data') data?: string,
  ) {
    if (!empregadoId || !data) throw new BadRequestException('Informe empregadoId e data (YYYY-MM-DD)');
    return this.tratamento.espelhoDia(this.tenant(u), empregadoId, data);
  }

  @Get('painel') painel(@UsuarioAtual() u: PayloadAcesso) {
    return this.tratamento.painel(this.tenant(u));
  }
  @Get('relatorio-competencia/pdf') async relatorioPdf(
    @UsuarioAtual() u: PayloadAcesso, @Query('inicio') inicio?: string, @Query('fim') fim?: string,
  ) {
    if (!inicio || !fim) throw new BadRequestException('Informe inicio e fim');
    const r = await this.tratamento.gerarRelatorioCompetenciaPdf(this.tenant(u), inicio, fim);
    return new StreamableFile(r.buffer, { type: 'application/pdf', disposition: `attachment; filename="${r.nomeArquivo}"` });
  }
  @Get('relatorio-competencia/xlsx') async relatorioXlsx(
    @UsuarioAtual() u: PayloadAcesso, @Query('inicio') inicio?: string, @Query('fim') fim?: string,
  ) {
    if (!inicio || !fim) throw new BadRequestException('Informe inicio e fim');
    const r = await this.tratamento.gerarRelatorioCompetenciaXlsx(this.tenant(u), inicio, fim);
    return new StreamableFile(r.buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${r.nomeArquivo}"`,
    });
  }

  @Get('relatorio-competencia') relatorio(
    @UsuarioAtual() u: PayloadAcesso,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    if (!inicio || !fim) throw new BadRequestException('Informe inicio e fim (YYYY-MM-DD)');
    return this.tratamento.relatorioCompetencia(this.tenant(u), inicio, fim);
  }

  @Post('feriados') criarFeriado(@UsuarioAtual() u: PayloadAcesso, @Body() dto: { data: string; nome: string; tipo?: string }) {
    if (!dto?.data || !dto?.nome) throw new BadRequestException('Informe data (YYYY-MM-DD) e nome');
    return this.tratamento.criarFeriado(this.tenant(u), dto);
  }
  @Get('feriados') listarFeriados(
    @UsuarioAtual() u: PayloadAcesso,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    return this.tratamento.listarFeriados(this.tenant(u), inicio, fim);
  }
  @Delete('feriados/:id') removerFeriado(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string) {
    return this.tratamento.removerFeriado(this.tenant(u), id);
  }

  @Get('apuracao') apuracao(
    @UsuarioAtual() u: PayloadAcesso,
    @Query('empregadoId') empregadoId?: string,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
    @Query('feriados') feriados?: string,
  ) {
    if (!empregadoId || !inicio || !fim) throw new BadRequestException('Informe empregadoId, inicio e fim (YYYY-MM-DD)');
    const fer = feriados ? feriados.split(',').map((f) => f.trim()).filter(Boolean) : [];
    return this.tratamento.apurarPeriodoCLT(this.tenant(u), empregadoId, inicio, fim, fer);
  }

  @Post('escala/gerar-12x36') gerarEscala(
    @UsuarioAtual() u: PayloadAcesso,
    @Body() dto: { empregadoId?: string; inicio?: string; fim?: string; dataInicio?: string },
  ) {
    if (!dto?.empregadoId || !dto?.inicio || !dto?.fim || !dto?.dataInicio) {
      throw new BadRequestException('Informe empregadoId, inicio, fim e dataInicio (YYYY-MM-DD)');
    }
    return this.tratamento.gerarEscala12x36(this.tenant(u), dto.empregadoId, dto.inicio, dto.fim, dto.dataInicio);
  }
  @Get('escala') listarEscala(
    @UsuarioAtual() u: PayloadAcesso,
    @Query('empregadoId') empregadoId?: string,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    if (!empregadoId || !inicio || !fim) throw new BadRequestException('Informe empregadoId, inicio e fim');
    return this.tratamento.listarEscala(this.tenant(u), empregadoId, inicio, fim);
  }

  @Get('apuracao/pdf') async apuracaoPdf(
    @UsuarioAtual() u: PayloadAcesso,
    @Query('empregadoId') empregadoId?: string,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
    @Query('feriados') feriados?: string,
  ) {
    if (!empregadoId || !inicio || !fim) throw new BadRequestException('Informe empregadoId, inicio e fim (YYYY-MM-DD)');
    const fer = feriados ? feriados.split(',').map((f) => f.trim()).filter(Boolean) : [];
    const r = await this.tratamento.gerarApuracaoPdf(this.tenant(u), empregadoId, inicio, fim, fer);
    return new StreamableFile(r.buffer, { type: 'application/pdf', disposition: `attachment; filename="${r.nomeArquivo}"` });
  }
}
