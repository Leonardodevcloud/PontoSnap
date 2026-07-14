import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { KioskService } from '../../auth/kiosk.service';

/** Autentica o tablet via header X-Device-Token e injeta o tenant na request. */
@Injectable()
export class KioskGuard implements CanActivate {
  constructor(private readonly kiosk: KioskService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token = req.headers?.['x-device-token'];
    if (!token) throw new UnauthorizedException('Dispositivo não autenticado');
    const { tenantId, dispositivoId } = await this.kiosk.resolverDispositivo(String(token));
    req.tenantId = tenantId;
    req.dispositivoId = dispositivoId;
    return true;
  }
}
