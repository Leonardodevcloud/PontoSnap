import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { TransferenciaService } from './transferencia.service';
import { TransferirCltDto, TransferirPrestadorDto } from './dto/transferencia.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';

/** Transferência de pessoas (CLT e prestadores) entre CNPJs do grupo. */
@Controller('transferencias')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
export class TransferenciaController {
  constructor(private readonly svc: TransferenciaService) {}

  private tenant(u: PayloadAcesso): string {
    if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
    return u.tenantId;
  }

  @Get('info')
  info(@UsuarioAtual() u: PayloadAcesso, @Query('tipo') tipo: string, @Query('id') id: string, @Query('data') data?: string) {
    return this.svc.info(this.tenant(u), u.sub, tipo === 'PRESTADOR' ? 'PRESTADOR' : 'CLT', id, data);
  }

  @Post('clt/:id')
  clt(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string, @Body() dto: TransferirCltDto) {
    return this.svc.transferirClt(this.tenant(u), u.sub, id, dto);
  }

  @Post('prestador/:id')
  prestador(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string, @Body() dto: TransferirPrestadorDto) {
    return this.svc.transferirPrestador(this.tenant(u), u.sub, id, dto);
  }
}
