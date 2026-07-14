import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import type { Perfil } from '../tipos';
import { Flash } from '../components/Flash';
import { Botao } from '../components/Botao';
import { Campo } from '../components/Campo';
import css from './TrocarSenha.module.css';

const rotaInicial = (p: Perfil) => (p === 'COLABORADOR' ? '/' : p === 'MASTER' ? '/master' : '/rh');

export function TrocarSenha() {
  const { sessao, alterarSenha } = useAuth();
  const navegar = useNavigate();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [conf, setConf] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const primeiro = sessao?.deveTrocarSenha;

  async function submeter() {
    setErro(null);
    if (nova !== conf) { setErro('As senhas novas não batem.'); return; }
    if (nova.length < 8) { setErro('A nova senha precisa de pelo menos 8 caracteres.'); return; }
    setEnviando(true);
    try {
      await alterarSenha(atual, nova);
      navegar(rotaInicial(sessao?.perfil ?? 'COLABORADOR'), { replace: true });
    } catch (e) { setErro((e as Error).message); setEnviando(false); }
  }

  return (
    <div className="appshell">
      <div className={css.topo}>
        <Flash tamanho={40} />
        <h1 className={css.h}>{primeiro ? 'Bem-vindo! Defina sua senha' : 'Trocar senha'}</h1>
        <p className={css.sub}>{primeiro ? 'É seu primeiro acesso — troque a senha provisória pra continuar.' : 'Escolha uma nova senha.'}</p>
      </div>

      <Campo rotulo={primeiro ? 'Senha provisória' : 'Senha atual'} type="password" autoComplete="current-password"
        value={atual} onChange={(e) => setAtual(e.target.value)} placeholder="••••••••" />
      <Campo rotulo="Nova senha" type="password" autoComplete="new-password"
        value={nova} onChange={(e) => setNova(e.target.value)} placeholder="mínimo 8 caracteres" />
      <Campo rotulo="Confirmar nova senha" type="password" autoComplete="new-password"
        value={conf} onChange={(e) => setConf(e.target.value)} placeholder="repita a nova senha"
        onKeyDown={(e) => e.key === 'Enter' && submeter()} />

      {erro && <p className={css.erro}>{erro}</p>}
      <Botao variante="coral" onClick={submeter} disabled={enviando || !atual || !nova || !conf}>
        {enviando ? 'Salvando…' : 'Salvar nova senha'}
      </Botao>
    </div>
  );
}
