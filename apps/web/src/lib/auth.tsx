import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, definirAcesso, definirRefresh, obterRefresh, BASE } from './api';
import type { Perfil, RespLogin } from '../tipos';

interface Sessao { perfil: Perfil; tenantId: string | null; deveTrocarSenha: boolean; }
interface AuthCtx {
  sessao: Sessao | null;
  carregando: boolean;
  entrar: (email: string, senha: string) => Promise<void>;
  alterarSenha: (atual: string, nova: string) => Promise<void>;
  sair: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [carregando, setCarregando] = useState(true);

  // Tenta retomar a sessão pelo refresh token guardado.
  useEffect(() => {
    (async () => {
      const rt = obterRefresh();
      if (!rt) { setCarregando(false); return; }
      try {
        const res = await fetch(`${BASE}/auth/refresh`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: rt }),
        });
        if (res.ok) {
          const data = await res.json();
          definirAcesso(data.accessToken);
          setSessao(lerSessao(data.accessToken));
        } else { definirRefresh(null); }
      } catch { /* offline: segue deslogado */ }
      setCarregando(false);
    })();
  }, []);

  async function entrar(email: string, senha: string) {
    const data = await api.post<RespLogin>('/auth/login', { email, senha });
    definirAcesso(data.accessToken);
    definirRefresh(data.refreshToken);
    setSessao({ perfil: data.perfil, tenantId: data.tenantId, deveTrocarSenha: !!data.deveTrocarSenha });
  }

  async function alterarSenha(atual: string, nova: string) {
    const data = await api.post<{ accessToken: string; deveTrocarSenha: boolean }>('/auth/alterar-senha', { senhaAtual: atual, senhaNova: nova });
    definirAcesso(data.accessToken);
    setSessao((s) => (s ? { ...s, deveTrocarSenha: false } : s));
  }

  function sair() {
    definirAcesso(null);
    definirRefresh(null);
    setSessao(null);
  }

  return <Ctx.Provider value={{ sessao, carregando, entrar, alterarSenha, sair }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth fora do AuthProvider');
  return c;
}

/** Extrai perfil/tenant do payload do JWT (sem verificar assinatura — só leitura). */
function lerSessao(token: string): Sessao {
  try {
    const payload = JSON.parse(atob(token.split('.')[1] ?? ''));
    return { perfil: payload.perfil, tenantId: payload.tenantId ?? null, deveTrocarSenha: !!payload.deveTrocarSenha };
  } catch { return { perfil: 'COLABORADOR', tenantId: null, deveTrocarSenha: false }; }
}
