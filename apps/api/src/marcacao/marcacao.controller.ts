import {
  BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Query, StreamableFile, UseGuards,
} from '@nestjs/common';
import { Coletor, Perfil } from '@ponto/shared';
import { MarcacaoService } from './marcacao.service';
import { TratamentoService } from '../tratamento/tratamento.service';
import { BaterDto, LocalDto } from './dto/bater.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';

@Controller('marcacao')
@UseGuards(JwtAuthGuard)
export class MarcacaoController {
  constructor(
    private readonly marcacao: MarcacaoService,
    private readonly tratamento: TratamentoService,
  ) {}

  /** Colaborador bate ponto pelo próprio app. */
  @Post()
  async bater(@UsuarioAtual() u: PayloadAcesso, @Body() dto: BaterDto) {
    if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
    const g = await this.marcacao.baterAutenticado(u.sub, u.tenantId, dto.coletor ?? Coletor.MOBILE, {
      latitude: dto.latitude ?? null, longitude: dto.longitude ?? null,
      observacao: dto.observacao ?? null,
    });
    return { nsr: g.nsr, dtMarcacao: g.dtMarcacao, hash: g.hashRegistro };
  }

  /**
   * Local do estabelecimento. O RH define; o app lê para saber quando pedir
   * observação. Nunca serve para bloquear marcação.
   */
  @Get('local')
  @UseGuards(RolesGuard) @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  async obterLocal(@UsuarioAtual() u: PayloadAcesso) {
    if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
    return this.marcacao.obterLocal(u.tenantId);
  }

  @Post('local')
  @UseGuards(RolesGuard) @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  async definirLocal(@UsuarioAtual() u: PayloadAcesso, @Body() dto: LocalDto) {
    if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
    return this.marcacao.definirLocal(u.tenantId, dto);
  }

  /**
   * Apuração do próprio colaborador num período. Ele vê os próprios números —
   * a Portaria manda dar transparência ao trabalhador, não escondê-la dele.
   */
  @Get('minha-apuracao')
  async minhaApuracao(
    @UsuarioAtual() u: PayloadAcesso,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
    if (!inicio || !fim) throw new BadRequestException('Informe inicio e fim (YYYY-MM-DD)');
    const empregadoId = await this.marcacao.empregadoDoUsuario(u.sub, u.tenantId);
    const feriados = await this.tratamento.listarFeriados(u.tenantId);
    return this.tratamento.apurarPeriodoCLT(
      u.tenantId, empregadoId, inicio, fim,
      feriados.map((f) => f.data),
    );
  }

  /** Lista as batidas do próprio colaborador (para home e espelho do dia). */
  @Get('minhas')
  async minhas(@UsuarioAtual() u: PayloadAcesso, @Query('data') data?: string) {
    if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
    return this.marcacao.listarDoUsuario(u.sub, u.tenantId, data);
  }

  /** Baixa o comprovante em PDF de uma marcação. */
  @Get(':nsr/comprovante')
  async comprovante(@UsuarioAtual() u: PayloadAcesso, @Param('nsr', ParseIntPipe) nsr: number) {
    if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
    const pdf = await this.marcacao.gerarComprovantePdf(u.tenantId, nsr);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `inline; filename="comprovante-${nsr}.pdf"`,
    });
  }
}
