import {
  BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Query, StreamableFile, UseGuards,
} from '@nestjs/common';
import { Coletor } from '@ponto/shared';
import { MarcacaoService } from './marcacao.service';
import { BaterDto } from './dto/bater.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';

@Controller('marcacao')
@UseGuards(JwtAuthGuard)
export class MarcacaoController {
  constructor(private readonly marcacao: MarcacaoService) {}

  /** Colaborador bate ponto pelo próprio app. */
  @Post()
  async bater(@UsuarioAtual() u: PayloadAcesso, @Body() dto: BaterDto) {
    if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
    const g = await this.marcacao.baterAutenticado(u.sub, u.tenantId, dto.coletor ?? Coletor.MOBILE, {
      latitude: dto.latitude ?? null, longitude: dto.longitude ?? null,
    });
    return { nsr: g.nsr, dtMarcacao: g.dtMarcacao, hash: g.hashRegistro };
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
