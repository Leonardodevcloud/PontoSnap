import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { usuario, tokenSenha, comoMaster, type Db } from '@ponto/db';
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

    const payload: PayloadAcesso = { sub: u.id, tenantId: u.tenantId, perfil: u.perfil, email: u.email, deveTrocarSenha: u.deveTrocarSenha };
    return {
      accessToken: this.tokens.assinarAcesso(payload),
      refreshToken: this.tokens.assinarRefresh(u.id),
      perfil: u.perfil,
      tenantId: u.tenantId,
      deveTrocarSenha: u.deveTrocarSenha,
    };
  }

  async refresh(refreshToken: string) {
    let sub: string;
    try {
      ({ sub } = this.tokens.verificarRefresh(refreshToken));
    } catch {
      throw new UnauthorizedException('Refresh inválido ou expirado');
    }
    const rows = await comoMaster(this.db, (tx) =>
      tx.select().from(usuario).where(and(eq(usuario.id, sub), eq(usuario.ativo, true))).limit(1));
    const u = rows[0];
    if (!u) throw new UnauthorizedException('Usuário inativo');
    const payload: PayloadAcesso = { sub: u.id, tenantId: u.tenantId, perfil: u.perfil, email: u.email, deveTrocarSenha: u.deveTrocarSenha };
    return { accessToken: this.tokens.assinarAcesso(payload) };
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

    const payload: PayloadAcesso = { sub: u.id, tenantId: u.tenantId, perfil: u.perfil, deveTrocarSenha: false };
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

      const base = process.env.APP_WEB_URL ?? 'https://ponto-snap-web.vercel.app';
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
