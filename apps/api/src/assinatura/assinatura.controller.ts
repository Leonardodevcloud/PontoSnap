import { BadRequestException, Body, Controller, Delete, Get, Header, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';
import { AssinaturaService } from './assinatura.service';
import { ConfigAutentiqueDto, ConfirmarLoteDto, ContrachequeDto, EnviarDto, IdsDocsDto, LoteDto } from './assinatura.dto';

const t = (u: PayloadAcesso) => { if (!u.tenantId) throw new BadRequestException('Usuário sem empresa.'); return u.tenantId; };
const autor = (u: PayloadAcesso) => (u.email ?? 'RH').split('@')[0]!;
const pdf = (r: { buffer: Buffer; nome: string }) => new StreamableFile(r.buffer, { type: 'application/pdf', disposition: `inline; filename="${r.nome.replace(/"/g, '')}"` });

/** RH: espelho de ponto e contracheque para assinar (Autentique). */
@Controller('assinaturas')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
export class AssinaturaRhController {
  constructor(private readonly svc: AssinaturaService) {}

  @Get('config') config(@UsuarioAtual() u: PayloadAcesso) { return this.svc.config(t(u)); }
  @Put('config') @Perfis(Perfil.ADMIN_CLIENTE) salvar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: ConfigAutentiqueDto) { return this.svc.salvarConfig(t(u), dto); }
  @Post('config/testar') testar(@UsuarioAtual() u: PayloadAcesso) { return this.svc.testar(t(u)); }
  @Delete('config') @Perfis(Perfil.ADMIN_CLIENTE) desconectar(@UsuarioAtual() u: PayloadAcesso) { return this.svc.desconectar(t(u)); }

  @Get() painel(@UsuarioAtual() u: PayloadAcesso, @Query('comp') comp: string) { return this.svc.painel(t(u), comp); }
  @Post('contracheque') contracheque(@UsuarioAtual() u: PayloadAcesso, @Body() dto: ContrachequeDto) { return this.svc.salvarContracheque(t(u), dto); }
  @Delete('contracheque/:id') removerContracheque(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string) { return this.svc.removerContracheque(t(u), id); }

  @Post('lote') subirLote(@UsuarioAtual() u: PayloadAcesso, @Body() dto: LoteDto) { return this.svc.subirLote(t(u), dto); }
  @Get('lote') lote(@UsuarioAtual() u: PayloadAcesso, @Query('comp') comp: string) { return this.svc.uploadsPendentes(t(u), comp); }
  @Post('lote/confirmar') confirmar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: ConfirmarLoteDto) {
    return this.svc.confirmarLote(t(u), dto.competencia, dto.itens.map((i) => ({ uploadId: i.uploadId, empregadoId: i.empregadoId ?? null })));
  }
  @Delete('lote') descartar(@UsuarioAtual() u: PayloadAcesso, @Query('comp') comp: string) { return this.svc.descartarLote(t(u), comp); }

  @Post('enviar') enviar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: EnviarDto) { return this.svc.enviar(t(u), dto, autor(u)); }
  @Post('sincronizar') sincronizar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: Partial<IdsDocsDto>) { return this.svc.sincronizar(t(u), dto?.ids); }
  @Post('lembrar') lembrar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: IdsDocsDto) { return this.svc.lembrar(t(u), dto.ids); }
  @Post('documentos/:id/cancelar') cancelar(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string) { return this.svc.cancelar(t(u), id); }
  @Get('documentos/:id/arquivo') @Header('Cache-Control', 'private, no-store')
  async arquivo(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string, @Query('assinado') assinado?: string) {
    return pdf(await this.svc.arquivo(t(u), id, assinado === '1'));
  }
}

/** Funcionário: os próprios documentos (app › Documentos). */
@Controller('assinaturas/meus')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.COLABORADOR)
export class AssinaturaMeusController {
  constructor(private readonly svc: AssinaturaService) {}
  @Get() meus(@UsuarioAtual() u: PayloadAcesso) { return this.svc.meus(t(u), u.sub); }
  @Post(':id/link') link(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string) { return this.svc.linkMeu(t(u), u.sub, id); }
  @Post(':id/conferir') conferir(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string) { return this.svc.conferirMeu(t(u), u.sub, id); }
  @Get(':id/arquivo') @Header('Cache-Control', 'private, no-store')
  async arquivo(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string) { return pdf(await this.svc.arquivoMeu(t(u), u.sub, id)); }
}

/** Webhook público da Autentique: o token na URL identifica a empresa (+ HMAC, se configurado). */
@Controller('integracoes/autentique')
export class AutentiqueWebhookController {
  constructor(private readonly svc: AssinaturaService) {}
  @Post('retorno/:token') @HttpCode(200)
  retorno(@Param('token') token: string, @Req() req: { rawBody?: Buffer; body?: unknown }, @Headers('x-autentique-signature') sig?: string) {
    const bruto = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    return this.svc.webhook(token, bruto, sig);
  }
}
