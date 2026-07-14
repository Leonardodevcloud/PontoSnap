import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto, AlterarSenhaDto } from './dto/login.dto';
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
}
