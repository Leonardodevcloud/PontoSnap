import {
  BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Res, StreamableFile, UploadedFiles, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Perfil } from '@ponto/shared';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';
import { ComunicacaoService, LIMITES, type ArquivoEnviado } from './comunicacao.service';
import { ArquivarDto, FixarDto, LembrarDto, PublicarDto, ReacaoDto, SalvarComunicadoDto, VideoDto, VotoDto } from './comunicacao.dto';

const RH = [Perfil.ADMIN_CLIENTE, Perfil.RH] as const;

/** Comunicação interna: o RH publica, o funcionário lê e dá ciência no app. */
@Controller('comunicacao')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ComunicacaoController {
  constructor(private readonly svc: ComunicacaoService) {}
  private t(u: PayloadAcesso): string {
    if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
    return u.tenantId;
  }
  private autor(u: PayloadAcesso) {
    const nome = (u.email ?? 'RH').split('@')[0]!;
    return { id: u.sub, nome: nome.charAt(0).toUpperCase() + nome.slice(1) };
  }
  private enviarMidia(res: Response, m: { dados: Buffer; mime: string; nome: string | null }, baixar: boolean) {
    res.set({
      'Content-Type': m.mime, 'Cache-Control': 'private, max-age=86400',
      ...(baixar ? { 'Content-Disposition': `attachment; filename="${encodeURIComponent(m.nome ?? 'arquivo')}"` } : {}),
    });
    return new StreamableFile(m.dados);
  }

  // ───────── funcionário (rotas fixas antes de :id) ─────────
  @Get('meus') @Perfis(Perfil.COLABORADOR, Perfil.PRESTADOR)
  async meus(@UsuarioAtual() u: PayloadAcesso) {
    const t = this.t(u);
    return this.svc.meus(t, await this.svc.empregadoDoUsuario(t, u.sub));
  }
  @Get('meus/resumo') @Perfis(Perfil.COLABORADOR, Perfil.PRESTADOR)
  async meuResumo(@UsuarioAtual() u: PayloadAcesso) {
    const t = this.t(u);
    return this.svc.meuResumo(t, await this.svc.empregadoDoUsuario(t, u.sub));
  }
  @Get('meus/midia/:mid') @Perfis(Perfil.COLABORADOR, Perfil.PRESTADOR)
  async minhaMidia(@UsuarioAtual() u: PayloadAcesso, @Param('mid', ParseUUIDPipe) mid: string, @Query('mini') mini: string | undefined,
    @Res({ passthrough: true }) res: Response) {
    const t = this.t(u);
    return this.enviarMidia(res, await this.svc.midia(t, mid, await this.svc.empregadoDoUsuario(t, u.sub), mini === '1'), false);
  }
  @Get('meus/:id') @Perfis(Perfil.COLABORADOR, Perfil.PRESTADOR)
  async abrir(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string) {
    const t = this.t(u);
    return this.svc.abrir(t, await this.svc.empregadoDoUsuario(t, u.sub), id);
  }
  @Post('meus/:id/midia') @Perfis(Perfil.COLABORADOR, Perfil.PRESTADOR)
  async viuMidia(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string) {
    const t = this.t(u);
    return this.svc.marcarMidia(t, await this.svc.empregadoDoUsuario(t, u.sub), id);
  }
  @Post('meus/:id/ciente') @Perfis(Perfil.COLABORADOR, Perfil.PRESTADOR)
  async ciente(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string) {
    const t = this.t(u);
    return this.svc.ciente(t, await this.svc.empregadoDoUsuario(t, u.sub), id);
  }
  @Post('meus/:id/voto') @Perfis(Perfil.COLABORADOR, Perfil.PRESTADOR)
  async votar(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VotoDto) {
    const t = this.t(u);
    return this.svc.votar(t, await this.svc.empregadoDoUsuario(t, u.sub), id, dto.opcoes);
  }
  @Post('meus/:id/reacao') @Perfis(Perfil.COLABORADOR, Perfil.PRESTADOR)
  async reagir(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReacaoDto) {
    const t = this.t(u);
    return this.svc.reagir(t, await this.svc.empregadoDoUsuario(t, u.sub), id, dto.reacao ?? null);
  }

  // ───────── RH ─────────
  @Get() @Perfis(...RH)
  listar(@UsuarioAtual() u: PayloadAcesso) { return this.svc.listar(this.t(u)); }

  @Get('opcoes') @Perfis(...RH)
  opcoes(@UsuarioAtual() u: PayloadAcesso) { return this.svc.opcoesPublico(this.t(u)); }

  @Post('video') @Perfis(...RH)
  video(@Body() dto: VideoDto) { return this.svc.infoVideo(dto.url); }

  @Post('midia') @Perfis(...RH)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'arquivo', maxCount: 1 }, { name: 'miniatura', maxCount: 1 }], { limits: { fileSize: LIMITES.AUDIO } }))
  midiaNova(@UsuarioAtual() u: PayloadAcesso, @Query('tipo') tipo: string,
    @UploadedFiles() f: { arquivo?: ArquivoEnviado[]; miniatura?: ArquivoEnviado[] }) {
    return this.svc.enviarMidia(this.t(u), tipo, f?.arquivo?.[0], f?.miniatura?.[0]);
  }
  @Get('midia/:mid') @Perfis(...RH)
  async midia(@UsuarioAtual() u: PayloadAcesso, @Param('mid', ParseUUIDPipe) mid: string, @Query('mini') mini: string | undefined,
    @Res({ passthrough: true }) res: Response) {
    return this.enviarMidia(res, await this.svc.midia(this.t(u), mid, null, mini === '1'), false);
  }

  @Post() @Perfis(...RH)
  criar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: SalvarComunicadoDto) { return this.svc.salvar(this.t(u), null, dto, this.autor(u)); }

  @Get(':id') @Perfis(...RH)
  obter(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string) { return this.svc.obter(this.t(u), id); }

  @Put(':id') @Perfis(...RH)
  atualizar(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SalvarComunicadoDto) {
    return this.svc.salvar(this.t(u), id, dto, this.autor(u));
  }
  @Delete(':id') @Perfis(...RH)
  excluir(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string) { return this.svc.excluir(this.t(u), id); }

  @Post(':id/publicar') @Perfis(...RH)
  publicar(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PublicarDto) {
    return this.svc.publicar(this.t(u), id, dto.agendadoPara);
  }
  @Post(':id/desagendar') @Perfis(...RH)
  desagendar(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string) { return this.svc.desagendar(this.t(u), id); }

  @Post(':id/lembrar') @Perfis(...RH)
  lembrar(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LembrarDto) {
    return this.svc.lembrar(this.t(u), id, dto.empregadoIds);
  }
  @Post(':id/fixar') @Perfis(...RH)
  fixar(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FixarDto) { return this.svc.fixar(this.t(u), id, dto.fixado); }

  @Post(':id/arquivar') @Perfis(...RH)
  arquivar(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ArquivarDto) {
    return this.svc.arquivar(this.t(u), id, dto.arquivar);
  }
  @Post(':id/encerrar-enquete') @Perfis(...RH)
  encerrarEnquete(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string) { return this.svc.encerrarEnquete(this.t(u), id); }

  @Get(':id/ciencia.pdf') @Perfis(...RH)
  async pdf(@UsuarioAtual() u: PayloadAcesso, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.svc.pdfCiencia(this.t(u), id);
    return new StreamableFile(r.buffer, { type: 'application/pdf', disposition: `attachment; filename="${r.nomeArquivo}"` });
  }
}
