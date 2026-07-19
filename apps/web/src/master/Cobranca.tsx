import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { Tenant, PainelCobranca, Plano, Cobranca, Assinatura } from '../tipos';
import css from './Cobranca.module.css';

const brl = (v: number | string) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const compAtual = () => new Date().toISOString().slice(0, 7);

export function Cobranca() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [painel, setPainel] = useState<PainelCobranca | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [configPara, setConfigPara] = useState<Tenant | null>(null);
  const [planosAberto, setPlanosAberto] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [ts, p] = await Promise.all([
        api.get<Tenant[]>('/tenants'),
        api.get<PainelCobranca>('/cobranca/painel'),
      ]);
      setTenants(ts); setPainel(p);
    } catch (e) { setErro((e as Error).message); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  // Junta cada empresa com sua assinatura e a cobrança em aberto mais recente.
  const linhas = useMemo(() => {
    if (!painel) return [];
    const assPorTenant = new Map(painel.assinaturas.map((a) => [a.tenantId, a]));
    const cobPorTenant = new Map<string, Cobranca>();
    for (const c of painel.cobrancas) {
      const atual = cobPorTenant.get(c.tenantId);
      if (!atual || c.competencia > atual.competencia) cobPorTenant.set(c.tenantId, c);
    }
    return tenants.map((t) => ({
      tenant: t,
      assinatura: assPorTenant.get(t.id) ?? null,
      ultima: cobPorTenant.get(t.id) ?? null,
    }));
  }, [painel, tenants]);

  const receita = useMemo(() =>
    linhas.reduce((s, l) => s + (l.ultima && l.ultima.status !== 'CANCELADA' ? l.ultima.valor : 0), 0),
  [linhas]);
  const emDia = linhas.filter((l) => l.ultima?.status === 'PAGA').length;
  const atrasadas = linhas.filter((l) => l.ultima && l.ultima.status !== 'PAGA' && atrasou(l.ultima)).length;

  async function gerar(tenantId: string) {
    try { await api.post(`/cobranca/tenants/${tenantId}/cobranca`, { competencia: compAtual() }); void carregar(); }
    catch (e) { setErro((e as Error).message); }
  }
  async function marcarPaga(id: string) {
    try { await api.patch(`/cobranca/${id}/pagar`); void carregar(); }
    catch (e) { setErro((e as Error).message); }
  }

  return (
    <div className={css.tela}>
      <div className={css.cab}>
        <div>
          <h2>Cobrança</h2>
          <p>Planos, mensalidades e situação de cada empresa.</p>
        </div>
        <button className={css.btnPlanos} onClick={() => setPlanosAberto(true)}>Gerenciar planos</button>
      </div>

      {erro && <p className={css.erro}>{erro}</p>}

      <div className={css.resumo}>
        <div className={`${css.card} ${css.receita}`}><div className={css.n}>{brl(receita)}</div><div className={css.l}>Receita do mês</div></div>
        <div className={css.card}><div className={css.n}>{emDia}</div><div className={css.l}>Empresas em dia</div></div>
        <div className={`${css.card} ${css.atraso}`}><div className={css.n}>{atrasadas}</div><div className={css.l}>Em atraso</div></div>
      </div>

      <div className={css.tabela}>
        <div className={`${css.linha} ${css.thead}`}>
          <span>Empresa</span><span>Plano</span><span>Mensalidade</span><span>Situação</span><span>Ações</span>
        </div>
        {linhas.map(({ tenant, assinatura, ultima }) => (
          <div key={tenant.id} className={css.linha}>
            <div className={css.emp}>
              {tenant.razaoSocial}
              <span className={css.cnpj}>{fmtCnpj(tenant.cnpj)}</span>
            </div>
            <div className={css.plano}>{rotuloPlano(assinatura, painel?.planos ?? [])}</div>
            <div className={css.valor}>{ultima ? brl(ultima.valor) : '—'}</div>
            <div>{selo(ultima)}</div>
            <div className={css.acoes}>
              <button className={css.btnGhost} onClick={() => setConfigPara(tenant)}>Configurar</button>
              {ultima && ultima.status !== 'PAGA' ? (
                <button className={css.btnCoral} onClick={() => void marcarPaga(ultima.id)}>Marcar pago</button>
              ) : (
                <button className={css.btnCoral} onClick={() => void gerar(tenant.id)} disabled={!assinatura}>Gerar cobrança</button>
              )}
            </div>
          </div>
        ))}
        {linhas.length === 0 && <div className={css.vazio}>Nenhuma empresa cadastrada.</div>}
      </div>

      {configPara && painel && (
        <ModalAssinatura
          tenant={configPara}
          planos={painel.planos}
          assinatura={painel.assinaturas.find((a) => a.tenantId === configPara.id) ?? null}
          onFechar={() => setConfigPara(null)}
          onSalvo={() => { setConfigPara(null); void carregar(); }}
        />
      )}
      {planosAberto && painel && (
        <ModalPlanos planos={painel.planos} onFechar={() => setPlanosAberto(false)} onMudou={() => void carregar()} />
      )}
    </div>
  );
}

function atrasou(c: Cobranca): boolean {
  if (c.status === 'PAGA' || c.status === 'CANCELADA') return false;
  return new Date() > new Date(`${c.vencimento}T23:59:59-0300`);
}

function selo(c: Cobranca | null) {
  if (!c) return <span className={`${css.pill} ${css.pillNeutro}`}>Sem cobrança</span>;
  if (c.status === 'PAGA') return <span className={`${css.pill} ${css.pillDia}`}>Pago</span>;
  if (atrasou(c)) {
    const dias = Math.floor((Date.now() - new Date(`${c.vencimento}T23:59:59-0300`).getTime()) / 86400000);
    return (
      <span className={`${css.pill} ${css.pillAtraso}`}>
        {dias} dia{dias !== 1 ? 's' : ''} atraso{c.avisoPagamentoEm ? ' · avisou pgto' : ''}
      </span>
    );
  }
  return <span className={`${css.pill} ${css.pillAberta}`}>Em aberto{c.avisoPagamentoEm ? ' · avisou pgto' : ''}</span>;
}

function rotuloPlano(a: Assinatura | null, planos: Plano[]): string {
  if (!a) return 'Sem assinatura';
  const p = planos.find((x) => x.id === a.planoId);
  const modo = a.modoOverride ?? p?.modo;
  const base = p?.nome ?? 'Avulso';
  if (a.valorOverride != null) return `${base} (ajustado)`;
  return modo === 'POR_FUNCIONARIO' ? `${base} · por func.` : base;
}

function fmtCnpj(c: string): string {
  return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

// ---- Modal: configurar assinatura de uma empresa ----

function ModalAssinatura({ tenant, planos, assinatura, onFechar, onSalvo }: {
  tenant: Tenant; planos: Plano[]; assinatura: Assinatura | null;
  onFechar: () => void; onSalvo: () => void;
}) {
  const [planoId, setPlanoId] = useState(assinatura?.planoId ?? '');
  const [usarOverride, setUsarOverride] = useState(assinatura?.valorOverride != null);
  const [modoOverride, setModoOverride] = useState<'FIXO' | 'POR_FUNCIONARIO'>(assinatura?.modoOverride ?? 'FIXO');
  const [valorOverride, setValorOverride] = useState(assinatura?.valorOverride ?? '');
  const [diaVencimento, setDiaVencimento] = useState(String(assinatura?.diaVencimento ?? 10));
  const [situacao, setSituacao] = useState(assinatura?.situacao ?? 'ativa');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setErro(null); setSalvando(true);
    try {
      await api.post(`/cobranca/tenants/${tenant.id}/assinatura`, {
        planoId: planoId || null,
        modoOverride: usarOverride ? modoOverride : null,
        valorOverride: usarOverride ? Number(valorOverride.replace(',', '.')) : null,
        diaVencimento: Number(diaVencimento),
        situacao,
      });
      onSalvo();
    } catch (e) { setErro((e as Error).message); } finally { setSalvando(false); }
  }

  return (
    <div className={css.overlay} onClick={onFechar}>
      <div className={css.modal} onClick={(e) => e.stopPropagation()}>
        <h3>Assinatura · {tenant.razaoSocial}</h3>
        <p className={css.modalSub}>Escolha um plano do catálogo ou ajuste o valor só desta empresa.</p>

        <label className={css.campo}>
          <span>Plano do catálogo</span>
          <select value={planoId} onChange={(e) => setPlanoId(e.target.value)}>
            <option value="">Nenhum (valor avulso)</option>
            {planos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome} — {p.modo === 'FIXO' ? brl(p.valor) : `${brl(p.valor)}/func`}
              </option>
            ))}
          </select>
        </label>

        <label className={css.check}>
          <input type="checkbox" checked={usarOverride} onChange={(e) => setUsarOverride(e.target.checked)} />
          Ajustar valor só para esta empresa
        </label>

        {usarOverride && (
          <div className={css.overrideBox}>
            <label className={css.campo}>
              <span>Modo</span>
              <select value={modoOverride} onChange={(e) => setModoOverride(e.target.value as 'FIXO' | 'POR_FUNCIONARIO')}>
                <option value="FIXO">Valor fixo</option>
                <option value="POR_FUNCIONARIO">Por funcionário ativo</option>
              </select>
            </label>
            <label className={css.campo}>
              <span>{modoOverride === 'FIXO' ? 'Mensalidade (R$)' : 'Valor por funcionário (R$)'}</span>
              <input type="text" inputMode="decimal" value={valorOverride}
                onChange={(e) => setValorOverride(e.target.value)} placeholder="0,00" />
            </label>
          </div>
        )}

        <div className={css.doisCampos}>
          <label className={css.campo}>
            <span>Dia do vencimento</span>
            <input type="number" min={1} max={28} value={diaVencimento}
              onChange={(e) => setDiaVencimento(e.target.value)} />
          </label>
          <label className={css.campo}>
            <span>Situação</span>
            <select value={situacao} onChange={(e) => setSituacao(e.target.value)}>
              <option value="ativa">Ativa</option>
              <option value="suspensa">Suspensa</option>
              <option value="cancelada">Cancelada</option>
            </select>
          </label>
        </div>

        {erro && <p className={css.erro}>{erro}</p>}
        <div className={css.modalAcoes}>
          <button className={css.btnGhost} onClick={onFechar}>Cancelar</button>
          <button className={css.btnCoral} onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar assinatura'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Modal: gerenciar catálogo de planos ----

function ModalPlanos({ planos, onFechar, onMudou }: {
  planos: Plano[]; onFechar: () => void; onMudou: () => void;
}) {
  const [nome, setNome] = useState('');
  const [modo, setModo] = useState<'FIXO' | 'POR_FUNCIONARIO'>('FIXO');
  const [valor, setValor] = useState('');
  const [descricao, setDescricao] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  async function criar() {
    setErro(null);
    try {
      await api.post('/cobranca/planos', {
        nome: nome.trim(), modo, valor: Number(valor.replace(',', '.')), descricao: descricao.trim() || undefined,
      });
      setNome(''); setValor(''); setDescricao('');
      onMudou();
    } catch (e) { setErro((e as Error).message); }
  }
  async function arquivar(id: string) {
    try { await api.patch(`/cobranca/planos/${id}/arquivar`); onMudou(); }
    catch (e) { setErro((e as Error).message); }
  }

  return (
    <div className={css.overlay} onClick={onFechar}>
      <div className={css.modal} onClick={(e) => e.stopPropagation()}>
        <h3>Catálogo de planos</h3>
        <p className={css.modalSub}>Planos que você reaproveita ao configurar cada empresa.</p>

        <div className={css.listaPlanos}>
          {planos.map((p) => (
            <div key={p.id} className={css.planoItem}>
              <div>
                <strong>{p.nome}</strong>
                <span className={css.planoValor}>
                  {p.modo === 'FIXO' ? brl(p.valor) : `${brl(p.valor)} por funcionário`}
                </span>
                {p.descricao && <span className={css.planoDesc}>{p.descricao}</span>}
              </div>
              <button className={css.btnArquivar} onClick={() => void arquivar(p.id)}>Arquivar</button>
            </div>
          ))}
          {planos.length === 0 && <p className={css.vazio}>Nenhum plano ainda.</p>}
        </div>

        <div className={css.novoPlano}>
          <h4>Novo plano</h4>
          <input placeholder="Nome (ex.: Até 20 funcionários)" value={nome} onChange={(e) => setNome(e.target.value)} />
          <div className={css.doisCampos}>
            <select value={modo} onChange={(e) => setModo(e.target.value as 'FIXO' | 'POR_FUNCIONARIO')}>
              <option value="FIXO">Valor fixo</option>
              <option value="POR_FUNCIONARIO">Por funcionário</option>
            </select>
            <input placeholder="Valor R$" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
          </div>
          <input placeholder="Descrição (opcional)" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          {erro && <p className={css.erro}>{erro}</p>}
          <button className={css.btnCoral} onClick={criar} disabled={!nome || !valor}>Adicionar plano</button>
        </div>

        <div className={css.modalAcoes}>
          <button className={css.btnGhost} onClick={onFechar}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
