import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { dataIsoBr, fmtTel, type ConviteGerado, type StatusAcesso } from '../lib/prestador';
import css from './AcessoPrestador.module.css';

interface Acesso { status: StatusAcesso; temPush: boolean; conviteExpiraEm: string | null; documento: string | null; telefone: string | null; email: string | null }

const ROTULO: Record<StatusAcesso, [string, string]> = {
  ATIVO: ['tem acesso', 'ok'], CONVIDADO: ['convite enviado', 'av'], SEM: ['sem acesso', 'cz'], BLOQUEADO: ['acesso cortado', 'er'], CONVITE_VENCIDO: ['convite venceu', 'cz'],
};
const docOk = (d: string | null | undefined) => { const n = (d ?? '').replace(/\D/g, '').length; return n === 11 || n === 14; };

/** Mensagem pronta do convite: WhatsApp, copiar mensagem e copiar link. */
export function BlocoConvite({ c }: { c: ConviteGerado }) {
  const [copiado, setCopiado] = useState<'' | 'msg' | 'link'>('');
  if (c.erro) return <p className={css.erro}>{c.erro}</p>;
  const copiar = async (t: string, q: 'msg' | 'link') => {
    try { await navigator.clipboard.writeText(t); setCopiado(q); setTimeout(() => setCopiado(''), 1800); } catch { /* sem clipboard */ }
  };
  return (
    <div className={css.convite}>
      <div className={css.msg}>{c.mensagem}</div>
      <div className={css.acoes}>
        {c.whatsapp && <a className={css.btnPri} href={c.whatsapp} target="_blank" rel="noopener noreferrer">Abrir no WhatsApp</a>}
        <button type="button" className={css.btnSec} onClick={() => copiar(c.mensagem!, 'msg')}>{copiado === 'msg' ? '✓ Copiada' : 'Copiar mensagem'}</button>
        <button type="button" className={css.btnTxt} onClick={() => copiar(c.link!, 'link')}>{copiado === 'link' ? '✓ Copiado' : 'Copiar só o link'}</button>
      </div>
      <small className={css.nota}>
        {!c.whatsapp && 'Sem celular cadastrado: copie a mensagem e mande por onde preferir. '}
        {c.emailEnviado && `Também foi por e-mail para ${c.email}. `}
        Vale até {dataIsoBr(c.expiraEm ?? null)}, uso único.
      </small>
    </div>
  );
}

/**
 * Acesso do prestador ao app, direto no cadastro dele: contato, convite
 * (WhatsApp/e-mail), cortar e devolver. Não depende de mês fechado.
 */
export function AcessoPrestador({ prestadorId, nome }: { prestadorId: string; nome: string }) {
  const [a, setA] = useState<Acesso | null>(null);
  const [tel, setTel] = useState('');
  const [email, setEmail] = useState('');
  const [porEmail, setPorEmail] = useState(true);
  const [convite, setConvite] = useState<ConviteGerado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await api.get<Acesso>(`/portal/rh/prestadores/${prestadorId}/acesso`);
      setA(r); setTel(r.telefone ? fmtTel(r.telefone) : ''); setEmail(r.email ?? '');
    } catch (e) { setErro((e as Error).message); }
  }, [prestadorId]);
  useEffect(() => { setConvite(null); setOk(null); void carregar(); }, [carregar]);

  const sujo = !!a && (tel.replace(/\D/g, '') !== (a.telefone ?? '') || email.trim().toLowerCase() !== (a.email ?? ''));
  async function salvarContato() {
    setOcupado(true); setErro(null);
    try { await api.patch(`/portal/rh/prestadores/${prestadorId}/contato`, { telefone: tel || null, email: email.trim() || null }); await carregar(); setOk('Contato salvo.'); }
    catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  }
  async function convidar() {
    setOcupado(true); setErro(null); setOk(null);
    try {
      if (sujo) await api.patch(`/portal/rh/prestadores/${prestadorId}/contato`, { telefone: tel || null, email: email.trim() || null });
      const [c] = await api.post<ConviteGerado[]>('/portal/rh/convites', { prestadorIds: [prestadorId], porEmail: porEmail && !!email.trim() });
      setConvite(c ?? null); await carregar();
    } catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  }
  async function definir(ativo: boolean) {
    setOcupado(true); setErro(null);
    try { await api.post(`/portal/rh/prestadores/${prestadorId}/acesso`, { ativo }); await carregar(); setOk(ativo ? `Acesso de ${nome.split(' ')[0]} devolvido.` : `Acesso de ${nome.split(' ')[0]} cortado.`); }
    catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  }

  if (!a) return <section className={css.bloco}><span className={css.lb}>Acesso ao app</span>{erro ? <p className={css.erro}>{erro}</p> : <p className={css.hint}>Carregando…</p>}</section>;
  const [rot, tom] = ROTULO[a.status];
  const semDoc = !docOk(a.documento);
  return (
    <section className={css.bloco}>
      <div className={css.topo}>
        <span className={css.lb}>Acesso ao app</span>
        <span className={`${css.tag} ${css[`t-${tom}`]}`}>{rot}{a.status === 'ATIVO' && !a.temPush ? ' · sem notificação' : ''}{a.status === 'CONVIDADO' && a.conviteExpiraEm ? ` · até ${dataIsoBr(a.conviteExpiraEm)}` : ''}</span>
      </div>
      <p className={css.hint}>
        {a.status === 'ATIVO' ? 'Entra com o CPF/CNPJ e a senha dele. Vê o valor, manda a nota e recebe os avisos.'
          : 'Com acesso, ele vê o valor quando você liberar, manda a nota pelo app e recebe os avisos. O usuário é o CPF/CNPJ.'}
      </p>
      <div className={css.grade}>
        <label className={css.campo}><span>Celular (WhatsApp)</span><input inputMode="tel" value={tel} onChange={(e) => setTel(e.target.value)} placeholder="(82) 99999-0000" /></label>
        <label className={css.campo}><span>E-mail (opcional)</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@email.com" /></label>
      </div>
      {semDoc && a.status !== 'ATIVO' && <p className={css.aviso}>Cadastre o CPF/CNPJ dele em "Editar nome, empresa, documento ou Pix" — é o usuário de login.</p>}
      {erro && <p className={css.erro} role="alert">{erro}</p>}
      {ok && <p className={css.ok} role="status">{ok}</p>}
      <div className={css.acoes}>
        {a.status !== 'ATIVO' && a.status !== 'BLOQUEADO' && (
          <button type="button" className={css.btnPri} disabled={ocupado || semDoc} onClick={convidar}>
            {a.status === 'CONVIDADO' || a.status === 'CONVITE_VENCIDO' ? 'Gerar novo convite' : 'Dar acesso ao app'}
          </button>
        )}
        {a.status === 'BLOQUEADO' && <button type="button" className={css.btnSec} disabled={ocupado} onClick={() => definir(true)}>Devolver acesso</button>}
        {sujo && <button type="button" className={css.btnSec} disabled={ocupado} onClick={salvarContato}>Salvar contato</button>}
        {a.status === 'ATIVO' && <button type="button" className={`${css.btnTxt} ${css.perigo}`} disabled={ocupado} onClick={() => definir(false)}>Cortar acesso</button>}
        {a.status !== 'ATIVO' && email.trim() && (
          <label className={css.chk}><input type="checkbox" checked={porEmail} onChange={(e) => setPorEmail(e.target.checked)} /> mandar também por e-mail</label>
        )}
      </div>
      {convite && <BlocoConvite c={convite} />}
    </section>
  );
}
