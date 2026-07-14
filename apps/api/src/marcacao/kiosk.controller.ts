import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Coletor, OnlineOffline, Perfil } from '@ponto/shared';
import { KioskService } from '../auth/kiosk.service';
import { MarcacaoService } from './marcacao.service';
import { KioskMarcarDto } from '../auth/dto/kiosk.dto';
import { DispositivoDto } from '../auth/dto/dispositivo.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { KioskGuard } from '../common/guards/kiosk.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';

@Controller('kiosk')
export class KioskController {
  constructor(
    private readonly kiosk: KioskService,
    private readonly marcacao: MarcacaoService,
  ) {}

  /** Admin/RH registra um tablet-quiosque. */
  @Post('dispositivos')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  registrar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: DispositivoDto) {
    return this.kiosk.registrarDispositivo(u.tenantId!, dto.nome);
  }

  /** Batida no quiosque: identifica por matrícula+PIN e grava a marcação. */
  @Post('marcar')
  @UseGuards(KioskGuard)
  async marcar(@Req() req: { tenantId: string }, @Body() dto: KioskMarcarDto) {
    const emp = await this.kiosk.identificar(req.tenantId, dto.matricula, dto.pin);
    const g = await this.marcacao.bater({
      tenantId: req.tenantId, cpf: emp.cpf,
      coletor: Coletor.DISPOSITIVO, onlineOffline: OnlineOffline.ONLINE,
    });
    return { empregado: emp, marcacao: { nsr: g.nsr, dtMarcacao: g.dtMarcacao, hash: g.hashRegistro } };
  }
}
