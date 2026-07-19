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

interface RespCriar { tenant: Tenant; admin: { email: string } }

function ModalNovoCliente({ onFechar, onCriado }: { onFechar: () => void; onCriado: () => void }) {
  const [razaoSocial, setRazao] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [localPrestacao, setLocal] = useState('');
  const [fuso, setFuso] = useState('-0300');
  const [adminEmail, setEmail] = useState('');
  const [adminSenha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [criado, setCriado] = useState<RespCriar | null>(null);

  async function salvar() {
    setErro(null); setEnviando(true);
    try {
      const r = await api.post<RespCriar>('/tenants', {
        razaoSocial: razaoSocial.trim(), cnpj: soDigitos(cnpj),
        localPrestacao: localPrestacao.trim() || undefined, fuso,
        adminEmail: adminEmail.trim(), adminSenha,
      });
      setCriado(r);
    } catch (e) { setErro((e as Error).message); setEnviando(false); }
  }

  if (criado) {
    return (
      <Modal titulo="Cliente criado" onFechar={onCriado}>
        <p className={css.sucesso}>● {criado.tenant.razaoSocial} está no ar, com REP-P e acesso de admin.</p>
        <div className={css.entrega}>
          <span className={css.eLbl}>Entregue este acesso ao cliente</span>
          <div className={css.eEmail}>{criado.admin.email}</div>
          <p className={css.eNota}>A senha é a provisória que você definiu. No primeiro login, o cliente é obrigado a trocá-la.</p>
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
      <div className={css.divider}>Acesso do administrador</div>
      <Campo rotulo="E-mail do admin" type="email" value={adminEmail} onChange={(e) => setEmail(e.target.value)} placeholder="admin@empresa.com.br" />
      <Campo rotulo="Senha provisória" type="password" value={adminSenha} onChange={(e) => setSenha(e.target.value)} placeholder="mínimo 8 caracteres" />
      {erro && <p className={css.erro}>{erro}</p>}
      <Botao variante="coral" onClick={salvar} disabled={enviando || !razaoSocial || soDigitos(cnpj).length !== 14 || !adminEmail || adminSenha.length < 8}>
        {enviando ? 'Criando…' : 'Criar cliente'}
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
