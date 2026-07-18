import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { MinhaAssinatura } from '../tipos';
import css from './BannerCobranca.module.css';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (d: string) => new Date(`${d}T12:00:00-0300`).toLocaleDateString('pt-BR');

/**
 * Aviso de mensalidade atrasada, no topo de qualquer tela do RH.
 * Só aparece quando há cobrança vencida e não paga — em dia, some.
 */
export function BannerCobranca() {
  const navegar = useNavigate();
  const [dados, setDados] = useState<MinhaAssinatura | null>(null);

  useEffect(() => { api.get<MinhaAssinatura>('/minha-assinatura').then(setDados).catch(() => {}); }, []);

  const c = dados?.emAberto;
  if (!c || !c.atrasada) return null;

  return (
    <div className={css.banner}>
      <span className={css.sino}>🔔</span>
      <div className={css.txt}>
        <strong>Sua mensalidade está atrasada</strong>
        <p>O pagamento de {brl(c.valor)} venceu em {fmtData(c.vencimento)}. Regularize para manter o acesso.</p>
      </div>
      <button className={css.btn} onClick={() => navegar('/rh/assinatura')}>Ver detalhes</button>
    </div>
  );
}
