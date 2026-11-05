import {
  BadRequestException, Body, Controller, Get, Header, Param, Post, Put, Query, StreamableFile, UseGuards,
} from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { HoleriteService } from './holerite.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';

interface ImportarDto { arquivoBase64: string }
interface ConfirmarDto {
  arquivoBase64: string; competencia: string;
  itens: Array<{ paginas: number[]; empregadoId: string; tenantId: string; liquidoCentavos?: number | null; brutoCentavos?: number | null }>;
}
interface PagamentoDto { pago: boolean; valorPago?: number | null }

@Controller('holerites')
@UseGuards(JwtAuthGuard, RolesGuard)
export class HoleriteController {
  constructor(private readonly holerites: HoleriteService) {}
  private tenant(u: PayloadAcesso): string {
    if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
    return u.tenantId;
  }

  /** RH sobe o PDF da contabilidade — devolve a prévia (recortado + casado), sem salvar. */
  @Post('importar')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  importar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: ImportarDto) {
    return this.holerites.importar(this.tenant(u), u.sub, dto.arquivoBase64);
  }

  /** RH confirma a conferência — salva e avisa cada funcionário. */
  @Post('confirmar')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  confirmar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: ConfirmarDto) {
    return this.holerites.confirmar(this.tenant(u), u.sub, dto);
  }

  /** Holerites do próprio funcionário. */
  @Get('meus')
  @Perfis(Perfil.COLABORADOR)
  async meus(@UsuarioAtual() u: PayloadAcesso) {
    const t = this.tenant(u);
    return this.holerites.meus(t, await this.holerites.empregadoDoUsuario(u.sub, t));
  }

  /** Mapa de bruto/líquido/pagamento do mês, para a Folha CLT. */
  @Get('competencia')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  competencia(@UsuarioAtual() u: PayloadAcesso, @Query('comp') comp: string) {
    return this.holerites.competencia(this.tenant(u), comp);
  }

  /** Puxa pras Assinaturas os contracheques já importados que ainda não viraram documento. */
  @Post('sincronizar-assinaturas')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  sincronizarAssinaturas(@UsuarioAtual() u: PayloadAcesso, @Query('comp') comp: string) {
    return this.holerites.sincronizarAssinaturas(this.tenant(u), comp);
  }

  /** RH marca/desfaz o pagamento do líquido do holerite. */
  @Put(':id/pagamento')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  pagamento(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string, @Body() dto: PagamentoDto) {
    const valorCent = dto.valorPago != null ? Math.round(dto.valorPago * 100) : null;
    return this.holerites.pagar(this.tenant(u), id, u.sub, !!dto.pago, valorCent);
  }

  /** Baixa o PDF. RH do cliente ou o dono. */
  @Get(':id/arquivo')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH, Perfil.COLABORADOR)
  @Header('Cache-Control', 'private, no-store')
  async arquivo(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string) {
    const t = this.tenant(u);
    const dono = u.perfil === Perfil.COLABORADOR
      ? await this.holerites.empregadoDoUsuario(u.sub, t) : undefined;
    const a = await this.holerites.baixar(t, id, dono);
    return new StreamableFile(a.bytes, { type: 'application/pdf', disposition: `inline; filename="${a.nome}"` });
  }
}
