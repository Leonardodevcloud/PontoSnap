import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, definirAcesso, definirRefresh, obterRefresh, BASE } from './api';
import { definirFusoAtivo } from './formato';
import type { Perfil, RespLogin, EmpresaAcesso } from '../tipos';

interface Sessao { perfil: Perfil; tenantId: string | null; deveTrocarSenha: boolean; }
interface AuthCtx {
  sessao: Sessao | null;
  carregando: boolean;
  /** Empresas que este acesso administra. 0 ou 1 = não mostra o seletor. */
  empresas: EmpresaAcesso[];
  entrar: (email: string, senha: string) => Promise<void>;
  alterarSenha: (atual: string, nova: string) => Promise<void>;
  trocarEmpresa: (tenantId: string) => Promise<void>;
  sair: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [empresas, setEmpresas] = useState<EmpresaAcesso[]>([]);

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
          const s = lerSessao(data.accessToken);
          setSessao(s);
          if (s.perfil === 'ADMIN_CLIENTE' || s.perfil === 'RH') {
            setEmpresas(await api.get<EmpresaAcesso[]>('/auth/empresas').catch(() => []));
          }
        } else { definirRefresh(null); }
      } catch { /* offline: segue deslogado */ }
      setCarregando(false);
    })();
  }, []);

  async function entrar(email: string, senha: string) {
    const data = await api.post<RespLogin>('/auth/login', { email, senha });
    definirAcesso(data.accessToken);
    definirRefresh(data.refreshToken);
    definirFusoAtivo(data.fuso);
    setSessao({ perfil: data.perfil, tenantId: data.tenantId, deveTrocarSenha: !!data.deveTrocarSenha });
    setEmpresas(data.empresas ?? []);
  }

  /**
   * Troca a empresa que a sessão enxerga. Quem autoriza é o servidor: aqui só
   * guardamos os tokens novos. Recarrega a página de propósito — assim nenhuma
   * tela fica com dado da empresa anterior em memória.
   */
  async function trocarEmpresa(tenantId: string) {
    const data = await api.post<RespLogin>('/auth/trocar-empresa', { tenantId });
    definirAcesso(data.accessToken);
    definirRefresh(data.refreshToken);
    definirFusoAtivo(data.fuso);
    window.location.reload();
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
    setEmpresas([]);
  }

  return <Ctx.Provider value={{ sessao, carregando, empresas, entrar, alterarSenha, trocarEmpresa, sair }}>{children}</Ctx.Provider>;
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
    definirFusoAtivo(payload.fuso);
    return { perfil: payload.perfil, tenantId: payload.tenantId ?? null, deveTrocarSenha: !!payload.deveTrocarSenha };
  } catch { return { perfil: 'COLABORADOR', tenantId: null, deveTrocarSenha: false }; }
}
