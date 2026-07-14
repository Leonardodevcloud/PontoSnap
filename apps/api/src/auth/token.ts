import jwt from 'jsonwebtoken';

export interface PayloadAcesso {
  sub: string;              // id do usuário
  tenantId: string | null;  // null para MASTER
  perfil: string;
  deveTrocarSenha?: boolean;
}

export interface ConfigToken {
  segredoAcesso: string;
  segredoRefresh: string;
  expiraAcesso: string;     // ex.: '15m'
  expiraRefresh: string;    // ex.: '7d'
}

/** Serviço de tokens JWT (access + refresh). Sem dependência de framework. */
export class TokenService {
  constructor(private readonly cfg: ConfigToken) {}

  assinarAcesso(payload: PayloadAcesso): string {
    const opts: jwt.SignOptions = { expiresIn: this.cfg.expiraAcesso as jwt.SignOptions['expiresIn'] };
    return jwt.sign(payload, this.cfg.segredoAcesso, opts);
  }

  assinarRefresh(sub: string): string {
    const opts: jwt.SignOptions = { expiresIn: this.cfg.expiraRefresh as jwt.SignOptions['expiresIn'] };
    return jwt.sign({ sub }, this.cfg.segredoRefresh, opts);
  }

  verificarAcesso(token: string): PayloadAcesso {
    return jwt.verify(token, this.cfg.segredoAcesso) as PayloadAcesso;
  }

  verificarRefresh(token: string): { sub: string } {
    return jwt.verify(token, this.cfg.segredoRefresh) as { sub: string };
  }
}
