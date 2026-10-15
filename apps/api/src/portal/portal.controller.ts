import { BadRequestException, Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';
import { PortalService } from './portal.service';
import {
  AceitarConviteDto, AcessoDto, ConfirmarValorDto, ContatoDto, ConvidarDto, EnviarNotaDto, LerNotaDto, FecharPessoaDto, IdsDto, LembrarNotasDto, LiberarDto, RecusarDto, ResponderDto,
} from './portal.dto';

const t = (u: PayloadAcesso): string => {
  if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
  return u.tenantId;
};
const autor = (u: PayloadAcesso) => (u.email ?? 'RH').split('@')[0]!;

/** Primeiro acesso do prestador pelo link do convite (público: o código + o CPF/CNPJ são a credencial). */
@Controller('portal/convite')
export class PortalConviteController {
  constructor(private readonly svc: PortalService) {}
  @Get(':codigo') ver(@Param('codigo') codigo: string) { return this.svc.convite(codigo); }
  @Post(':codigo') aceitar(@Param('codigo') codigo: string, @Body() dto: AceitarConviteDto) { return this.svc.aceitarConvite(codigo, dto); }
}

/** App do prestador: valor do mês/semana, envio da nota, histórico. */
@Controller('portal/eu')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.PRESTADOR)
export class PortalPrestadorController {
  constructor(private readonly svc: PortalService) {}
  @Get() eu(@UsuarioAtual() u: PayloadAcesso) { return this.svc.eu(t(u), u.sub); }
  @Post('notas/:id/visto') visto(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string) { return this.svc.marcarVisto(t(u), u.sub, id); }
  @Post('notas/:id/confirmar') confirmar(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmarValorDto) {
    return this.svc.confirmar(t(u), u.sub, id, dto);
  }
  /** Prévia: lê o PDF/XML escolhido e confere, sem gravar. */
  @Post('notas/:id/ler') ler(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LerNotaDto) {
    return this.svc.lerNota(t(u), u.sub, id, dto);
  }
  @Post('notas/:id/enviar') enviar(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EnviarNotaDto) {
    return this.svc.enviarNota(t(u), u.sub, id, dto);
  }
  @Get('notas/:id/arquivo') @Header('Cache-Control', 'private, no-store')
  async arquivo(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string) {
    const a = await this.svc.meuArquivo(t(u), u.sub, id);
    return new StreamableFile(a.bytes, { type: a.mime, disposition: `inline; filename="${a.nome.replace(/"/g, '')}"` });
  }
}

/** RH: liberar valores, conferir notas, lembrar, pagar, convidar. */
@Controller('portal/rh')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
export class PortalRhController {
  constructor(private readonly svc: PortalService) {}

  @Get('painel') painel(@UsuarioAtual() u: PayloadAcesso, @Query('comp') comp: string) { return this.svc.painel(t(u), comp); }
  @Get('conferir') conferir(@UsuarioAtual() u: PayloadAcesso) { return this.svc.filaConferir(t(u)); }
  @Get('notas/:id') nota(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string) { return this.svc.notaRh(t(u), id); }
  @Post('liberar') liberar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: LiberarDto) { return this.svc.liberar(t(u), dto); }
  /** Fechar UMA pessoa (desligamento / pagar antes do fechamento). */
  @Post('fechar-pessoa/previa') previaFechar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: FecharPessoaDto) {
    return this.svc.previaFecharPessoa(t(u), { ...dto, ultimoDia: dto.ultimoDia ?? null, proporcional: !!dto.proporcional });
  }
  @Post('fechar-pessoa') fecharPessoa(@UsuarioAtual() u: PayloadAcesso, @Body() dto: FecharPessoaDto) {
    return this.svc.fecharPessoa(t(u), { ...dto, ultimoDia: dto.ultimoDia ?? null, proporcional: !!dto.proporcional }, autor(u));
  }
  @Delete('fechar-pessoa/:id') reabrirPessoa(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.reabrirPessoa(t(u), id);
  }
  @Post('aprovar') aprovar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: IdsDto) { return this.svc.aprovar(t(u), dto.ids, autor(u)); }
  @Post('notas/:id/recusar') recusar(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecusarDto) {
    return this.svc.recusar(t(u), id, dto.motivo, autor(u));
  }
  @Post('notas/:id/responder') responder(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResponderDto) {
    return this.svc.responder(t(u), id, dto.resposta);
  }
  @Post('lembrar') lembrar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: LembrarNotasDto) { return this.svc.lembrar(t(u), dto); }
  @Post('pagar') pagar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: IdsDto) { return this.svc.pagar(t(u), dto.ids); }
  @Post('convites') convidar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: ConvidarDto) { return this.svc.convidar(t(u), dto.prestadorIds, !!dto.porEmail); }
  @Get('prestadores/:id/acesso') verAcesso(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.acessoDe(t(u), id);
  }
  @Post('prestadores/:id/acesso') acesso(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AcessoDto) {
    return this.svc.definirAcesso(t(u), id, dto.ativo);
  }
  /** Contato (celular/e-mail), documento e tomador — usados no convite e na nota. */
  @Patch('prestadores/:id/contato') contato(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ContatoDto) {
    return this.svc.salvarContato(t(u), id, dto);
  }
  @Get('zip') @Header('Cache-Control', 'private, no-store')
  async zip(@UsuarioAtual() u: PayloadAcesso, @Query('comp') comp: string, @Query('ids') ids?: string) {
    const r = await this.svc.zip(t(u), comp, ids ? ids.split(',').filter(Boolean) : undefined);
    return new StreamableFile(r.buffer, { type: 'application/zip', disposition: `attachment; filename="${r.nomeArquivo}"` });
  }
}
