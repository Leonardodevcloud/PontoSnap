import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import cssP from './Prestadores.module.css';
import css from './Integracoes.module.css';

interface Config {
  conectado: boolean; contaNome: string | null; contaEmail: string | null;
  sandbox: boolean; mostrarApp: boolean; temSegredo: boolean; webhookUrl: string | null;
}

/** Configurações › Integrações: hoje, a Autentique (assinatura de espelho e contracheque). */
export function Integracoes() {
  const { sessao } = useAuth();
  const admin = sessao?.perfil === 'ADMIN_CLIENTE';
  const [c, setC] = useState<Config | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [trocarToken, setTrocarToken] = useState(false);
  const [segredo, setSegredo] = useState('');
  const [editSegredo, setEditSegredo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [teste, setTeste] = useState<{ ok: boolean; texto: string } | null>(null);
  const [desligar, setDesligar] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const carregar = useCallback(async () => {
    try { setC(await api.get<Config>('/assinaturas/config')); setErro(null); }
    catch (e) { setErro((e as Error).message); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);
  const avisar = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 5000); };

  async function salvar(corpo: Record<string, unknown>, ok: string) {
    setOcupado(true); setErro(null);
    try { setC(await api.put<Config>('/assinaturas/config', corpo)); avisar(ok); return true; }
    catch (e) { setErro((e as Error).message); return false; }
    finally { setOcupado(false); }
  }
  async function conectar() {
    if (await salvar({ token: token.trim(), ...(c?.conectado ? {} : { sandbox: true }) }, c?.conectado ? 'Token trocado.' : 'Autentique conectada.')) { setToken(''); setTrocarToken(false); setTeste(null); }
  }
  async function testar() {
    setOcupado(true); setTeste(null);
    try {
      const r = await api.post<{ ok: boolean; nome?: string; email?: string; documentos?: number | null; erro?: string }>('/assinaturas/config/testar');
      setTeste(r.ok ? { ok: true, texto: `Conectado como ${r.email ?? r.nome}${r.documentos != null ? ` · ${r.documentos} documentos no plano` : ''}` } : { ok: false, texto: r.erro ?? 'Não conectou.' });
    } catch (e) { setTeste({ ok: false, texto: (e as Error).message }); }
    finally { setOcupado(false); }
  }
  async function copiar() {
    if (!c?.webhookUrl) return;
    try { await navigator.clipboard.writeText(c.webhookUrl); setCopiado(true); setTimeout(() => setCopiado(false), 2500); } catch { /* sem clipboard: o campo é selecionável */ }
  }

  return (
    <div className={cssP.pagina}>
      <div className={cssP.cab}><div><h2>Integrações</h2><p>Serviços externos ligados ao PontoSnap</p></div></div>
      {erro && <p className={cssP.erro} role="alert">{erro}</p>}
      {msg && <p className={cssP.okMsg} role="status">{msg}</p>}
      {!admin && <p className={cssP.hint}>Só o administrador da empresa altera as integrações. Você vê como está.</p>}

      <section className={css.secao} aria-labelledby="int-aut">
        <h3 id="int-aut">
          <span className={css.logoA} aria-hidden="true">A</span>
          <span>Autentique · assinatura eletrônica<small>Envia o espelho de ponto e o contracheque para o funcionário assinar.</small></span>
          {c && <span className={`${cssP.tag} ${c.conectado ? cssP['t-ok'] : cssP['t-cz']} ${css.estado}`}>{c.conectado ? 'conectado' : 'desligado'}</span>}
        </h3>

        {!c && !erro && <p className={cssP.hint}>Carregando…</p>}

        {c && (!c.conectado || trocarToken) && (
          <div className={css.bloco}>
            {!c.conectado && (
              <ol className={css.passos}>
                <li>Entre no painel da Autentique com a conta da empresa.</li>
                <li>Vá em <b>Configurações › API</b> e gere um token.</li>
                <li>Cole o token aqui. Ele fica guardado cifrado.</li>
              </ol>
            )}
            <div className={cssP.campo}>
              <label htmlFor="aut-token">Token da API</label>
              <input id="aut-token" type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} disabled={!admin || ocupado} placeholder="cole o token aqui" />
              <small>O PontoSnap confere o token na Autentique antes de salvar.</small>
            </div>
            <div className={css.acoes}>
              {trocarToken && <button type="button" className={cssP.btnSec} onClick={() => { setTrocarToken(false); setToken(''); }}>Cancelar</button>}
              <button type="button" className={cssP.btnPri} onClick={conectar} disabled={!admin || ocupado || token.trim().length < 10}>{ocupado ? 'Conferindo…' : c.conectado ? 'Trocar token' : 'Conectar'}</button>
            </div>
          </div>
        )}

        {c?.conectado && (
          <div className={css.bloco}>
            <div className={cssP.campos}>
              <div className={cssP.campo}>
                <span className={css.rot}>Conta</span>
                <span className={css.val}>{c.contaNome ?? '—'}{c.contaEmail ? ` (${c.contaEmail})` : ''}</span>
              </div>
              <div className={cssP.campo}>
                <span className={css.rot}>Token da API</span>
                <span className={css.val}><span className={cssP.mono}>••••••••••••••••</span>{admin && !trocarToken && <button type="button" className={cssP.btnTxt} onClick={() => setTrocarToken(true)}>trocar</button>}</span>
              </div>
            </div>

            <Chave titulo="Modo de teste" texto={c.sandbox ? 'Documentos com a marca "teste", sem gastar crédito. Desligue para valer.' : 'Desligado: os documentos valem e gastam crédito do plano.'}
              ligado={c.sandbox} desabilitado={!admin || ocupado} onTrocar={(v) => salvar({ sandbox: v }, v ? 'Modo de teste ligado.' : 'Modo de teste desligado: os próximos envios valem.')} />
            <Chave titulo="Também mostrar no app do funcionário" texto="Os documentos aparecem em Documentos, com o botão Assinar e para baixar depois."
              ligado={c.mostrarApp} desabilitado={!admin || ocupado} onTrocar={(v) => salvar({ mostrarApp: v }, v ? 'Documentos visíveis no app.' : 'Documentos escondidos do app.')} />

            <div className={cssP.campo}>
              <label htmlFor="aut-url">Endereço de retorno (webhook) · cole no painel da Autentique</label>
              <div className={css.copia}>
                <input id="aut-url" readOnly value={c.webhookUrl ?? ''} onFocus={(e) => e.target.select()} className={cssP.mono} />
                <button type="button" className={cssP.btnSec} onClick={copiar}>{copiado ? 'Copiado' : 'Copiar'}</button>
              </div>
              <small>Em <b>Configurações › Webhooks</b>, crie um para os eventos de assinatura e de documento. Com ele, o status muda na hora; sem ele, o PontoSnap confere a cada 30 minutos.</small>
            </div>

            <div className={cssP.campo}>
              <span className={css.rot}>Segredo do webhook (opcional)</span>
              {!editSegredo ? (
                <span className={css.val}>{c.temSegredo ? 'configurado · as chamadas são conferidas' : 'não configurado'}
                  {admin && <button type="button" className={cssP.btnTxt} onClick={() => setEditSegredo(true)}>{c.temSegredo ? 'trocar' : 'configurar'}</button>}
                  {admin && c.temSegredo && <button type="button" className={`${cssP.btnTxt} ${cssP.btnPerigo}`} onClick={() => salvar({ webhookSegredo: null }, 'Segredo removido.')}>remover</button>}
                </span>
              ) : (
                <div className={css.copia}>
                  <input type="password" aria-label="Segredo do webhook" autoComplete="off" value={segredo} onChange={(e) => setSegredo(e.target.value)} placeholder="o segredo que a Autentique mostra no webhook" />
                  <button type="button" className={cssP.btnSec} onClick={() => { setEditSegredo(false); setSegredo(''); }}>Cancelar</button>
                  <button type="button" className={cssP.btnPri} disabled={!segredo.trim() || ocupado} onClick={async () => { if (await salvar({ webhookSegredo: segredo }, 'Segredo salvo.')) { setEditSegredo(false); setSegredo(''); } }}>Salvar</button>
                </div>
              )}
            </div>

            <div className={css.acoes}>
              <button type="button" className={cssP.btnSec} onClick={testar} disabled={ocupado}>Testar conexão</button>
              {teste && <span className={teste.ok ? css.ok : css.falha} role="status">{teste.ok ? '✓ ' : ''}{teste.texto}</span>}
              <span style={{ flex: 1 }} />
              <Link to="/rh/documentos" className={cssP.btnTxt}>Ir para Assinaturas</Link>
              {admin && <button type="button" className={`${cssP.btnTxt} ${cssP.btnPerigo}`} onClick={() => setDesligar(true)}>Desconectar</button>}
            </div>
            {desligar && (
              <div className={css.confirma} role="alertdialog" aria-labelledby="aut-desl">
                <b id="aut-desl">Desconectar a Autentique?</b>
                <span>O token é apagado. O que já foi assinado continua guardado aqui; os pendentes param de atualizar até conectar de novo.</span>
                <div className={css.acoes}>
                  <button type="button" className={cssP.btnSec} onClick={() => setDesligar(false)} autoFocus>Manter</button>
                  <button type="button" className={cssP.btnPri} disabled={ocupado} onClick={async () => {
                    setOcupado(true);
                    try { await api.del('/assinaturas/config'); setDesligar(false); await carregar(); avisar('Autentique desconectada.'); }
                    catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
                  }}>Desconectar</button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Chave({ titulo, texto, ligado, desabilitado, onTrocar }: { titulo: string; texto: string; ligado: boolean; desabilitado?: boolean; onTrocar: (v: boolean) => void }) {
  return (
    <div className={css.linha}>
      <div><b>{titulo}</b><small>{texto}</small></div>
      <button type="button" role="switch" aria-checked={ligado} aria-label={titulo} className={`${css.tog} ${ligado ? css.togOn : ''}`} disabled={desabilitado} onClick={() => onTrocar(!ligado)}><i /></button>
    </div>
  );
}
