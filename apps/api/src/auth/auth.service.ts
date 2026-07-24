import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { usuario, usuarioTenant, tenant, tokenSenha, comoMaster, type Db } from '@ponto/db';
import { DB } from '../database/database.module';
import { hashSenha, verificarSenha } from './senha';
import { createHash, randomBytes } from 'node:crypto';
import { EmailService } from '../email/email.service';
import { emailRecuperacao } from '../email/templates';
import { TokenService, type PayloadAcesso } from './token';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tokens: TokenService,
    private readonly email: EmailService,
  ) {}

  /** Empresas que o usuário administra (com o papel em cada uma). */
  async empresasDoUsuario(usuarioId: string) {
    return comoMaster(this.db, (tx) =>
      tx.select({
        tenantId: usuarioTenant.tenantId, perfil: usuarioTenant.perfil,
        razaoSocial: tenant.razaoSocial, cnpj: tenant.cnpj,
      }).from(usuarioTenant)
        .innerJoin(tenant, eq(tenant.id, usuarioTenant.tenantId))
        .where(eq(usuarioTenant.usuarioId, usuarioId))
        .orderBy(asc(tenant.razaoSocial)));
  }

  /**
   * TRAVA DE SEGURANÇA do multi-empresa. Decide em qual empresa a sessão vai
   * abrir e com qual papel, SEMPRE conferindo o vínculo no banco. O tenantId
   * que vem do navegador nunca é aceito por si só.
   *
   * `estrito` = pedido explícito de troca (recusa se não tiver acesso).
   * Sem ele (refresh), cai para uma empresa válida em vez de derrubar a sessão.
   */
  private async resolverAcesso(
    u: { id: string; tenantId: string | null; perfil: string },
    desejado?: string | null,
    estrito = false,
  ): Promise<{ tenantId: string | null; perfil: string }> {
    // MASTER opera a plataforma (sem tenant); colaborador pertence a uma só.
    if (u.perfil === 'MASTER') return { tenantId: null, perfil: u.perfil };
    if (u.perfil === 'COLABORADOR') return { tenantId: u.tenantId, perfil: u.perfil };

    const vinculos = await this.empresasDoUsuario(u.id);
    if (vinculos.length === 0) {
      // Sem vínculo cadastrado: usa a empresa do próprio usuário (comportamento
      // de sempre, para quem só administra uma).
      if (!u.tenantId) throw new UnauthorizedException('Usuário sem empresa vinculada');
      if (estrito && desejado && desejado !== u.tenantId) {
        throw new ForbiddenException('Você não tem acesso a esta empresa');
      }
      return { tenantId: u.tenantId, perfil: u.perfil };
    }

    if (desejado) {
      const v = vinculos.find((x) => x.tenantId === desejado);
      if (v) return { tenantId: v.tenantId, perfil: v.perfil };
      if (estrito) throw new ForbiddenException('Você não tem acesso a esta empresa');
    }
    // Empresa padrão, se ainda valer; senão, a primeira a que tem acesso.
    const v = vinculos.find((x) => x.tenantId === u.tenantId) ?? vinculos[0]!;
    return { tenantId: v.tenantId, perfil: v.perfil };
  }

  /**
   * Monta o payload do access token. Inclui o fuso do tenant (só para o front
   * exibir horas na hora local). MASTER não tem tenant → sem fuso.
   */
  private async montarPayload(u: { id: string; tenantId: string | null; perfil: string; email?: string; deveTrocarSenha?: boolean }): Promise<PayloadAcesso> {
    let fuso: string | undefined;
    if (u.tenantId) {
      const t = await comoMaster(this.db, (tx) =>
        tx.select({ fuso: tenant.fuso }).from(tenant).where(eq(tenant.id, u.tenantId!)).limit(1));
      fuso = t[0]?.fuso ?? undefined;
    }
    return { sub: u.id, tenantId: u.tenantId, perfil: u.perfil, email: u.email, deveTrocarSenha: u.deveTrocarSenha, fuso };
  }

  /**
   * Login por e-mail + senha. O lookup roda como MASTER porque o login é
   * anterior ao contexto de tenant (o e-mail é único global). A senha é o
   * que autentica; o token carrega o tenant p/ as próximas requisições.
   */
  async login(email: string, senha: string) {
    const rows = await comoMaster(this.db, (tx) =>
      tx.select().from(usuario).where(eq(usuario.email, email)).limit(1));
    const u = rows[0];
    if (!u || !u.ativo) throw new UnauthorizedException('Credenciais inválidas');

    const ok = await verificarSenha(senha, u.senhaHash);
    if (!ok) throw new UnauthorizedException('Credenciais inválidas');

    // Em qual empresa a sessão abre (e com qual papel) — decidido no servidor.
    const acesso = await this.resolverAcesso(u);
    const payload = await this.montarPayload({ ...u, tenantId: acesso.tenantId, perfil: acesso.perfil });
    const empresas = u.perfil === 'ADMIN_CLIENTE' || u.perfil === 'RH'
      ? await this.empresasDoUsuario(u.id) : [];
    return {
      accessToken: this.tokens.assinarAcesso(payload),
      refreshToken: this.tokens.assinarRefresh(u.id, acesso.tenantId),
      perfil: acesso.perfil,
      tenantId: acesso.tenantId,
      deveTrocarSenha: u.deveTrocarSenha,
      fuso: payload.fuso,
      /** Vazio ou com 1 item = usuário de empresa única (o front nem mostra o seletor). */
      empresas,
    };
  }

  async refresh(refreshToken: string) {
    let sub: string;
    let tenantAtivo: string | null | undefined;
    try {
      ({ sub, tenantAtivo } = this.tokens.verificarRefresh(refreshToken));
    } catch {
      throw new UnauthorizedException('Refresh inválido ou expirado');
    }
    const rows = await comoMaster(this.db, (tx) =>
      tx.select().from(usuario).where(and(eq(usuario.id, sub), eq(usuario.ativo, true))).limit(1));
    const u = rows[0];
    if (!u) throw new UnauthorizedException('Usuário inativo');
    // Revalida o vínculo: se o acesso àquela empresa foi retirado, a renovação
    // já não devolve mais permissão nela.
    const acesso = await this.resolverAcesso(u, tenantAtivo ?? null);
    const payload = await this.montarPayload({ ...u, tenantId: acesso.tenantId, perfil: acesso.perfil });
    return {
      accessToken: this.tokens.assinarAcesso(payload),
      perfil: acesso.perfil,
      tenantId: acesso.tenantId,
    };
  }

  /**
   * Troca a empresa que a sessão está enxergando. Emite tokens novos só depois
   * de conferir o vínculo — é aqui que o "quero ver a empresa X" do navegador
   * é aceito ou recusado.
   */
  async trocarEmpresa(usuarioId: string, tenantId: string) {
    const rows = await comoMaster(this.db, (tx) =>
      tx.select().from(usuario).where(and(eq(usuario.id, usuarioId), eq(usuario.ativo, true))).limit(1));
    const u = rows[0];
    if (!u) throw new UnauthorizedException('Usuário inativo');

    const acesso = await this.resolverAcesso(u, tenantId, true);
    const payload = await this.montarPayload({ ...u, tenantId: acesso.tenantId, perfil: acesso.perfil });
    return {
      accessToken: this.tokens.assinarAcesso(payload),
      refreshToken: this.tokens.assinarRefresh(u.id, acesso.tenantId),
      perfil: acesso.perfil,
      tenantId: acesso.tenantId,
      fuso: payload.fuso,
    };
  }

  /** Troca a própria senha (verifica a atual) e limpa a obrigação de trocar. */
  async alterarSenha(usuarioId: string, senhaAtual: string, senhaNova: string) {
    const rows = await comoMaster(this.db, (tx) =>
      tx.select().from(usuario).where(eq(usuario.id, usuarioId)).limit(1));
    const u = rows[0];
    if (!u) throw new UnauthorizedException('Usuário não encontrado');

    const ok = await verificarSenha(senhaAtual, u.senhaHash);
    if (!ok) throw new UnauthorizedException('Senha atual incorreta');

    const novoHash = await hashSenha(senhaNova);
    await comoMaster(this.db, (tx) =>
      tx.update(usuario).set({ senhaHash: novoHash, deveTrocarSenha: false }).where(eq(usuario.id, usuarioId)));

    const payload = await this.montarPayload({ ...u, deveTrocarSenha: false });
    return { accessToken: this.tokens.assinarAcesso(payload), deveTrocarSenha: false };
  }

  /**
   * Passo 1 da recuperação: gera um token, guarda só o hash, manda o link.
   *
   * NUNCA revela se o e-mail existe — responde igual dos dois jeitos. Assim
   * ninguém usa esta rota pra descobrir quem tem conta. Se o e-mail existe, o
   * link vai; se não, nada acontece, mas a resposta é a mesma.
   */
  async solicitarRecuperacao(email: string) {
    const rows = await comoMaster(this.db, (tx) =>
      tx.select().from(usuario).where(eq(usuario.email, email)).limit(1));
    const u = rows[0];

    if (u && u.ativo) {
      const tokenCru = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(tokenCru).digest('hex');
      const expiraEm = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

      await comoMaster(this.db, (tx) =>
        tx.insert(tokenSenha).values({ usuarioId: u.id, tokenHash, expiraEm }));

      const base = process.env.APP_WEB_URL ?? 'https://app.pontosnap.online';
      const url = `${base}/redefinir?token=${tokenCru}`;
      const { assunto, html } = emailRecuperacao('', url);
      await this.email.enviar({ para: u.email, assunto, html });
    }

    // Resposta constante — não vaza a existência do e-mail.
    return { ok: true };
  }

  /**
   * Passo 2: valida o token (existe, não expirou, não foi usado), troca a
   * senha e marca o token como usado. Uso único.
   */
  async redefinirSenha(tokenCru: string, senhaNova: string) {
    const tokenHash = createHash('sha256').update(tokenCru).digest('hex');
    const agora = new Date();

    const linha = await comoMaster(this.db, async (tx) => {
      const rows = await tx.select().from(tokenSenha)
        .where(eq(tokenSenha.tokenHash, tokenHash)).limit(1);
      return rows[0];
    });

    if (!linha || linha.usadoEm || linha.expiraEm < agora) {
      throw new UnauthorizedException('Link inválido ou expirado');
    }

    const novoHash = await hashSenha(senhaNova);
    await comoMaster(this.db, async (tx) => {
      await tx.update(usuario)
        .set({ senhaHash: novoHash, deveTrocarSenha: false })
        .where(eq(usuario.id, linha.usuarioId));
      await tx.update(tokenSenha)
        .set({ usadoEm: agora })
        .where(eq(tokenSenha.id, linha.id));
    });

    return { ok: true };
  }
}
