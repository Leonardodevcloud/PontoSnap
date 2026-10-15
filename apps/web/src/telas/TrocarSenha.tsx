import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import type { Perfil } from '../tipos';
import { Flash } from '../components/Flash';
import { Botao } from '../components/Botao';
import { Campo } from '../components/Campo';
import { RegrasSenha, senhaValida } from '../components/RegrasSenha';
import css from './TrocarSenha.module.css';

const rotaInicial = (p: Perfil) => (p === 'COLABORADOR' || p === 'PRESTADOR' ? '/' : p === 'MASTER' ? '/master' : '/rh');

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
    if (!senhaValida(nova, conf) || (!primeiro && !atual)) return;
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
        <p className={css.sub}>{primeiro ? 'É seu primeiro acesso — crie a sua senha para continuar.' : 'Escolha uma nova senha.'}</p>
      </div>

      {!primeiro && (
        <Campo rotulo="Senha atual" type="password" autoComplete="current-password"
          value={atual} onChange={(e) => setAtual(e.target.value)} placeholder="••••••••" />
      )}
      <Campo rotulo="Nova senha" type="password" autoComplete="new-password"
        value={nova} onChange={(e) => setNova(e.target.value)} placeholder="crie sua senha" />
      <Campo rotulo="Confirmar nova senha" type="password" autoComplete="new-password"
        value={conf} onChange={(e) => setConf(e.target.value)} placeholder="repita a nova senha"
        onKeyDown={(e) => e.key === 'Enter' && submeter()} />
      <RegrasSenha senha={nova} confirmacao={conf} />
      <div style={{ height: 12 }} />

      {erro && <p className={css.erro}>{erro}</p>}
      <Botao variante="coral" onClick={submeter} disabled={enviando || (!primeiro && !atual) || !senhaValida(nova, conf)}>
        {enviando ? 'Salvando…' : 'Salvar nova senha'}
      </Botao>
    </div>
  );
}
