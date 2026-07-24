import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { soDigitos } from '../lib/download';
import type { Tenant } from '../tipos';
import { Botao } from '../components/Botao';
import { Campo } from '../components/Campo';
import { Modal } from '../components/Modal';
import css from './Clientes.module.css';

const fmtCnpj = (c: string) => c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
const fmtData = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');

/** Fusos do Brasil (offset fixo — sem horário de verão desde 2019). */
const FUSOS: { valor: string; rotulo: string }[] = [
  { valor: '-0200', rotulo: 'Fernando de Noronha (−02)' },
  { valor: '-0300', rotulo: 'Brasília (−03)' },
  { valor: '-0400', rotulo: 'Manaus / Cuiabá (−04)' },
  { valor: '-0500', rotulo: 'Rio Branco (−05)' },
];
const rotuloFuso = (f?: string) => FUSOS.find((x) => x.valor === (f ?? '-0300'))?.rotulo ?? (f ?? '−03');

export function Clientes() {
  const [lista, setLista] = useState<Tenant[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [addAberto, setAddAberto] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [editarFuso, setEditarFuso] = useState<Tenant | null>(null);

  async function carregar() {
    try { setLista(await api.get<Tenant[]>('/tenants')); }
    catch (e) { setErro((e as Error).message); }
  }
  useEffect(() => { void carregar(); }, []);

  async function alternarAtivo(t: Tenant) {
    setMenu(null);
    await api.patch(`/tenants/${t.id}/ativo`, { ativo: !t.ativo }).catch(() => {});
    void carregar();
  }

  const ativos = lista?.filter((t) => t.ativo).length ?? 0;

  return (
    <div onClick={() => setMenu(null)}>
      <div className={css.head}>
        <div><h2>Clientes</h2><p>Empresas usando o PontoSnap</p></div>
        <Botao variante="coral" className={css.add} onClick={() => setAddAberto(true)}>+ Novo cliente</Botao>
      </div>

      <div className={css.stats}>
        <div className={css.stat}><div className={css.k}>Clientes ativos</div><div className={css.v}>{lista ? ativos : '—'}</div></div>
        <div className={css.stat}><div className={css.k}>Total cadastrados</div><div className={css.v}>{lista?.length ?? '—'}</div></div>
      </div>

      {erro && <p className={css.erro}>{erro}</p>}

      <div className={css.table}>
        <div className={`${css.row} ${css.thead}`}>
          <span>Razão social</span><span>CNPJ</span><span>Local</span><span>Fuso</span><span>Status</span><span>Criado</span><span></span>
        </div>
        {lista?.length === 0 && <div className={css.vazio}>Nenhum cliente ainda. Cadastre o primeiro.</div>}
        {lista?.map((t) => (
          <div key={t.id} className={css.row}>
            <span className={css.rz}>{t.razaoSocial}</span>
            <span className={css.mono}>{fmtCnpj(t.cnpj)}</span>
            <span className={css.muted}>{t.localPrestacao ?? '—'}</span>
            <span className={css.fusoCol}>{rotuloFuso(t.fuso)}</span>
            <span className={`${css.status} ${t.ativo ? css.ativo : css.inativo}`}><span className={css.sdot} />{t.ativo ? 'Ativo' : 'Inativo'}</span>
            <span className={css.mono}>{fmtData(t.criadoEm)}</span>
            <span className={css.kebabWrap} onClick={(e) => { e.stopPropagation(); setMenu(menu === t.id ? null : t.id); }}>
              <button className={css.kebab} aria-label="Ações">⋯</button>
              {menu === t.id && (
                <div className={css.menu} onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => { setMenu(null); setEditarFuso(t); }}>Fuso horário</button>
                  <button onClick={() => void alternarAtivo(t)}>{t.ativo ? 'Inativar' : 'Reativar'}</button>
                </div>
              )}
            </span>
          </div>
        ))}
      </div>

      {addAberto && <ModalNovoCliente onFechar={() => setAddAberto(false)} onCriado={() => { setAddAberto(false); void carregar(); }} />}
      {editarFuso && <ModalFuso tenant={editarFuso} onFechar={() => setEditarFuso(null)} onSalvo={() => { setEditarFuso(null); void carregar(); }} />}
    </div>
  );
}

interface RespCriar { tenant: Tenant; admin: { email: string }; senhaProvisoria: string | null; emailEnviado: boolean }

function ModalNovoCliente({ onFechar, onCriado }: { onFechar: () => void; onCriado: () => void }) {
  const [razaoSocial, setRazao] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [localPrestacao, setLocal] = useState('');
  const [fuso, setFuso] = useState('-0300');
  const [adminEmail, setEmail] = useState('');
  const [adminNome, setNome] = useState('');
  const [caminho, setCaminho] = useState<'NOVO' | 'EXISTENTE'>('NOVO');
  const [contas, setContas] = useState<{ id: string; email: string; perfil: string }[]>([]);
  const [usuarioExistenteId, setUsuarioExistente] = useState('');
  const [perfilNaEmpresa, setPerfilNaEmpresa] = useState<'RH' | 'ADMIN_CLIENTE'>('RH');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [criado, setCriado] = useState<RespCriar | null>(null);

  // Contas de administração já existentes — para o caminho "outra empresa do mesmo cliente".
  useEffect(() => {
    api.get<{ id: string; email: string; perfil: string }[]>('/tenants/acessos/lista')
      .then(setContas).catch(() => {});
  }, []);

  async function salvar() {
    setErro(null); setEnviando(true);
    try {
      const base = {
        razaoSocial: razaoSocial.trim(), cnpj: soDigitos(cnpj),
        localPrestacao: localPrestacao.trim() || undefined, fuso,
      };
      const r = await api.post<RespCriar>('/tenants', caminho === 'NOVO'
        ? { ...base, adminEmail: adminEmail.trim(), adminNome: adminNome.trim() || undefined }
        : { ...base, usuarioExistenteId, perfilNaEmpresa });
      setCriado(r);
    } catch (e) { setErro((e as Error).message); setEnviando(false); }
  }

  if (criado) {
    return (
      <Modal titulo="Cliente criado" onFechar={onCriado}>
        <p className={css.sucesso}>● {criado.tenant.razaoSocial} está no ar, com REP-P configurado.</p>
        <div className={css.entrega}>
          {criado.senhaProvisoria ? (
            <>
              <span className={css.eLbl}>
                {criado.emailEnviado ? 'E-mail de boas-vindas enviado para' : 'Não consegui enviar o e-mail — entregue estes dados'}
              </span>
              <div className={css.eEmail}>{criado.admin.email}</div>
              <span className={css.eLbl} style={{ marginTop: 12 }}>Senha provisória</span>
              <div className={css.eSenha}>{criado.senhaProvisoria}</div>
              <p className={css.eNota}>No primeiro login o cliente é obrigado a trocá-la. Guarde caso precise repassar por outro canal.</p>
            </>
          ) : (
            <>
              <span className={css.eLbl}>Empresa vinculada ao acesso</span>
              <div className={css.eEmail}>{criado.admin.email}</div>
              <p className={css.eNota}>Sem senha nova e sem e-mail: a empresa já aparece no seletor dele no próximo acesso.</p>
            </>
          )}
        </div>
        <Botao variante="coral" onClick={onCriado}>Concluir</Botao>
      </Modal>
    );
  }

  return (
    <Modal titulo="Novo cliente" onFechar={onFechar}>
      <Campo rotulo="Razão social" value={razaoSocial} onChange={(e) => setRazao(e.target.value)} placeholder="Autopeças Bahia ME" />
      <Campo rotulo="CNPJ" inputMode="numeric" value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" />
      <Campo rotulo="Local de prestação" value={localPrestacao} onChange={(e) => setLocal(e.target.value)} placeholder="Feira de Santana/BA" />
      <label className={css.selWrap}>
        <span className={css.selLb}>Fuso horário</span>
        <select className={css.select} value={fuso} onChange={(e) => setFuso(e.target.value)}>
          {FUSOS.map((f) => <option key={f.valor} value={f.valor}>{f.rotulo}</option>)}
        </select>
      </label>
      <p className={css.fusoNota}>Rege apuração, arquivos fiscais e espelhos. Cada batida grava o fuso do momento — defina certo antes das primeiras marcações.</p>
      <div className={css.divider}>Quem vai administrar</div>
      <div className={css.caminhos}>
        <button className={`${css.cam} ${caminho === 'NOVO' ? css.camOn : ''}`} onClick={() => setCaminho('NOVO')}>
          <span className={css.camT}>Cliente novo</span>
          <span className={css.camD}>Cria o acesso e manda o e-mail de boas-vindas.</span>
        </button>
        <button className={`${css.cam} ${caminho === 'EXISTENTE' ? css.camOn : ''}`} onClick={() => setCaminho('EXISTENTE')}>
          <span className={css.camT}>Outra empresa de um cliente meu</span>
          <span className={css.camD}>Mesmo acesso administrando mais um CNPJ.</span>
        </button>
      </div>

      {caminho === 'NOVO' ? (
        <>
          <Campo rotulo="Nome do responsável" value={adminNome} onChange={(e) => setNome(e.target.value)} placeholder="Marina Souza" />
          <Campo rotulo="E-mail do responsável" type="email" value={adminEmail} onChange={(e) => setEmail(e.target.value)} placeholder="admin@empresa.com.br" />
          <p className={css.fusoNota}>A senha provisória é gerada pelo sistema e enviada por e-mail junto com o link. Ela também aparece aqui depois de criar.</p>
        </>
      ) : (
        <>
          <label className={css.selWrap}>
            <span className={css.selLb}>Acesso que vai administrar</span>
            <select className={css.select} value={usuarioExistenteId} onChange={(e) => setUsuarioExistente(e.target.value)}>
              <option value="">— escolher acesso —</option>
              {contas.map((c) => <option key={c.id} value={c.id}>{c.email} · {c.perfil === 'ADMIN_CLIENTE' ? 'Admin' : 'RH'}</option>)}
            </select>
          </label>
          <label className={css.selWrap}>
            <span className={css.selLb}>Papel dele nesta empresa</span>
            <select className={css.select} value={perfilNaEmpresa} onChange={(e) => setPerfilNaEmpresa(e.target.value as 'RH' | 'ADMIN_CLIENTE')}>
              <option value="RH">RH</option>
              <option value="ADMIN_CLIENTE">Admin</option>
            </select>
          </label>
          <p className={css.fusoNota}>Sem e-mail novo e sem senha nova: esta empresa passa a aparecer no seletor de empresas dele.</p>
        </>
      )}

      {erro && <p className={css.erro}>{erro}</p>}
      <Botao variante="coral" onClick={salvar}
        disabled={enviando || !razaoSocial || soDigitos(cnpj).length !== 14 ||
          (caminho === 'NOVO' ? !adminEmail : !usuarioExistenteId)}>
        {enviando ? 'Criando…' : 'Cadastrar empresa'}
      </Botao>
    </Modal>
  );
}

function ModalFuso({ tenant, onFechar, onSalvo }: { tenant: Tenant; onFechar: () => void; onSalvo: () => void }) {
  const [fuso, setFuso] = useState(tenant.fuso ?? '-0300');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function salvar() {
    setErro(null); setEnviando(true);
    try {
      await api.patch(`/tenants/${tenant.id}/fuso`, { fuso });
      onSalvo();
    } catch (e) { setErro((e as Error).message); setEnviando(false); }
  }

  return (
    <Modal titulo="Fuso horário" onFechar={onFechar}>
      <p className={css.fusoNota} style={{ margin: '0 0 16px' }}>{tenant.razaoSocial}</p>
      <label className={css.selWrap}>
        <span className={css.selLb}>Fuso horário</span>
        <select className={css.select} value={fuso} onChange={(e) => setFuso(e.target.value)}>
          {FUSOS.map((f) => <option key={f.valor} value={f.valor}>{f.rotulo}</option>)}
        </select>
      </label>
      <p className={css.fusoNota}>Só afeta batidas futuras. O histórico e os arquivos fiscais já gravados mantêm o fuso original de cada marcação.</p>
      {erro && <p className={css.erro}>{erro}</p>}
      <Botao variante="coral" onClick={salvar} disabled={enviando || fuso === (tenant.fuso ?? '-0300')}>
        {enviando ? 'Salvando…' : 'Salvar fuso'}
      </Botao>
    </Modal>
  );
}
