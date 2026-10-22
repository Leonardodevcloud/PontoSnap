import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { Modal } from './Modal';
import css from './GestaoUsuarios.module.css';

type Papel = 'ADMIN_CLIENTE' | 'RH';
export interface UsuarioEquipe {
  id: string; nome: string; nomeDefinido: boolean; email: string; perfil: Papel; ativo: boolean;
  aguardandoPrimeiroAcesso: boolean; ultimoAcessoEm: string | null; criadoEm: string; empresaPadrao: string | null;
  empresas: { id: string; razao: string; perfil: Papel }[]; voce: boolean;
}
interface EmpresaOpcao { id: string; razao: string; cnpj: string; grupo: boolean; estaEmpresa: boolean }
export interface ListaEquipe { empresa: { id: string; razao: string; cnpj: string }; usuarios: UsuarioEquipe[]; empresasPossiveis: EmpresaOpcao[] }
interface RespSenha { email: string; emailEnviado: boolean; senhaProvisoria: string | null }

const PAPEL: Record<Papel, string> = { ADMIN_CLIENTE: 'Admin', RH: 'RH' };
const fmtCnpj = (c: string) => c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
const iniciais = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
const curta = (r: string) => r.replace(/\s+(LTDA|ME|EPP|S\/?A|EIRELI)\.?$/i, '').split(' ').slice(0, 3).join(' ');
function quando(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso), hoje = new Date();
  const dia = (x: Date) => x.toLocaleDateString('pt-BR');
  const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1);
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (dia(d) === dia(hoje)) return `hoje ${hm}`;
  if (dia(d) === dia(ontem)) return `ontem ${hm}`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: d.getFullYear() === hoje.getFullYear() ? undefined : '2-digit' });
}

/**
 * Usuários (Admin/RH) de uma empresa: cada pessoa com o próprio login, para a
 * auditoria mostrar quem fez cada coisa. Usado pelo Master (qualquer empresa)
 * e pelo Admin do cliente (empresas que ele administra).
 */
export function GestaoUsuarios({ base, modo, onVerAuditoria }: {
  /** '/tenants/:id/usuarios' (Master) ou '/usuarios' (Admin do cliente). */
  base: string; modo: 'MASTER' | 'ADMIN'; onVerAuditoria?: (u: UsuarioEquipe) => void;
}) {
  const [d, setD] = useState<ListaEquipe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ texto: string; senha?: string | null } | null>(null);
  const [editando, setEditando] = useState<UsuarioEquipe | 'NOVO' | null>(null);
  const [verInativos, setVerInativos] = useState(false);

  const carregar = useCallback(async () => {
    try { setD(await api.get<ListaEquipe>(base)); setErro(null); } catch (e) { setErro((e as Error).message); }
  }, [base]);
  useEffect(() => { void carregar(); }, [carregar]);

  const ativos = d?.usuarios.filter((u) => u.ativo) ?? [];
  const inativos = d?.usuarios.filter((u) => !u.ativo) ?? [];
  const lista = verInativos ? d?.usuarios ?? [] : ativos;

  async function reenviar(u: UsuarioEquipe) {
    setErro(null);
    try {
      const r = await api.post<RespSenha>(`${base}/${u.id}/senha`);
      setMsg({ texto: r.emailEnviado ? `Acesso reenviado para ${r.email}. A senha anterior deixou de valer.` : `O e-mail não saiu. Passe a senha provisória para ${u.nome}:`, senha: r.senhaProvisoria });
      await carregar();
    } catch (e) { setErro((e as Error).message); }
  }
  async function reativar(u: UsuarioEquipe) {
    setErro(null);
    try { await api.patch(`${base}/${u.id}/ativo`, { ativo: true }); setMsg({ texto: `${u.nome} reativado(a). Se não lembrar a senha, use "Reenviar acesso".` }); await carregar(); }
    catch (e) { setErro((e as Error).message); }
  }

  return (
    <div className={css.raiz}>
      <div className={css.topo}>
        <p className={css.sub}>
          {d ? <>{ativos.length} {ativos.length === 1 ? 'pessoa acessa' : 'pessoas acessam'} {curta(d.empresa.razao)}.</> : 'Carregando…'}
          {' '}Cada uma entra com o próprio login, então a auditoria mostra quem fez cada coisa.
        </p>
        <button type="button" className={css.btnPri} onClick={() => { setMsg(null); setEditando('NOVO'); }} disabled={!d}>+ Novo usuário</button>
      </div>
      {erro && <p className={css.erro} role="alert">{erro}</p>}
      {msg && (
        <div className={css.ok} role="status">
          <span>{msg.texto}</span>
          {msg.senha && <code className={css.senha}>{msg.senha}</code>}
          <button type="button" className={css.x} aria-label="Fechar aviso" onClick={() => setMsg(null)}>✕</button>
        </div>
      )}

      {d && (
        <div className={css.tabela}>
          <table>
            <thead><tr><th>Pessoa</th><th>Papel</th><th>Empresas que enxerga</th><th>Último acesso</th><th>Situação</th><th aria-label="Ações" /></tr></thead>
            <tbody>
              {lista.map((u) => (
                <tr key={u.id} className={u.ativo ? '' : css.inativo}>
                  <td>
                    <div className={css.pes}>
                      <span className={css.av} aria-hidden="true">{iniciais(u.nome)}</span>
                      <span><b>{u.nome}{u.voce && <em className={css.voce}> · você</em>}</b><small>{u.email}</small></span>
                    </div>
                  </td>
                  <td><span className={`${css.tag} ${u.perfil === 'ADMIN_CLIENTE' ? css.tIn : css.tCz}`}>{PAPEL[u.perfil]}</span></td>
                  <td><div className={css.chips}>{u.empresas.map((e) => <span key={e.id} className={`${css.tag} ${css.tCz}`} title={`${e.razao} · ${PAPEL[e.perfil]}`}>{curta(e.razao)}{e.perfil !== u.perfil ? ` · ${PAPEL[e.perfil]}` : ''}</span>)}</div></td>
                  <td>{quando(u.ultimoAcessoEm) ?? <span className={css.mute}>nunca entrou</span>}</td>
                  <td>{!u.ativo ? <span className={`${css.tag} ${css.tEr}`}>desativado</span>
                    : u.aguardandoPrimeiroAcesso ? <span className={`${css.tag} ${css.tAv}`}>{u.ultimoAcessoEm ? 'senha provisória' : 'convite enviado'}</span>
                    : <span className={`${css.tag} ${css.tOk}`}>ativo</span>}</td>
                  <td className={css.acoes}>
                    {!u.ativo ? <button type="button" className={css.lk} onClick={() => reativar(u)}>Reativar</button>
                      : <>
                        {u.aguardandoPrimeiroAcesso && !u.ultimoAcessoEm && <button type="button" className={css.lk} onClick={() => reenviar(u)}>Reenviar acesso</button>}
                        <button type="button" className={css.lk} onClick={() => { setMsg(null); setEditando(u); }}>Editar</button>
                      </>}
                  </td>
                </tr>
              ))}
              {lista.length === 0 && <tr><td colSpan={6} className={css.vazio}>Nenhum usuário. Crie o primeiro em "+ Novo usuário".</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {inativos.length > 0 && (
        <button type="button" className={css.lk} onClick={() => setVerInativos((v) => !v)}>
          {verInativos ? 'Esconder desativados' : `Mostrar ${inativos.length} ${inativos.length === 1 ? 'desativado' : 'desativados'}`}
        </button>
      )}
      <p className={css.nota}><b>Desativar não apaga:</b> a pessoa perde o acesso (em poucos minutos, na próxima renovação de sessão) e continua na auditoria com o nome. Para o histórico ficar completo, ninguém é excluído.</p>

      {editando && d && (
        <EditorUsuario d={d} u={editando === 'NOVO' ? null : editando} base={base} modo={modo}
          onFechar={() => setEditando(null)}
          onVerAuditoria={onVerAuditoria && editando !== 'NOVO' ? () => { onVerAuditoria(editando); } : undefined}
          onFeito={async (m) => { setEditando(null); setMsg(m); await carregar(); }} />
      )}
    </div>
  );
}

function EditorUsuario({ d, u, base, modo, onFechar, onFeito, onVerAuditoria }: {
  d: ListaEquipe; u: UsuarioEquipe | null; base: string; modo: 'MASTER' | 'ADMIN';
  onFechar: () => void; onFeito: (m: { texto: string; senha?: string | null }) => Promise<void>; onVerAuditoria?: () => void;
}) {
  const aqui = d.empresa.id;
  const [nome, setNome] = useState(u ? (u.nomeDefinido ? u.nome : '') : '');
  const [email, setEmail] = useState(u?.email ?? '');
  const [perfil, setPerfil] = useState<Papel>(u?.perfil ?? 'RH');
  const [empresas, setEmpresas] = useState<Set<string>>(new Set(u ? u.empresas.map((e) => e.id) : [aqui]));
  const [enviar, setEnviar] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmar, setConfirmar] = useState<'DESATIVAR' | 'EMAIL' | null>(null);
  const [emailNovo, setEmailNovo] = useState('');

  // Empresas que esta tela pode marcar; as que a pessoa já tem e você não administra aparecem travadas.
  const opcoes = useMemo(() => {
    const ids = new Set(d.empresasPossiveis.map((e) => e.id));
    const extras = (u?.empresas ?? []).filter((e) => !ids.has(e.id)).map((e) => ({ id: e.id, razao: e.razao, cnpj: '', grupo: false, estaEmpresa: false, travada: true }));
    return [...d.empresasPossiveis.map((e) => ({ ...e, travada: false })), ...extras];
  }, [d, u]);
  const [verTodas, setVerTodas] = useState(false);
  const [busca, setBusca] = useState('');
  const sa = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const fixas = (e: (typeof opcoes)[number]) => e.estaEmpresa || e.grupo || empresas.has(e.id) || e.travada;
  const visiveis = modo === 'MASTER' && !verTodas ? opcoes.filter(fixas)
    : busca.trim() ? opcoes.filter((e) => fixas(e) || sa(`${e.razao} ${e.cnpj}`).includes(sa(busca.trim())) || e.cnpj.includes(busca.replace(/\D/g, '') || '§'))
    : opcoes.slice(0, Math.max(opcoes.filter(fixas).length, 30));
  const escondidas = opcoes.length - visiveis.length;
  const papelDe = (id: string) => u?.empresas.find((e) => e.id === id)?.perfil;

  const alternar = (id: string) => setEmpresas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (nome.trim().length < 2) { setErro('Informe o nome da pessoa.'); return; }
    if (!u && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setErro('E-mail inválido.'); return; }
    if (empresas.size === 0) { setErro('Marque pelo menos uma empresa. Para tirar todo o acesso, use "Desativar".'); return; }
    setSalvando(true);
    try {
      if (!u) {
        const r = await api.post<{ email: string; emailEnviado: boolean; senhaProvisoria: string | null }>(base, { nome: nome.trim(), email: email.trim(), perfil, empresas: [...empresas], enviar });
        await onFeito(r.emailEnviado
          ? { texto: `${nome.trim()} criado(a). O acesso foi enviado para ${r.email}.` }
          : { texto: `${nome.trim()} criado(a). ${enviar ? 'O e-mail não saiu: passe' : 'Passe'} o e-mail ${r.email} e a senha provisória:`, senha: r.senhaProvisoria });
      } else {
        const corpo: Record<string, unknown> = { empresas: [...empresas] };
        if (nome.trim() !== u.nome) corpo.nome = nome.trim();
        if (perfil !== u.perfil) corpo.perfil = perfil;
        await api.patch(`${base}/${u.id}`, corpo);
        await onFeito({ texto: empresas.has(aqui) ? `Dados de ${nome.trim()} salvos. Mudança de papel ou empresa vale na próxima renovação de sessão (minutos).` : `${nome.trim()} não acessa mais esta empresa.` });
      }
    } catch (x) { setErro((x as Error).message); setSalvando(false); }
  }
  async function acao<T>(f: () => Promise<T>, m: (r: T) => { texto: string; senha?: string | null }) {
    setErro(null); setSalvando(true);
    try { const r = await f(); await onFeito(m(r)); } catch (x) { setErro((x as Error).message); setSalvando(false); }
  }

  return (
    <Modal titulo={u ? `Editar · ${u.nome}` : `Novo usuário · ${curta(d.empresa.razao)}`} onFechar={onFechar}>
      <form className={css.form} onSubmit={salvar}>
        <div className={css.duo}>
          <div className={css.campo}><label htmlFor="u-nome">Nome</label>
            <input id="u-nome" autoFocus value={nome} onChange={(e) => setNome(e.target.value)} placeholder={u && !u.nomeDefinido ? u.nome : 'Nome e sobrenome'} maxLength={120} /></div>
          <div className={css.campo}><label htmlFor="u-email">E-mail (login)</label>
            <input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!!u} placeholder="pessoa@empresa.com.br" /></div>
        </div>
        {u && !u.nomeDefinido && <p className={css.dica}>Esta conta ainda não tem nome; a auditoria mostra "{u.nome}" (tirado do e-mail). Preencha para aparecer certo.</p>}

        <fieldset className={css.grupo}>
          <legend>Papel nesta empresa</legend>
          {(['ADMIN_CLIENTE', 'RH'] as Papel[]).map((p) => (
            <label key={p} className={`${css.opc} ${perfil === p ? css.opcOn : ''}`}>
              <input type="radio" name="papel" checked={perfil === p} onChange={() => setPerfil(p)} disabled={!!u?.voce} />
              <span><b>{PAPEL[p]}</b><small>{p === 'ADMIN_CLIENTE'
                ? 'Tudo do RH + regras de cálculo, integrações, plano, auditoria e os usuários da empresa.'
                : 'Ponto, pedidos, banco de horas, folha e notas de prestadores. Não mexe em configurações da empresa nem em usuários.'}</small></span>
            </label>
          ))}
          {u?.voce && <small className={css.dica}>Você não muda o seu próprio papel. Peça a outra pessoa Admin.</small>}
        </fieldset>

        <fieldset className={css.grupo}>
          <legend>Empresas que enxerga</legend>
          {visiveis.map((e) => (
            <label key={e.id} className={`${css.opc} ${empresas.has(e.id) ? css.opcOn : ''} ${e.travada ? css.opcTravada : ''}`}>
              <input type="checkbox" checked={empresas.has(e.id)} onChange={() => alternar(e.id)} disabled={e.travada || (!!u?.voce && e.id === aqui)} />
              <span><b>{curta(e.razao)}</b><small>
                {e.cnpj ? fmtCnpj(e.cnpj) : ''}
                {e.estaEmpresa ? ' · esta empresa' : e.grupo ? ' · mesmo grupo' : ''}
                {e.travada ? ' · você não administra esta (fica como está)' : ''}
                {u && papelDe(e.id) && !e.estaEmpresa ? ` · ${PAPEL[papelDe(e.id)!]} lá` : ''}
              </small></span>
            </label>
          ))}
          {escondidas > 0 && !verTodas && modo === 'MASTER' && <button type="button" className={css.lk} onClick={() => setVerTodas(true)}>Dar acesso a outra empresa ({escondidas} fora do grupo)</button>}
          {(verTodas || modo === 'ADMIN') && opcoes.length > 8 && (
            <input type="search" className={css.buscaEmp} aria-label="Buscar empresa" placeholder="Buscar empresa por nome ou CNPJ" value={busca} onChange={(e) => setBusca(e.target.value)} />
          )}
          {escondidas > 0 && verTodas && !busca.trim() && opcoes.length > visiveis.length && <small className={css.dica}>Mostrando {visiveis.length} de {opcoes.length}. Use a busca para achar outra.</small>}
          <small className={css.dica}>{modo === 'MASTER' ? '"Mesmo grupo" = empresas que os Admins desta empresa já administram. ' : ''}Nas outras empresas a pessoa entra com o mesmo papel; dá para ajustar depois na lista daquela empresa.</small>
        </fieldset>

        {!u && (
          <label className={`${css.opc} ${enviar ? css.opcOn : ''}`}>
            <input type="checkbox" checked={enviar} onChange={(e) => setEnviar(e.target.checked)} />
            <span><b>Mandar o acesso por e-mail agora</b><small>Senha provisória; a pessoa cria a dela no primeiro login. Se o e-mail não sair, a senha aparece aqui para você passar.</small></span>
          </label>
        )}

        {u && (
          <div className={css.mais}>
            <button type="button" className={css.acaoLinha} disabled={salvando} onClick={() => acao(() => api.post<RespSenha>(`${base}/${u.id}/senha`),
              (r) => ({ texto: r.emailEnviado ? `Senha nova enviada para ${r.email}. A anterior deixou de valer.` : `O e-mail não saiu. Senha provisória de ${u.nome}:`, senha: r.senhaProvisoria }))}>
              <span aria-hidden="true">🔑</span><span><b>Gerar senha nova e reenviar o acesso</b><small>A senha atual deixa de valer.</small></span>
            </button>
            {confirmar === 'EMAIL' ? (
              <div className={css.confirma}>
                <input type="email" aria-label="E-mail novo" value={emailNovo} onChange={(e) => setEmailNovo(e.target.value)} placeholder="e-mail novo" />
                <button type="button" className={css.btnSec} disabled={salvando || !emailNovo.trim()} onClick={() => acao(() => api.patch<RespSenha>(`${base}/${u.id}/email`, { email: emailNovo.trim(), reenviar: true }),
                  (r) => ({ texto: r.emailEnviado ? `E-mail trocado para ${r.email} e o acesso foi enviado.` : `E-mail trocado para ${r.email}. Passe a senha provisória:`, senha: r.senhaProvisoria }))}>Trocar e reenviar</button>
                <button type="button" className={css.lk} onClick={() => setConfirmar(null)}>cancelar</button>
              </div>
            ) : (
              <button type="button" className={css.acaoLinha} onClick={() => { setEmailNovo(u.email); setConfirmar('EMAIL'); }}>
                <span aria-hidden="true">✉️</span><span><b>Trocar e-mail de login</b><small>Quando o e-mail foi digitado errado. Manda um acesso novo para o e-mail certo.</small></span>
              </button>
            )}
            {onVerAuditoria && (
              <button type="button" className={css.acaoLinha} onClick={onVerAuditoria}>
                <span aria-hidden="true">🕑</span><span><b>Ver o que esta pessoa fez</b><small>Abre a auditoria filtrada por ela.</small></span>
              </button>
            )}
            {!u.voce && (confirmar === 'DESATIVAR' ? (
              <div className={css.confirma}>
                <span>{u.empresas.length > 1 ? `${u.nome} perde o acesso às ${u.empresas.length} empresas.` : `${u.nome} perde o acesso.`} Continua na auditoria.</span>
                <button type="button" className={`${css.btnSec} ${css.perigo}`} disabled={salvando} onClick={() => acao(() => api.patch(`${base}/${u.id}/ativo`, { ativo: false }),
                  () => ({ texto: `${u.nome} desativado(a). Sai do sistema na próxima renovação de sessão (minutos).` }))}>Desativar</button>
                <button type="button" className={css.lk} onClick={() => setConfirmar(null)}>manter</button>
              </div>
            ) : (
              <button type="button" className={css.acaoLinha} onClick={() => setConfirmar('DESATIVAR')}>
                <span aria-hidden="true">⏸</span><span><b className={css.perigo}>Desativar acesso</b><small>Não apaga: continua na auditoria com o nome.</small></span>
              </button>
            ))}
          </div>
        )}

        {erro && <p className={css.erro} role="alert">{erro}</p>}
        <div className={css.rodape}>
          <button type="button" className={css.btnSec} onClick={onFechar}>Cancelar</button>
          <button type="submit" className={css.btnPri} disabled={salvando}>{salvando ? 'Salvando…' : u ? 'Salvar' : 'Criar usuário'}</button>
        </div>
      </form>
    </Modal>
  );
}
