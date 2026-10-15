import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from './api';
import { useAuth } from './auth';

/**
 * Mês em que as telas de fechamento abrem quando a URL não diz (?mes=).
 * Nos primeiros dias do mês, enquanto o anterior não foi fechado, é o anterior
 * (o RH fecha outubro no começo de novembro); senão, o mês corrente.
 * A regra mora na API (GET /pessoal/mes-padrao); aqui só cacheia por empresa/dia.
 */
const cache = new Map<string, Promise<string>>();
const mesLocal = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7);

function buscar(tenantId: string): Promise<string> {
  const chave = `${tenantId}:${new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)}`;
  let p = cache.get(chave);
  if (!p) {
    p = api.get<{ competencia: string }>('/pessoal/mes-padrao').then((r) => r.competencia).catch(() => { cache.delete(chave); return mesLocal(); });
    cache.set(chave, p);
  }
  return p;
}

/** Depois de fechar um mês, o padrão muda: limpa o cache. */
export function esquecerMesPadrao() { cache.clear(); }

/** null enquanto carrega (a tela espera em vez de abrir no mês errado). */
export function useMesPadrao(ativo = true): string | null {
  const { sessao } = useAuth();
  const [mes, setMes] = useState<string | null>(null);
  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    void buscar(sessao?.tenantId ?? '-').then((m) => { if (vivo) setMes(m); });
    return () => { vivo = false; };
  }, [ativo, sessao?.tenantId]);
  return mes;
}

/**
 * Envolve uma tela de fechamento: se a URL não tem ?mes=, descobre o mês padrão
 * e o coloca na URL antes de a tela montar (sem carregar o mês errado antes).
 */
export function ComMesPadrao({ children }: { children: JSX.Element }) {
  const [params, setParams] = useSearchParams();
  const sem = !params.get('mes');
  const padrao = useMesPadrao(sem);
  useEffect(() => {
    if (sem && padrao) setParams((at) => { const n = new URLSearchParams(at); n.set('mes', padrao); return n; }, { replace: true });
  }, [sem, padrao, setParams]);
  if (sem) return <div aria-busy="true" style={{ minHeight: 240 }} />;
  return children;
}
