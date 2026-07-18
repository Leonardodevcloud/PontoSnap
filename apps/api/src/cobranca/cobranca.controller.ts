import { BadRequestException, Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { CobrancaService } from './cobranca.service';
import { CriarPlanoDto, DefinirAssinaturaDto, GerarCobrancaDto, AnexarBoletoDto } from './dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';

/** Painel do MASTER: catálogo, assinaturas e cobranças de todas as empresas. */
@Controller('cobranca')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.MASTER)
export class CobrancaMasterController {
  constructor(private readonly cob: CobrancaService) {}

  @Get('planos') planos() { return this.cob.listarPlanos(); }
  @Post('planos') criarPlano(@Body() dto: CriarPlanoDto) { return this.cob.criarPlano(dto); }
  @Patch('planos/:id/arquivar') arquivar(@Param('id') id: string) { return this.cob.arquivarPlano(id); }

  @Get('painel') painel() { return this.cob.painelMaster(); }

  @Post('tenants/:tenantId/assinatura')
  assinatura(@Param('tenantId') tenantId: string, @Body() dto: DefinirAssinaturaDto) {
    return this.cob.definirAssinatura(tenantId, dto);
  }

  @Post('tenants/:tenantId/cobranca')
  gerar(@Param('tenantId') tenantId: string, @Body() dto: GerarCobrancaDto) {
    return this.cob.gerarCobranca(tenantId, dto.competencia);
  }

  @Patch(':id/boleto') boleto(@Param('id') id: string, @Body() dto: AnexarBoletoDto) {
    return this.cob.anexarBoleto(id, dto.boletoUrl);
  }
  @Patch(':id/pagar') pagar(@Param('id') id: string) { return this.cob.marcarPaga(id); }
}

/** Visão da empresa: a própria assinatura e o aviso de pagamento. */
@Controller('minha-assinatura')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.ADMIN_CLIENTE)
export class AssinaturaClienteController {
  constructor(private readonly cob: CobrancaService) {}

  private tenant(u: PayloadAcesso): string {
    if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
    return u.tenantId;
  }

  @Get() minha(@UsuarioAtual() u: PayloadAcesso) {
    return this.cob.minhaAssinatura(this.tenant(u));
  }

  @Post('cobrancas/:id/ja-paguei')
  jaPaguei(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string) {
    return this.cob.avisarPagamento(this.tenant(u), id);
  }
}
