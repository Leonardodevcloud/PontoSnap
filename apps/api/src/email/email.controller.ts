import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsEmail, IsOptional } from 'class-validator';
import { Perfil } from '@ponto/shared';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';
import { EmailService } from './email.service';

class TesteEmailDto { @IsOptional() @IsEmail() para?: string }

/** Diagnóstico do envio de e-mail (Resend): está configurado? manda um teste e mostra o erro real. */
@Controller('email')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.MASTER, Perfil.ADMIN_CLIENTE, Perfil.RH)
export class EmailController {
  constructor(private readonly email: EmailService) {}

  @Get('status') status() {
    return { ativo: this.email.ativo, remetente: this.email.de };
  }

  @Post('teste') teste(@UsuarioAtual() u: PayloadAcesso, @Body() dto: TesteEmailDto) {
    const para = dto.para ?? u.email ?? '';
    return this.email.enviarComDetalhe({
      para, assunto: 'Teste de e-mail do PontoSnap',
      html: '<p>Se você recebeu esta mensagem, o envio de e-mails do PontoSnap está funcionando.</p>',
    }).then((r) => ({ ...r, para, remetente: this.email.de }));
  }
}
