import css from './RegrasSenha.module.css';

/** Mínimo exigido pela API (MinLength(8) nos DTOs de senha). */
export const SENHA_MIN = 8;

/** A senha atende às regras (e, se houver confirmação, as duas batem). */
export function senhaValida(senha: string, confirmacao?: string) {
  return senha.length >= SENHA_MIN && (confirmacao === undefined || senha === confirmacao);
}

/**
 * Gabarito da senha, visível desde o início: a pessoa vê o que é exigido
 * antes de errar, e cada regra fica verde quando é cumprida.
 */
export function RegrasSenha({ senha, confirmacao }: { senha: string; confirmacao?: string }) {
  const regras = [
    { ok: senha.length >= SENHA_MIN, texto: `Pelo menos ${SENHA_MIN} caracteres${senha.length > 0 && senha.length < SENHA_MIN ? ` (faltam ${SENHA_MIN - senha.length})` : ''}` },
    ...(confirmacao !== undefined ? [{ ok: senha.length > 0 && senha === confirmacao, texto: 'As duas senhas iguais' }] : []),
  ];
  return (
    <ul className={css.regras} aria-label="Regras da senha">
      {regras.map((r) => (
        <li key={r.texto.slice(0, 12)} className={r.ok ? css.ok : undefined}>
          <span className={css.marca} aria-hidden="true">{r.ok ? '✓' : ''}</span>
          {r.texto}<span className="sr-only">{r.ok ? ' — ok' : ' — pendente'}</span>
        </li>
      ))}
    </ul>
  );
}
