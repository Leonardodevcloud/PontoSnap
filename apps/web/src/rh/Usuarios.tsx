import { useNavigate } from 'react-router-dom';
import { GestaoUsuarios } from '../components/GestaoUsuarios';
import { Explica } from '../components/Explica';

/** Configurações › Usuários (só Admin): a equipe que acessa o painel da empresa. */
export function Usuarios() {
  const navegar = useNavigate();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 style={{ fontSize: 28, margin: 0, lineHeight: 1.2 }}>Usuários</h2>
        <Explica>Quem acessa o painel da empresa, com qual papel e em quais CNPJs.</Explica>
      </div>
      <GestaoUsuarios base="/usuarios" modo="ADMIN" onVerAuditoria={(u) => navegar(`/rh/auditoria?pessoa=${u.id}`)} />
    </div>
  );
}
