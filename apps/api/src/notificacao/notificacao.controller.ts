import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq, and, ne, desc } from 'drizzle-orm';
import { Perfil } from '@ponto/shared';
import { pushSubscription, notificacaoPreferencia, notificacaoEnvio, usuario, empregado, pessoalPrestador, comTenant, type Db } from '@ponto/db';
import { DB } from '../database/database.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Perfis } from '../common/decorators/roles.decorator';
import { UsuarioAtual } from '../common/decorators/usuario-atual.decorator';
import type { PayloadAcesso } from '../auth/token';
import { PushService } from './push.service';
import { SalvarSubscriptionDto, RemoverSubscriptionDto, SalvarPreferenciasDto } from './dto';

@Controller('notificacao')
@UseGuards(JwtAuthGuard, RolesGuard)
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

  /** Teste de push: envia pro próprio usuário logado. */
  @Get('teste')
  async teste(@UsuarioAtual() u: PayloadAcesso) {
    const tenantId = this.exigirTenant(u);
    const r = await this.push.enviar(tenantId, u.sub, null, 'teste', {
      titulo: 'Teste PontoSnap',
      corpo: 'Se você está vendo isso, as notificações estão funcionando!',
      url: '/',
      tag: `teste-${Date.now()}`,
    });
    const enviados = r.entregues;
    return {
      ok: enviados > 0,
      enviados,
      configurado: this.push.ativo,
      usuarioId: u.sub,
      tenantId,
    };
  }

  // ── Push subscription ──

  @Post('subscription')
  async salvarSubscription(@UsuarioAtual() u: PayloadAcesso, @Body() dto: SalvarSubscriptionDto) {
    const tenantId = this.exigirTenant(u);
    return comTenant(this.db, tenantId, async (tx) => {
      // Mesmo aparelho logado antes com outra pessoa: a notificação passa a ser só de quem está logado agora.
      await tx.delete(pushSubscription).where(and(
        eq(pushSubscription.tenantId, tenantId), eq(pushSubscription.endpoint, dto.endpoint), ne(pushSubscription.usuarioId, u.sub)));
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

  // ── Painel do RH: quem está com notificação ativa ──

  @Get('painel')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  async painel(@UsuarioAtual() u: PayloadAcesso) {
    const tenantId = this.exigirTenant(u);
    return comTenant(this.db, tenantId, async (tx) => {
      const emps = await tx.select({ id: empregado.id, nome: empregado.nome })
        .from(empregado).where(and(eq(empregado.tenantId, tenantId), eq(empregado.ativo, true)));
      const us = await tx.select({ id: usuario.id, empregadoId: usuario.empregadoId, prestadorId: usuario.prestadorId, ativo: usuario.ativo })
        .from(usuario).where(eq(usuario.tenantId, tenantId));
      // Prestadores (portal) também recebem push: o nome aparece no histórico de envios.
      const prest = await tx.select({ id: pessoalPrestador.id, nome: pessoalPrestador.nome }).from(pessoalPrestador).where(eq(pessoalPrestador.tenantId, tenantId));
      const subs = await tx.select({
        id: pushSubscription.id, usuarioId: pushSubscription.usuarioId, dispositivo: pushSubscription.dispositivo,
        criadoEm: pushSubscription.criadoEm, ultimoSucessoEm: pushSubscription.ultimoSucessoEm,
        ultimoErro: pushSubscription.ultimoErro, ultimoErroEm: pushSubscription.ultimoErroEm,
      }).from(pushSubscription).where(eq(pushSubscription.tenantId, tenantId));
      const prefs = await tx.select().from(notificacaoPreferencia).where(eq(notificacaoPreferencia.tenantId, tenantId));
      const envios = await tx.select().from(notificacaoEnvio)
        .where(eq(notificacaoEnvio.tenantId, tenantId)).orderBy(desc(notificacaoEnvio.criadoEm)).limit(60);

      const usuarioDe = new Map(us.filter((x) => x.empregadoId && x.ativo).map((x) => [x.empregadoId!, x.id]));
      const empDoUsuario = new Map(us.filter((x) => x.empregadoId || x.prestadorId).map((x) => [x.id, (x.empregadoId ?? x.prestadorId)!]));
      const nomeDe = new Map([...emps, ...prest].map((e) => [e.id, e.nome]));
      const prefDe = new Map(prefs.map((p) => [p.empregadoId, p]));
      const pessoas = emps.map((e) => {
        const uid = usuarioDe.get(e.id);
        const aparelhos = uid ? subs.filter((s) => s.usuarioId === uid).map((s) => ({
          id: s.id, aparelho: rotuloAparelho(s.dispositivo), criadoEm: s.criadoEm.toISOString(),
          ultimoSucessoEm: s.ultimoSucessoEm?.toISOString() ?? null, ultimoErro: s.ultimoErro, ultimoErroEm: s.ultimoErroEm?.toISOString() ?? null,
        })) : [];
        const p = prefDe.get(e.id);
        return {
          empregadoId: e.id, nome: e.nome, temApp: !!uid, aparelhos,
          preferencias: {
            lembretes: p ? p.lembreteAntes : true, lembreteMinutos: p ? p.lembreteMinutos : 10,
            esqueceu: p ? (p.esqueceuEntrada || p.esqueceuAlmoco || p.esqueceuSaida) : true,
            personalizou: !!p,
          },
        };
      }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      return {
        servidor: { ativo: this.push.ativo },
        resumo: {
          ativos: emps.length,
          comApp: pessoas.filter((p) => p.temApp).length,
          comNotificacao: pessoas.filter((p) => p.aparelhos.length > 0).length,
        },
        pessoas,
        envios: envios.map((v) => ({
          id: v.id, empregadoId: v.empregadoId ?? empDoUsuario.get(v.usuarioId) ?? null,
          nome: nomeDe.get(v.empregadoId ?? empDoUsuario.get(v.usuarioId) ?? '') ?? 'RH',
          tipo: v.tipo, titulo: v.titulo, criadoEm: v.criadoEm.toISOString(),
          dispositivos: v.dispositivos, entregues: v.entregues, erro: v.erro,
        })),
      };
    });
  }

  /** RH manda uma notificação de teste para um funcionário (confere se chega). */
  @Post('teste/:empregadoId')
  @Perfis(Perfil.ADMIN_CLIENTE, Perfil.RH)
  async testeFuncionario(@UsuarioAtual() u: PayloadAcesso, @Param('empregadoId', ParseUUIDPipe) empregadoId: string) {
    const tenantId = this.exigirTenant(u);
    if (!this.push.ativo) throw new BadRequestException('O servidor está sem as chaves de notificação (VAPID). Fale com o suporte.');
    const us = await comTenant(this.db, tenantId, (tx) => tx.select({ id: usuario.id }).from(usuario)
      .where(and(eq(usuario.tenantId, tenantId), eq(usuario.empregadoId, empregadoId), eq(usuario.ativo, true))).limit(1));
    if (!us[0]) throw new NotFoundException('Este funcionário não tem acesso ao app.');
    const r = await this.push.enviar(tenantId, us[0].id, empregadoId, 'teste', {
      titulo: 'Teste do RH', corpo: 'O RH mandou este teste para conferir se as notificações chegam no seu celular.', url: '/',
      tag: `teste-rh-${Date.now()}`,
    });
    return { dispositivos: r.dispositivos, entregues: r.entregues };
  }
}

/** "Mozilla/5.0 (Linux; Android 13; SM-A…) … Chrome/…" → "Android · Chrome". */
function rotuloAparelho(ua: string | null): string {
  if (!ua) return 'Aparelho';
  const so = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Aparelho';
  const nav = /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return nav ? `${so} · ${nav}` : so;
}
