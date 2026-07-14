import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Flash } from '../components/Flash';
import { Botao } from '../components/Botao';
import { Campo } from '../components/Campo';
import css from './Login.module.css';

export function Login() {
  const { entrar } = useAuth();
  const navegar = useNavigate();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function submeter() {
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
    <div className="appshell">
      <div className={css.topo}>
        <Flash tamanho={40} />
        <div className={css.marca}>Ponto<span className={css.snap}>Snap</span></div>
        <div className={css.tag}>Bater ponto num estalo.</div>
      </div>

      <Campo rotulo="E-mail" type="email" inputMode="email" autoComplete="username"
        placeholder="voce@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Campo rotulo="Senha" type="password" autoComplete="current-password"
        placeholder="••••••••" value={senha} onChange={(e) => setSenha(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submeter()} />

      {erro && <p className={css.erro}>{erro}</p>}

      <Botao variante="coral" onClick={submeter} disabled={enviando || !email || !senha}>
        {enviando ? 'Entrando…' : 'Entrar'}
      </Botao>

      <div className={css.rodape}>REP-P · Portaria 671 · dados imutáveis</div>
    </div>
  );
}
