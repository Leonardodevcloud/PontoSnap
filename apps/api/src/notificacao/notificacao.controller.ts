import { BadRequestException, Body, Controller, Delete, Get, Post, Put, UseGuards } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { pushSubscription, notificacaoPreferencia, usuario, comTenant, type Db } from '@ponto/db';
import { DB } from '../database/database.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';
import { PushService } from './push.service';
import { SalvarSubscriptionDto, RemoverSubscriptionDto, SalvarPreferenciasDto } from './dto';

@Controller('notificacao')
@UseGuards(JwtAuthGuard)
export class NotificacaoController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly push: PushService,
  ) {}

  private exigirTenant(u: PayloadAcesso): string {
    if (!u.tenantId) throw new BadRequestException('Sem tenant');
    return u.tenantId;
  }

  /** Resolve empregadoId a partir do usuarioId (sub do JWT). */
  private async empregadoDoUsuario(tenantId: string, usuarioId: string): Promise<string> {
    return comTenant(this.db, tenantId, async (tx) => {
      const us = (await tx.select().from(usuario).where(eq(usuario.id, usuarioId)).limit(1))[0];
      if (!us?.empregadoId) throw new BadRequestException('Usuário não vinculado a um empregado');
      return us.empregadoId;
    });
  }

  // ── VAPID public key (frontend precisa pra subscribe) ──

  @Get('vapid-key')
  vapidKey() {
    return { key: this.push.vapidPublicKey };
  }

  // ── Push subscription ──

  @Post('subscription')
  async salvarSubscription(@UsuarioAtual() u: PayloadAcesso, @Body() dto: SalvarSubscriptionDto) {
    const tenantId = this.exigirTenant(u);
    return comTenant(this.db, tenantId, async (tx) => {
      const existente = await tx.select({ id: pushSubscription.id }).from(pushSubscription)
        .where(and(
          eq(pushSubscription.usuarioId, u.sub),
          eq(pushSubscription.endpoint, dto.endpoint),
        )).limit(1);

      if (existente.length > 0) {
        await tx.update(pushSubscription).set({
          p256dh: dto.p256dh,
          auth: dto.auth,
          dispositivo: dto.dispositivo ?? null,
        }).where(eq(pushSubscription.id, existente[0]!.id));
        return { ok: true, acao: 'atualizada' };
      }

      await tx.insert(pushSubscription).values({
        tenantId,
        usuarioId: u.sub,
        endpoint: dto.endpoint,
        p256dh: dto.p256dh,
        auth: dto.auth,
        dispositivo: dto.dispositivo ?? null,
      });
      return { ok: true, acao: 'criada' };
    });
  }

  @Delete('subscription')
  async removerSubscription(@UsuarioAtual() u: PayloadAcesso, @Body() dto: RemoverSubscriptionDto) {
    const tenantId = this.exigirTenant(u);
    await comTenant(this.db, tenantId, (tx) =>
      tx.delete(pushSubscription).where(and(
        eq(pushSubscription.usuarioId, u.sub),
        eq(pushSubscription.endpoint, dto.endpoint),
      )),
    );
    return { ok: true };
  }

  // ── Preferências ──

  @Get('preferencias')
  async minhasPreferencias(@UsuarioAtual() u: PayloadAcesso) {
    const tenantId = this.exigirTenant(u);
    const empregadoId = await this.empregadoDoUsuario(tenantId, u.sub);
    const rows = await comTenant(this.db, tenantId, (tx) =>
      tx.select().from(notificacaoPreferencia)
        .where(eq(notificacaoPreferencia.empregadoId, empregadoId)).limit(1),
    );
    if (rows.length === 0) {
      return {
        lembreteAntes: true, lembreteMinutos: 10,
        esqueceuEntrada: true, esqueceuAlmoco: true, esqueceuSaida: true,
        ajusteRespondido: true, atestadoAnalisado: true, espelhoDisponivel: true,
        resumoSemanal: false, bancoVencendo: true,
      };
    }
    const p = rows[0]!;
    return {
      lembreteAntes: p.lembreteAntes, lembreteMinutos: p.lembreteMinutos,
      esqueceuEntrada: p.esqueceuEntrada, esqueceuAlmoco: p.esqueceuAlmoco,
      esqueceuSaida: p.esqueceuSaida, ajusteRespondido: p.ajusteRespondido,
      atestadoAnalisado: p.atestadoAnalisado, espelhoDisponivel: p.espelhoDisponivel,
      resumoSemanal: p.resumoSemanal, bancoVencendo: p.bancoVencendo,
    };
  }

  @Put('preferencias')
  async salvarPreferencias(@UsuarioAtual() u: PayloadAcesso, @Body() dto: SalvarPreferenciasDto) {
    const tenantId = this.exigirTenant(u);
    const empregadoId = await this.empregadoDoUsuario(tenantId, u.sub);

    return comTenant(this.db, tenantId, async (tx) => {
      const existente = await tx.select({ id: notificacaoPreferencia.id }).from(notificacaoPreferencia)
        .where(eq(notificacaoPreferencia.empregadoId, empregadoId)).limit(1);

      const valores = {
        ...(dto.lembreteAntes !== undefined && { lembreteAntes: dto.lembreteAntes }),
        ...(dto.lembreteMinutos !== undefined && { lembreteMinutos: dto.lembreteMinutos }),
        ...(dto.esqueceuEntrada !== undefined && { esqueceuEntrada: dto.esqueceuEntrada }),
        ...(dto.esqueceuAlmoco !== undefined && { esqueceuAlmoco: dto.esqueceuAlmoco }),
        ...(dto.esqueceuSaida !== undefined && { esqueceuSaida: dto.esqueceuSaida }),
        ...(dto.ajusteRespondido !== undefined && { ajusteRespondido: dto.ajusteRespondido }),
        ...(dto.atestadoAnalisado !== undefined && { atestadoAnalisado: dto.atestadoAnalisado }),
        ...(dto.espelhoDisponivel !== undefined && { espelhoDisponivel: dto.espelhoDisponivel }),
        ...(dto.resumoSemanal !== undefined && { resumoSemanal: dto.resumoSemanal }),
        ...(dto.bancoVencendo !== undefined && { bancoVencendo: dto.bancoVencendo }),
        atualizadoEm: new Date(),
      };

      if (existente.length > 0) {
        await tx.update(notificacaoPreferencia).set(valores)
          .where(eq(notificacaoPreferencia.id, existente[0]!.id));
      } else {
        await tx.insert(notificacaoPreferencia).values({
          tenantId,
          empregadoId,
          ...valores,
        });
      }
      return { ok: true };
    });
  }
}
