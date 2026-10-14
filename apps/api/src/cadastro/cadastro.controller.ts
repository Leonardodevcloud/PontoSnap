import { BadRequestException, Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Put, StreamableFile, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';
import { CadastroService } from './cadastro.service';
import { MeuCadastroDto, RecusarFotoDto, SementeAvatarDto } from './cadastro.dto';

/** Atualização cadastral (funcionário) e fotos/caricaturas (RH). */
@Controller('cadastro')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CadastroController {
  constructor(private readonly svc: CadastroService) {}
  private t(u: PayloadAcesso): string {
    if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
    return u.tenantId;
  }

  // ---------- funcionário ----------
  @Get('meu') @Perfis(Perfil.COLABORADOR)
  async meu(@UsuarioAtual() u: PayloadAcesso) {
    const t = this.t(u);
    return this.svc.meu(t, await this.svc.empregadoDoUsuario(t, u.sub));
  }
  @Put('meu') @Perfis(Perfil.COLABORADOR)
  async salvar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: MeuCadastroDto) {
    const t = this.t(u);
    return this.svc.salvarMeu(t, await this.svc.empregadoDoUsuario(t, u.sub), dto);
  }
  @Get('meu/foto') @Perfis(Perfil.COLABORADOR) @Header('Content-Type', 'image/jpeg') @Header('Cache-Control', 'private, no-store')
  async minhaFoto(@UsuarioAtual() u: PayloadAcesso) {
    const t = this.t(u);
    return new StreamableFile(await this.svc.foto(t, await this.svc.empregadoDoUsuario(t, u.sub)));
  }

  // ---------- RH ----------
  @Get('avatares') @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  avatares(@UsuarioAtual() u: PayloadAcesso) { return this.svc.avatares(this.t(u)); }

  @Get(':id/foto') @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH) @Header('Content-Type', 'image/jpeg') @Header('Cache-Control', 'private, no-store')
  async foto(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string) {
    return new StreamableFile(await this.svc.foto(this.t(u), id));
  }
  @Post(':id/foto/aprovar') @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  aprovar(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.revisar(this.t(u), id, true, null, u.email ?? null);
  }
  @Post(':id/foto/recusar') @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  recusar(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecusarFotoDto) {
    return this.svc.revisar(this.t(u), id, false, dto.motivo, u.email ?? null);
  }
  @Put('avatar') @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  semente(@UsuarioAtual() u: PayloadAcesso, @Body() dto: SementeAvatarDto) {
    return this.svc.definirSemente(this.t(u), dto.tipo, dto.id, dto.semente);
  }
}
