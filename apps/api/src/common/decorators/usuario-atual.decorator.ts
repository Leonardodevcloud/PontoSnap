import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { PayloadAcesso } from '../../auth/token';

/** Injeta o usuário autenticado (payload do JWT) no handler. */
export const UsuarioAtual = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PayloadAcesso => ctx.switchToHttp().getRequest().usuario,
);
