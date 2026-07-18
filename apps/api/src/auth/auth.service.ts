import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { usuario, comoMaster, type Db } from '@ponto/db';
import { DB } from '../database/database.module';
import { hashSenha, verificarSenha } from './senha';
import { TokenService, type PayloadAcesso } from './token';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tokens: TokenService,
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
}
