import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import css from './Login.module.css';

const Flash = ({ t, c, cn }: { t: number; c: string; cn?: string }) => (
  <svg width={t} height={t} viewBox="0 0 100 100" aria-hidden="true" className={cn}>
    <path d="M50 0 L58 40 L100 50 L58 60 L50 100 L42 60 L0 50 L42 40 Z" fill={c} />
  </svg>
);

/** Passo 1: pede o e-mail e dispara o link. Nunca revela se a conta existe. */
export function RecuperarSenha() {
  const navegar = useNavigate();
  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function submeter() {
    if (!email || enviando) return;
    setEnviando(true);
    try {
      await api.post('/auth/recuperar-senha', { email: email.trim() });
    } catch {
      // Mesmo em erro, mostramos a tela de sucesso — não vazamos nada.
    } finally {
      setEnviando(false);
      setEnviado(true);
    }
  }

  return (
    <div className={css.tela}>
      <aside className={css.marca}>
        <div className={css.ambiente} aria-hidden="true">
          <Flash t={460} c="var(--coral)" cn={`${css.amb} ${css.amb1}`} />
          <Flash t={220} c="var(--lime)" cn={`${css.amb} ${css.amb2}`} />
        </div>
        <div className={css.marcaLogo}>
          <Flash t={26} c="var(--coral)" cn={css.giraLogo} />Ponto<b>Snap</b>
        </div>
        <h2 className={css.marcaTit}>Bater ponto<br />num <span>estalo</span>.</h2>
      </aside>

      <main className={css.lado}>
        <div className={css.caixa}>
          {enviado ? (
            <>
              <h1 className={css.titulo}>Verifique seu e-mail</h1>
              <p className={css.sub}>
                Se houver uma conta com esse e-mail, enviamos um link para redefinir a senha.
                O link vale por 1 hora.
              </p>
              <button className={css.entrar} onClick={() => navegar('/login')}>
                Voltar ao login
              </button>
            </>
          ) : (
            <>
              <h1 className={css.titulo}>Recuperar senha</h1>
              <p className={css.sub}>Digite seu e-mail e enviamos um link para criar uma nova senha.</p>

              <div className={css.campo}>
                <label htmlFor="email">E-mail</label>
                <div className={css.entrada}>
                  <input
                    id="email" type="email" inputMode="email" autoComplete="username"
                    placeholder="voce@empresa.com.br" value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void submeter()}
                  />
                </div>
              </div>

              <button className={css.entrar} onClick={submeter} disabled={enviando || !email}>
                {enviando ? 'Enviando…' : 'Enviar link'}
              </button>
              <p className={css.ajuda}>
                <button type="button" className={css.link} onClick={() => navegar('/login')}>
                  Voltar ao login
                </button>
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
