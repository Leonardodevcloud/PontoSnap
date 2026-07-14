import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { TokenService } from '../../auth/token';

/** Valida o access token e injeta o payload em request.usuario. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers?.authorization ?? '';
    const [tipo, token] = header.split(' ');
    if (tipo !== 'Bearer' || !token) throw new UnauthorizedException('Token ausente');
    try {
      req.usuario = this.tokens.verificarAcesso(token);
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido ou expirado');
    }
  }
}
