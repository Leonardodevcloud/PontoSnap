import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Perfil } from '@ponto/shared';
import { ArgosService } from './argos.service';
import { VozArgosService } from './voz.service';
import { ArgosPerguntaDto } from './dto/argos.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';

/** Argos — assistente que explica o ponto (apuração + regras + CLT/CCT). */
@Controller('argos')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
export class ArgosController {
  constructor(private readonly argos: ArgosService, private readonly voz: VozArgosService) {}

  private tenant(u: PayloadAcesso): string {
    if (!u.tenantId) throw new BadRequestException('Usuário sem tenant');
    return u.tenantId;
  }

  @Get('status')
  status() {
    return { ativo: this.argos.ativo, voz: this.voz.transcricaoAtiva, fala: this.voz.falaAtiva };
  }

  @Post('perguntar')
  perguntar(@UsuarioAtual() u: PayloadAcesso, @Body() dto: ArgosPerguntaDto) {
    return this.argos.perguntar(this.tenant(u), u.sub, dto);
  }

  /** Áudio do microfone (base64) -> texto (Groq Whisper). */
  @Post('transcrever')
  async transcrever(@Body() b: { audioBase64?: string; mime?: string }) {
    const texto = await this.voz.transcrever(b.audioBase64 ?? '', b.mime ?? 'audio/webm');
    return { texto };
  }

  /** Texto -> voz (mp3 base64, OpenAI). A interface cai para a voz do navegador se desligado. */
  @Post('falar')
  async falar(@Body() b: { texto?: string }) {
    const audioBase64 = await this.voz.falar((b.texto ?? '').trim());
    return { audioBase64 };
  }
}
