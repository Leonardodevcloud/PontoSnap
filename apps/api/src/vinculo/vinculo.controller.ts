import { Controller, Get, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';
import { VinculoService } from './vinculo.service';

/** App do funcionário: as empresas do grupo em que ele tem (ou teve) vínculo. */
@Controller('meus-vinculos')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.COLABORADOR)
export class VinculoController {
  constructor(private readonly vinculos: VinculoService) {}
  @Get() meus(@UsuarioAtual() u: PayloadAcesso) {
    return this.vinculos.meus(u.sub).then((vs) => vs.map(({ empregadoId: _e, cpf: _c, ...v }) => v));
  }
}
