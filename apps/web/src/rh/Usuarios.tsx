import { useNavigate } from 'react-router-dom';
import { GestaoUsuarios } from '../components/GestaoUsuarios';

/** Configurações › Usuários (só Admin): a equipe que acessa o painel da empresa. */
export function Usuarios() {
  const navegar = useNavigate();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <div>
        <h2 style={{ fontSize: 28, margin: 0, lineHeight: 1.2 }}>Usuários</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--ash)', fontSize: 14 }}>Quem acessa o painel da empresa, com qual papel e em quais CNPJs.</p>
      </div>
      <GestaoUsuarios base="/usuarios" modo="ADMIN" onVerAuditoria={(u) => navegar(`/rh/auditoria?pessoa=${u.id}`)} />
    </div>
  );
}
