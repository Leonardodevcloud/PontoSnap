import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import css from './Login.module.css';

/** Ícones do formulário — inline para não puxar biblioteca por 3 traços. */
const IconeEmail = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
    <path d="M3.5 7l8.5 6 8.5-6" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);
const IconeCadeado = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="4" y="10" width="16" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
    <path d="M8 10V7a4 4 0 118 0v3" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);
const IconeOlho = ({ aberto }: { aberto: boolean }) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" stroke="currentColor" strokeWidth="1.8" />
    <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.8" />
    {!aberto && <path d="M4 20L20 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
  </svg>
);
const FlashSvg = ({ tamanho, cor, className }: { tamanho: number; cor: string; className?: string }) => (
  <svg width={tamanho} height={tamanho} viewBox="0 0 100 100" aria-hidden="true" className={className}>
    <path d="M50 0 L58 40 L100 50 L58 60 L50 100 L42 60 L0 50 L42 40 Z" fill={cor} />
  </svg>
);

export function Login() {
  const { entrar } = useAuth();
  const navegar = useNavigate();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [verSenha, setVerSenha] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function submeter() {
    if (!email || !senha || enviando) return;
    setErro(null);
    setEnviando(true);
    try {
      await entrar(email.trim(), senha);
      navegar('/', { replace: true });
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className={css.tela}>
      {/* Painel da marca — some no celular, vira faixa */}
      <aside className={css.marca}>
        <div className={css.ambiente} aria-hidden="true">
          <FlashSvg tamanho={460} cor="var(--coral)" className={`${css.amb} ${css.amb1}`} />
          <FlashSvg tamanho={220} cor="var(--lime)" className={`${css.amb} ${css.amb2}`} />
        </div>
        <div className={css.marcaLogo}>
          <FlashSvg tamanho={26} cor="var(--coral)" className={css.giraLogo} />
          Ponto<b>Snap</b>
        </div>
        <h2 className={css.marcaTit}>Bater ponto<br />num <span>estalo</span>.</h2>
      </aside>

      {/* Faixa da marca — só no celular */}
      <div className={css.faixaMob}>
        <div className={css.ambiente} aria-hidden="true">
          <FlashSvg tamanho={260} cor="var(--coral)" className={`${css.amb} ${css.ambMob}`} />
        </div>
        <div className={css.marcaLogo}>
          <FlashSvg tamanho={22} cor="var(--coral)" className={css.giraLogo} />
          Ponto<b>Snap</b>
        </div>
        <div className={css.faixaTag}>Bater ponto num estalo.</div>
      </div>

      {/* Formulário */}
      <main className={css.lado}>
        <div className={css.caixa}>
          <h1 className={css.titulo}>Entrar</h1>
          <p className={css.sub}>Acesse a área da sua empresa.</p>

          <div className={css.campo}>
            <label htmlFor="email">E-mail</label>
            <div className={css.entrada}>
              <IconeEmail />
              <input
                id="email" type="email" inputMode="email" autoComplete="username"
                placeholder="voce@empresa.com.br" value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void submeter()}
              />
            </div>
          </div>

          <div className={css.campo}>
            <label htmlFor="senha">Senha</label>
            <div className={css.entrada}>
              <IconeCadeado />
              <input
                id="senha" type={verSenha ? 'text' : 'password'} autoComplete="current-password"
                placeholder="••••••••" value={senha}
                onChange={(e) => setSenha(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void submeter()}
              />
              <button
                type="button" className={css.olho} onClick={() => setVerSenha((v) => !v)}
                aria-label={verSenha ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={verSenha}
              >
                <IconeOlho aberto={verSenha} />
              </button>
            </div>
          </div>

          {erro && <p className={css.erro} role="alert">{erro}</p>}

          <button className={css.entrar} onClick={submeter} disabled={enviando || !email || !senha}>
            {!enviando && <FlashSvg tamanho={17} cor="var(--cream)" className={css.giraBtn} />}
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>

          {/* Ainda não existe recuperação por e-mail. Dizemos o que resolve hoje. */}
          <p className={css.ajuda}>Esqueceu a senha? Peça ao RH da sua empresa para gerar uma nova.</p>

          <div className={css.quiosque}>
            <p>Este aparelho é o<br />tablet do ponto?</p>
            <button type="button" onClick={() => navegar('/quiosque')}>Abrir o quiosque</button>
          </div>
        </div>
      </main>
    </div>
  );
}
