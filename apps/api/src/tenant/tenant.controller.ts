import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { TenantService } from './tenant.service';
import { CriarTenantDto, AtivoDto, FusoDto } from './dto/tenant.dto';
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
  @Patch(':id/fuso') fuso(@Param('id') id: string, @Body() dto: FusoDto) {
    return this.tenants.definirFuso(id, dto.fuso);
  }
}
