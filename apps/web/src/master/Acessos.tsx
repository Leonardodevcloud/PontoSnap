import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import css from './Acessos.module.css';

interface Vinculo { id: string; tenantId: string; perfil: string; razaoSocial: string; cnpj: string; }
interface Conta { id: string; email: string; perfil: string; tenantPadrao: string | null; ativo: boolean; empresas: Vinculo[]; }
interface Cliente { id: string; razaoSocial: string; cnpj: string; }

const fmtCnpj = (c: string) => c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
const papel = (p: string) => (p === 'ADMIN_CLIENTE' ? 'Admin' : 'RH');

export function Acessos() {
  const [contas, setContas] = useState<Conta[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [addPara, setAddPara] = useState<string | null>(null);
  const [tenantSel, setTenantSel] = useState('');
  const [perfilSel, setPerfilSel] = useState<'RH' | 'ADMIN_CLIENTE'>('RH');
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setContas(await api.get<Conta[]>('/tenants/acessos/lista'));
      setClientes(await api.get<Cliente[]>('/tenants'));
    } catch (e) { setErro((e as Error).message); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function vincular(usuarioId: string) {
    if (!tenantSel) { setErro('Escolha a empresa.'); return; }
    setErro(null); setSalvando(true);
    try {
      await api.post('/tenants/acessos', { usuarioId, tenantId: tenantSel, perfil: perfilSel });
      setMsg('Acesso concedido. Vale no próximo login (ou na próxima renovação de sessão).');
      setAddPara(null); setTenantSel('');
      await carregar();
    } catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }

  async function desvincular(v: Vinculo, email: string) {
    if (!confirm(`Tirar o acesso de ${email} à empresa ${v.razaoSocial}?`)) return;
    setErro(null); setMsg(null);
    try {
      await api.del(`/tenants/acessos/${v.id}`);
      setMsg('Acesso retirado — vale já na próxima renovação de sessão dele.');
      await carregar();
    } catch (e) { setErro((e as Error).message); }
  }

  return (
    <div className={css.tela}>
      <div className={css.top}>
        <div>
          <h1 className={css.h}>Acessos multi-empresa</h1>
          <p className={css.sub}>Um acesso pode administrar vários CNPJs, com papel próprio em cada um. Funcionário que bate ponto fica sempre em uma empresa só.</p>
        </div>
      </div>

      {erro && <p className={css.erro}>{erro}</p>}
      {msg && <p className={css.ok}>{msg}</p>}

      <div className={css.card}>
        {contas.length === 0 ? <p className={css.vazio}>Nenhuma conta de administração cadastrada.</p> : (
          <table className={css.tab}>
            <thead><tr><th>Acesso</th><th>Empresas que administra</th><th></th></tr></thead>
            <tbody>
              {contas.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.email}</strong>
                    <div className={css.meta}>{papel(c.perfil)}{c.ativo ? '' : ' · inativo'}</div>
                  </td>
                  <td>
                    {c.empresas.length === 0
                      ? <span className={css.semVinc}>só a empresa de origem</span>
                      : c.empresas.map((v) => (
                        <span key={v.id} className={css.chip}>
                          {v.razaoSocial} · {papel(v.perfil)}
                          <button className={css.chipX} title="Retirar acesso" onClick={() => desvincular(v, c.email)}>×</button>
                        </span>
                      ))}
                    {addPara === c.id && (
                      <div className={css.addBox}>
                        <select className={css.inp} value={tenantSel} onChange={(e) => setTenantSel(e.target.value)}>
                          <option value="">— escolher empresa —</option>
                          {clientes
                            .filter((t) => !c.empresas.some((v) => v.tenantId === t.id))
                            .map((t) => <option key={t.id} value={t.id}>{t.razaoSocial} · {fmtCnpj(t.cnpj)}</option>)}
                        </select>
                        <select className={css.inp} value={perfilSel} onChange={(e) => setPerfilSel(e.target.value as 'RH' | 'ADMIN_CLIENTE')}>
                          <option value="RH">RH</option>
                          <option value="ADMIN_CLIENTE">Admin</option>
                        </select>
                        <button className={css.btn} disabled={salvando} onClick={() => vincular(c.id)}>
                          {salvando ? 'Salvando…' : 'Conceder'}
                        </button>
                        <button className={css.link} onClick={() => { setAddPara(null); setTenantSel(''); }}>cancelar</button>
                      </div>
                    )}
                  </td>
                  <td>
                    {addPara !== c.id && (
                      <button className={css.btnG} onClick={() => { setAddPara(c.id); setErro(null); setMsg(null); }}>
                        + empresa
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className={css.nota}>
        A troca de empresa é conferida no servidor a cada vez — o navegador não escolhe sozinho em qual CNPJ está.
        Retirar um acesso vale na próxima renovação de sessão (no máximo alguns minutos).
      </p>
    </div>
  );
}
