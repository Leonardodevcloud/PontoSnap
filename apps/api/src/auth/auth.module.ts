import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { KioskService } from './kiosk.service';
import { TokenService } from './token';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { KioskGuard } from '../common/guards/kiosk.guard';

const tokenProvider = {
  provide: TokenService,
  useFactory: () => new TokenService({
    segredoAcesso: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
    segredoRefresh: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret',
    expiraAcesso: process.env.JWT_ACCESS_TTL ?? '15m',
    expiraRefresh: process.env.JWT_REFRESH_TTL ?? '7d',
  }),
};

@Module({
  controllers: [AuthController],
  providers: [AuthService, KioskService, tokenProvider, JwtAuthGuard, RolesGuard, KioskGuard],
  exports: [TokenService, KioskService, JwtAuthGuard, RolesGuard, KioskGuard],
})
export class AuthModule {}
