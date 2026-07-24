import { Body, Controller, Delete, Get, Param, Patch, Post, StreamableFile, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { TenantService } from './tenant.service';
import { CriarTenantDto, AtivoDto, FusoDto, VincularEmpresaDto } from './dto/tenant.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';

/** Apenas o MASTER gerencia clientes. */
@Controller('tenants')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.MASTER)
export class TenantController {
  constructor(private readonly tenants: TenantService) {}

  @Post() criar(@Body() dto: CriarTenantDto) { return this.tenants.criar(dto); }
  @Get() listar() { return this.tenants.listar(); }
  @Get(':id') obter(@Param('id') id: string) { return this.tenants.obter(id); }
  @Patch(':id/ativo') ativo(@Param('id') id: string, @Body() dto: AtivoDto) {
    return this.tenants.definirAtivo(id, dto.ativo);
  }
  /** ATTR do cliente (art. 89). Baixa em PDF, para assinar com e-CPF. */
  @Get(':id/attr') async attr(@Param('id') id: string) {
    const { pdf, nomeArquivo } = await this.tenants.gerarAttr(id);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="${nomeArquivo}"`,
    });
  }

  // ---- Acesso multi-empresa ----
  @Get('acessos/lista') acessos() { return this.tenants.listarAcessos(); }

  @Post('acessos') vincular(@Body() dto: VincularEmpresaDto) {
    return this.tenants.vincularEmpresa(dto.usuarioId, dto.tenantId, dto.perfil);
  }

  @Delete('acessos/:vinculoId') desvincular(@Param('vinculoId') vinculoId: string) {
    return this.tenants.desvincularEmpresa(vinculoId);
  }

  @Patch(':id/fuso') fuso(@Param('id') id: string, @Body() dto: FusoDto) {
    return this.tenants.definirFuso(id, dto.fuso);
  }
}
