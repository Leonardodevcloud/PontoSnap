interface Props { tamanho?: number; cor?: string; girando?: boolean; className?: string; }

/** O "flash" — estrela de 4 pontas, único elemento-assinatura da marca. Usar pouco. */
export function Flash({ tamanho = 40, cor = 'var(--coral)', girando = false, className }: Props) {
  return (
    <svg
      width={tamanho} height={tamanho} viewBox="0 0 100 100" aria-hidden="true"
      className={className}
      style={girando ? { animation: 'flash-spin 14s linear infinite' } : undefined}
    >
      <path d="M50 0 L58 40 L100 50 L58 60 L50 100 L42 60 L0 50 L42 40 Z" fill={cor} />
    </svg>
  );
}
