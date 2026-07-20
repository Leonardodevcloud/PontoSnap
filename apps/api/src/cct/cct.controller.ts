import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { CctService } from './cct.service';
import { CctDto, ExtrairCctDto } from './dto/cct.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';

@Controller('cct')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CctController {
  constructor(private readonly cct: CctService) {}

  private tenant(u: PayloadAcesso): string {
    if (!u.tenantId) throw new Error('Sem tenant no token');
    return u.tenantId;
  }

  @Get()
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  listar(@UsuarioAtual() u: PayloadAcesso) {
    return this.cct.listar(this.tenant(u));
  }

  @Post()
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  criar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: CctDto) {
    return this.cct.criar(this.tenant(u), dto);
  }

  /** Lê o PDF da CCT com a IA e devolve um rascunho pro RH conferir. */
  @Post('extrair')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  extrair(@Body() dto: ExtrairCctDto) {
    return this.cct.extrairDoPdf(dto.arquivoBase64);
  }

  @Patch(':id')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  atualizar(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string, @Body() dto: CctDto) {
    return this.cct.atualizar(this.tenant(u), id, dto);
  }

  @Delete(':id')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  remover(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string) {
    return this.cct.remover(this.tenant(u), id);
  }
}
