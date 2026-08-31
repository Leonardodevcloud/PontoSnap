import { useTema } from '../lib/tema';

export function BotaoTema({ className }: { className?: string }) {
  const { tema, alternar } = useTema();
  return (
    <button
      onClick={alternar}
      aria-label={tema === 'light' ? 'Ativar modo escuro' : 'Ativar modo claro'}
      title={tema === 'light' ? 'Modo escuro' : 'Modo claro'}
      className={className}
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        fontSize: 18, padding: '4px 6px', lineHeight: 1,
        color: 'var(--ash)', borderRadius: 8,
      }}
    >
      {tema === 'light' ? '🌙' : '☀️'}
    </button>
  );
}
