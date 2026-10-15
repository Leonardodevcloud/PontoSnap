import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Flash } from '../components/Flash';
import type { RespLogin } from '../tipos';
import css from './Prestador.module.css';
import { RegrasSenha, senhaValida } from '../components/RegrasSenha';

interface Convite { nome: string; empresa: string; tipo: 'MEI' | 'MOTORISTA'; email: string | null; telefone: string | null; expirado: boolean; usado: boolean }

const mascaraCel = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d.length <= 2 ? d : d.length <= 7 ? `(${d.slice(0, 2)}) ${d.slice(2)}` : `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

/** Link do convite: o prestador confere o e-mail (o usuário), cria a senha e já entra. */
export function PrimeiroAcesso() {
  const { codigo = '' } = useParams();
  const { aplicarSessao } = useAuth();
  const navegar = useNavigate();
  const [c, setC] = useState<Convite | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [senha, setSenha] = useState('');
  const [ver, setVer] = useState(false);
  const [cel, setCel] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api.get<Convite>(`/portal/convite/${encodeURIComponent(codigo)}`)
      .then((r) => { setC(r); if (r.telefone) setCel(mascaraCel(r.telefone.replace(/^55/, ''))); })
      .catch((e) => setErro((e as Error).message));
  }, [codigo]);

  async function criar() {
    setEnviando(true); setErro(null);
    try {
      const r = await api.post<RespLogin>(`/portal/convite/${encodeURIComponent(codigo)}`, { senha, telefone: cel || null });
      aplicarSessao(r);
      navegar('/', { replace: true });
    } catch (e) { setErro((e as Error).message); setEnviando(false); }
  }

  const bloqueado = c && (c.expirado || c.usado || !c.email);
  return (
    <div className={css.convite}>
      <div className={css.logo}><Flash tamanho={22} cor="var(--coral)" /><span>Ponto<b>Snap</b></span></div>
      {!c && !erro && <div className={css.esqueleto} aria-busy="true" />}
      {!c && erro && (
        <>
          <h1 className={css.oi}>Link inválido</h1>
          <p>{erro}</p>
          <button type="button" className={css.btn2} onClick={() => navegar('/login')}>Ir para o login</button>
        </>
      )}
      {c && (
        <>
          <h1 className={css.oi}>Oi, {c.nome} 👋</h1>
          <p>A <b>{c.empresa}</b> te convidou. Aqui você vai ver quanto tem a receber, mandar sua nota fiscal e receber os avisos da empresa.</p>
          {bloqueado ? (
            <>
              <div className={css.alerta}><b>{c.usado ? 'Este link já foi usado' : !c.email ? 'Falta seu e-mail' : 'Este link venceu'}</b>
                {c.usado ? 'Entre com seu e-mail e a senha que você criou.' : !c.email ? 'O RH ainda não cadastrou seu e-mail. Fale com o RH.' : 'Peça um novo link ao RH.'}</div>
              <button type="button" className={css.btn} onClick={() => navegar('/login')}>Ir para o login</button>
            </>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); if (senhaValida(senha)) void criar(); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className={css.campo}>
                <label htmlFor="pa-email">Seu usuário (e-mail)</label>
                <input id="pa-email" type="email" autoComplete="username" value={c.email ?? ''} readOnly aria-describedby="pa-email-ajuda" />
                <small id="pa-email-ajuda">É com ele que você entra no app. Se a senha for esquecida, o link para criar outra chega neste e-mail. Está errado? Fale com o RH.</small>
              </div>
              <div className={css.campo}>
                <label htmlFor="pa-senha">Crie uma senha</label>
                <div className={css.olho}>
                  <input id="pa-senha" type={ver ? 'text' : 'password'} autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} minLength={8} />
                  <button type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? 'Esconder senha' : 'Mostrar senha'}>{ver ? 'esconder' : 'mostrar'}</button>
                </div>
                <RegrasSenha senha={senha} />
              </div>
              <div className={css.campo}>
                <label htmlFor="pa-cel">Celular (para avisos)</label>
                <input id="pa-cel" inputMode="tel" autoComplete="tel" value={cel} onChange={(e) => setCel(mascaraCel(e.target.value))} placeholder="(00) 00000-0000" />
              </div>
              {erro && <div className={css.erro} role="alert">{erro}</div>}
              <button type="submit" className={css.btn} disabled={!senhaValida(senha) || enviando}>{enviando ? 'Criando…' : 'Criar meu acesso'}</button>
              <p style={{ fontSize: 12.5 }}>Depois disso, o app pede para ativar as notificações.</p>
            </form>
          )}
        </>
      )}
    </div>
  );
}
