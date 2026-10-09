import { BadRequestException, Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Patch, Post, Put, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';
import { PessoalService } from './pessoal.service';
import { CompetenciaDto, ConfigCltDto, InicioCestaDto, NfArquivoDto, PagamentoDto, AdmissaoDto, ClienteDto, PadraoDto, CriarPrestadorDto, DebitoDto, EditarDebitoDto, EditarPrestadorDto, ExclusaoDto, LancamentoDto } from './dto/pessoal.dto';

/** Gestão de Pessoal: benefícios, prestadores, débitos e fechamento do mês. Escopo = empresa ativa. */
@Controller('pessoal')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
export class PessoalController {
  constructor(private readonly pessoal: PessoalService) {}
  private tenant(u: PayloadAcesso): string {
    if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
    return u.tenantId;
  }

  @Get('competencia') competencia(@UsuarioAtual() u: PayloadAcesso, @Query('comp') comp: string) {
    return this.pessoal.competencia(this.tenant(u), comp);
  }
  /** Histórico: pessoas (ativas e inativas) e os meses de uma pessoa. */
  @Get('historico/pessoas') pessoasHistorico(@UsuarioAtual() u: PayloadAcesso) {
    return this.pessoal.pessoasHistorico(this.tenant(u));
  }
  @Get('historico/:tipo/:id') historico(@UsuarioAtual() u: PayloadAcesso, @Param('tipo') tipo: string, @Param('id', new ParseUUIDPipe()) id: string) {
    if (!['CLT', 'MEI', 'MOTORISTA'].includes(tipo)) throw new BadRequestException('Tipo inválido');
    return this.pessoal.historico(this.tenant(u), tipo as 'CLT' | 'MEI' | 'MOTORISTA', id);
  }
  @Get('pessoas') pessoas(@UsuarioAtual() u: PayloadAcesso) {
    return this.pessoal.pessoas(this.tenant(u));
  }
  @Put('clt/:empregadoId/config') configClt(@UsuarioAtual() u: PayloadAcesso, @Param('empregadoId') id: string, @Body() dto: ConfigCltDto) {
    return this.pessoal.salvarConfigClt(this.tenant(u), id, dto);
  }
  @Put('clt/:empregadoId/admissao') admissao(@UsuarioAtual() u: PayloadAcesso, @Param('empregadoId') id: string, @Body() dto: AdmissaoDto) {
    return this.pessoal.definirAdmissao(this.tenant(u), id, dto.dataAdmissao ?? null);
  }
  @Put('clt/:empregadoId/cliente') cliente(@UsuarioAtual() u: PayloadAcesso, @Param('empregadoId') id: string, @Body() dto: ClienteDto) {
    return this.pessoal.definirCliente(this.tenant(u), id, dto.cliente ?? null);
  }
  @Put('clt/:empregadoId/cesta') inicioCesta(@UsuarioAtual() u: PayloadAcesso, @Param('empregadoId') id: string, @Body() dto: InicioCestaDto) {
    return this.pessoal.definirInicioCesta(this.tenant(u), id, dto.cestaDesde ?? null);
  }
  @Put('padrao') padrao(@UsuarioAtual() u: PayloadAcesso, @Body() dto: PadraoDto) {
    return this.pessoal.salvarPadrao(this.tenant(u), dto);
  }
  @Post('prestadores') criarPrestador(@UsuarioAtual() u: PayloadAcesso, @Body() dto: CriarPrestadorDto) {
    return this.pessoal.criarPrestador(this.tenant(u), dto);
  }
  @Patch('prestadores/:id') editarPrestador(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string, @Body() dto: EditarPrestadorDto) {
    return this.pessoal.editarPrestador(this.tenant(u), id, dto);
  }
  @Put('lancamento') lancamento(@UsuarioAtual() u: PayloadAcesso, @Body() dto: LancamentoDto) {
    return this.pessoal.salvarLancamento(this.tenant(u), dto);
  }
  @Post('exclusoes') excluir(@UsuarioAtual() u: PayloadAcesso, @Body() dto: ExclusaoDto) {
    return this.pessoal.excluir(this.tenant(u), dto);
  }
  @Delete('exclusoes/:id') desfazer(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string) {
    return this.pessoal.desfazerExclusao(this.tenant(u), id);
  }
  @Post('debitos') criarDebito(@UsuarioAtual() u: PayloadAcesso, @Body() dto: DebitoDto) {
    return this.pessoal.criarDebito(this.tenant(u), dto);
  }
  @Put('debitos/:id') editarDebito(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EditarDebitoDto) {
    return this.pessoal.editarDebito(this.tenant(u), id, dto);
  }
  @Delete('debitos/:id') removerDebito(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string) {
    return this.pessoal.removerDebito(this.tenant(u), id);
  }
  /** Marca/desmarca pago com valor e hora (vale em mês fechado). */
  @Put('pagamento') pagamento(@UsuarioAtual() u: PayloadAcesso, @Body() dto: PagamentoDto) {
    return this.pessoal.registrarPagamento(this.tenant(u), dto);
  }
  /** Arquivo da NF: sobe/substitui, abre (inline) e remove. */
  @Post('nf') subirNf(@UsuarioAtual() u: PayloadAcesso, @Body() dto: NfArquivoDto) {
    return this.pessoal.salvarNf(this.tenant(u), dto);
  }
  @Get('nf/:id') @Header('Cache-Control', 'private, no-store')
  async abrirNf(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string) {
    const a = await this.pessoal.baixarNf(this.tenant(u), id);
    return new StreamableFile(a.bytes, { type: a.mime, disposition: `inline; filename="${a.nome.replace(/"/g, '')}"` });
  }
  @Delete('nf/:id') removerNf(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string) {
    return this.pessoal.removerNf(this.tenant(u), id);
  }
  @Post('fechar') fechar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: CompetenciaDto) {
    return this.pessoal.fechar(this.tenant(u), dto.competencia);
  }
  /** Reabrir muda um mês já entregue: só o administrador. */
  @Post('reabrir') @Perfis(Perfil.ADMIN_CLIENTE)
  reabrir(@UsuarioAtual() u: PayloadAcesso, @Body() dto: CompetenciaDto) {
    return this.pessoal.reabrir(this.tenant(u), dto.competencia);
  }
}
