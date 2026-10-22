import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { Tenant } from '../tipos';
import { GestaoUsuarios } from '../components/GestaoUsuarios';
import css from './Clientes.module.css';

const fmtCnpj = (c: string) => c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');

/** Master › Clientes › empresa › Usuários: quem acessa o painel desta empresa. */
export function UsuariosCliente() {
  const { id } = useParams();
  const [t, setT] = useState<Tenant | null>(null);
  useEffect(() => { if (id) api.get<Tenant>(`/tenants/${id}`).then(setT).catch(() => setT(null)); }, [id]);
  if (!id) return null;
  return (
    <div>
      <div className={css.head}>
        <div>
          <Link to="/master" style={{ fontSize: 13, fontWeight: 800, color: 'var(--coral-dark)', textDecoration: 'none' }}>‹ Clientes</Link>
          <h2>{t?.razaoSocial ?? 'Usuários'}</h2>
          <p>{t ? `${fmtCnpj(t.cnpj)} · usuários do painel (Admin e RH)` : 'Carregando…'}</p>
        </div>
      </div>
      <GestaoUsuarios base={`/tenants/${id}/usuarios`} modo="MASTER" />
    </div>
  );
}
