import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto, AlterarSenhaDto, RecuperarSenhaDto, RedefinirSenhaDto } from './dto/login.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from './token';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.senha);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('alterar-senha')
  @UseGuards(JwtAuthGuard)
  alterarSenha(@UsuarioAtual() u: PayloadAcesso, @Body() dto: AlterarSenhaDto) {
    return this.auth.alterarSenha(u.sub, dto.senhaAtual, dto.senhaNova);
  }

  /** Pede o link de recuperação. Público — resposta não revela se o e-mail existe. */
  @Post('recuperar-senha')
  recuperar(@Body() dto: RecuperarSenhaDto) {
    return this.auth.solicitarRecuperacao(dto.email);
  }

  /** Redefine a senha com o token do e-mail. Público — o token é a credencial. */
  @Post('redefinir-senha')
  redefinir(@Body() dto: RedefinirSenhaDto) {
    return this.auth.redefinirSenha(dto.token, dto.senhaNova);
  }
}
