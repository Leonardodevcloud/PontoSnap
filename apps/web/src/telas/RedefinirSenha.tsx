import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import css from './Login.module.css';

const Flash = ({ t, c, cn }: { t: number; c: string; cn?: string }) => (
  <svg width={t} height={t} viewBox="0 0 100 100" aria-hidden="true" className={cn}>
    <path d="M50 0 L58 40 L100 50 L58 60 L50 100 L42 60 L0 50 L42 40 Z" fill={c} />
  </svg>
);

/** Passo 2: recebe o token pela URL e deixa criar a nova senha. */
export function RedefinirSenha() {
  const navegar = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [senha, setSenha] = useState('');
  const [senha2, setSenha2] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState(false);

  const curta = senha.length > 0 && senha.length < 8;
  const difere = senha2.length > 0 && senha !== senha2;

  async function submeter() {
    if (!senha || senha.length < 8 || senha !== senha2 || enviando) return;
    setErro(null);
    setEnviando(true);
    try {
      await api.post('/auth/redefinir-senha', { token, senhaNova: senha });
      setPronto(true);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
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
          {!token ? (
            <>
              <h1 className={css.titulo}>Link inválido</h1>
              <p className={css.sub}>Este link não é válido. Peça um novo na tela de recuperação.</p>
              <button className={css.entrar} onClick={() => navegar('/recuperar-senha')}>
                Pedir novo link
              </button>
            </>
          ) : pronto ? (
            <>
              <h1 className={css.titulo}>Senha alterada</h1>
              <p className={css.sub}>Pronto! Já pode entrar com a nova senha.</p>
              <button className={css.entrar} onClick={() => navegar('/login')}>Ir para o login</button>
            </>
          ) : (
            <>
              <h1 className={css.titulo}>Nova senha</h1>
              <p className={css.sub}>Crie uma senha com pelo menos 8 caracteres.</p>

              <div className={css.campo}>
                <label htmlFor="s1">Nova senha</label>
                <div className={css.entrada}>
                  <input
                    id="s1" type="password" autoComplete="new-password" placeholder="••••••••"
                    value={senha} onChange={(e) => setSenha(e.target.value)}
                  />
                </div>
                {curta && <span className={css.dica}>Mínimo de 8 caracteres.</span>}
              </div>

              <div className={css.campo}>
                <label htmlFor="s2">Repita a senha</label>
                <div className={css.entrada}>
                  <input
                    id="s2" type="password" autoComplete="new-password" placeholder="••••••••"
                    value={senha2} onChange={(e) => setSenha2(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void submeter()}
                  />
                </div>
                {difere && <span className={css.dica}>As senhas não batem.</span>}
              </div>

              {erro && <p className={css.erro} role="alert">{erro}</p>}

              <button
                className={css.entrar} onClick={submeter}
                disabled={enviando || senha.length < 8 || senha !== senha2}
              >
                {enviando ? 'Salvando…' : 'Salvar nova senha'}
              </button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
