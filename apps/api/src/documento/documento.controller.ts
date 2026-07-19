import {
  BadRequestException, Body, Controller, Get, Header, Param, Post, Query, StreamableFile, UseGuards,
} from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { DocumentoService, type StatusDocumento } from './documento.service';
import { EnviarDocumentoDto, DecidirDto, RegistrarPeloRhDto } from './dto/documento.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';

@Controller('documentos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentoController {
  constructor(private readonly docs: DocumentoService) {}
  private tenant(u: PayloadAcesso): string {
    if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
    return u.tenantId;
  }

  /** Funcionário envia o atestado. */
  @Post()
  @Perfis(Perfil.COLABORADOR)
  async enviar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: EnviarDocumentoDto) {
    const t = this.tenant(u);
    const empregadoId = await this.docs.empregadoDoUsuario(u.sub, t);
    return this.docs.enviar(t, empregadoId, dto);
  }

  @Get('meus')
  @Perfis(Perfil.COLABORADOR)
  async meus(@UsuarioAtual() u: PayloadAcesso) {
    const t = this.tenant(u);
    return this.docs.meus(t, await this.docs.empregadoDoUsuario(u.sub, t));
  }

  @Get()
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  listar(@UsuarioAtual() u: PayloadAcesso, @Query('status') status?: StatusDocumento) {
    return this.docs.listar(this.tenant(u), status);
  }

  /** O RH registra um atestado no lugar do funcionário (papel, sem app…). */
  @Post('rh')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  registrarRh(@UsuarioAtual() u: PayloadAcesso, @Body() dto: RegistrarPeloRhDto) {
    return this.docs.registrarPeloRh(this.tenant(u), u.sub, dto);
  }

  /** Baixa o arquivo. RH vê os do cliente; funcionário só o próprio. */
  @Get(':id/arquivo')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH, Perfil.COLABORADOR)
  // Dado de saúde não fica em cache de proxy nem de navegador.
  @Header('Cache-Control', 'private, no-store')
  async arquivo(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string) {
    const t = this.tenant(u);
    const dono = u.perfil === Perfil.COLABORADOR
      ? await this.docs.empregadoDoUsuario(u.sub, t) : undefined;
    const a = await this.docs.baixar(t, id, dono);
    return new StreamableFile(a.bytes, {
      type: a.mime,
      disposition: `inline; filename="${a.nome}"`,
    });
  }

  @Post(':id/decidir')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  decidir(@UsuarioAtual() u: PayloadAcesso, @Param('id') id: string, @Body() dto: DecidirDto) {
    return this.docs.decidir(this.tenant(u), id, u.sub, dto);
  }
}
