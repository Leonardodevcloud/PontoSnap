import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Perfil } from '@ponto/shared';
import { PERFIS_KEY } from '../decorators/roles.decorator';
import { podeAcessar } from '../rbac';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const permitidos = this.reflector.getAllAndOverride<Perfil[]>(PERFIS_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]) ?? [];
    const usuario = ctx.switchToHttp().getRequest().usuario;
    if (!usuario) throw new ForbiddenException('Não autenticado');
    if (!podeAcessar(usuario.perfil, permitidos)) {
      throw new ForbiddenException('Perfil sem permissão para este recurso');
    }
    return true;
  }
}
