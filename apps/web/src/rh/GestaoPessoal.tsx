import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { minutosParaHhMm } from '../lib/formato';
import { Botao } from '../components/Botao';
import type {
  BaseDias, PessoaTipo, PessoalCompetencia, PessoalLinhaClt, PessoalLinhaMei, PessoalLinhaMot, PessoalPadrao, PessoalPessoa, VtTipo,
} from '../tipos';
import vt from './VisaoTodos.module.css';
import css from './GestaoPessoal.module.css';

/**
 * Gestão de Pessoal — fechamento do mês da empresa ativa.
 * CLT vem do ponto (sem cadastro aqui); MEI e motoristas são cadastrados aqui.
 * Estado de navegação na URL: ?mes=YYYY-MM&aba=...&novo=MEI|MOTORISTA
 */

type Aba = 'folha' | 'beneficios' | 'mei' | 'motoristas' | 'debitos';
const ABAS: Aba[] = ['folha', 'beneficios', 'mei', 'motoristas', 'debitos'];

// ---------- formatação ----------
const brl = (c: number) => `${c < 0 ? '−' : ''}R$ ${(Math.abs(c) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const mesCurto = (c: string) => MESES[Number(c.slice(5, 7)) - 1] ?? c;
const mesLongo = (c: string) => `${mesCurto(c)} de ${c.slice(0, 4)}`;
const fmtDia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const mesAtual = () => { const d = new Date(Date.now() - 3 * 3600_000); return d.toISOString().slice(0, 7); };
const somarMes = (c: string, n: number) => {
  const d = new Date(Date.UTC(Number(c.slice(0, 4)), Number(c.slice(5, 7)) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
/** "1.234,56" | "1234.56" → 1234.56 */
const numeroBr = (s: string): number => {
  const t = s.trim().replace(/\s|R\$/g, '');
  if (!t) return 0;
  const n = t.includes(',') ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t);
  return Number.isFinite(n) ? n : 0;
};
const reaisTxt = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ROT_TIPO: Record<PessoaTipo, string> = { CLT: 'CLT', MEI: 'MEI', MOTORISTA: 'Motorista' };
const ROT_MOTIVO: Record<string, string> = { feriado: 'feriado', falta: 'falta', afastamento: 'férias/atestado/folga' };
/** "VR R$ 25,00/dia · VT R$ 11,80/dia" */
const resumoBen = (c: { vrDiaCent: number; cestaCent: number; vtTipo: VtTipo; vtValorCent: number }) => {
  const p: string[] = [];
  if (c.vrDiaCent) p.push(`VR ${brl(c.vrDiaCent)}/dia`);
  if (c.cestaCent) p.push(`cesta ${brl(c.cestaCent)}`);
  if (c.vtTipo === 'DIA') p.push(`VT ${brl(c.vtValorCent)}/dia`);
  if (c.vtTipo === 'FIXO') p.push(`combustível ${brl(c.vtValorCent)}/mês`);
  return p.length ? p.join(' · ') : 'sem benefício';
};
/**
 * O que veio do ponto em R$, separado por natureza: hora extra paga, hora
 * extra que foi pro banco (não é paga) e indenização de intervalo (Art. 71
 * §4º — paga sempre, não é hora extra e não vai pro banco).
 */
function textoExtras(l: PessoalLinhaClt): { valor: string | null; detalhe: string; soBanco: boolean } {
  const pagasMin = Math.max(0, l.heMin - l.heNoBancoMin);
  const partes: string[] = [];
  if (pagasMin > 0) partes.push(`${minutosParaHhMm(pagasMin)} extra paga`);
  if (l.heNoBancoMin > 0) partes.push(`${minutosParaHhMm(l.heNoBancoMin)} no banco`);
  if (l.indenizacaoCent > 0) partes.push(`intervalo ${brl(l.indenizacaoCent)}`);
  return { valor: l.proventosCent > 0 ? brl(l.proventosCent) : null, detalhe: partes.join(' · '), soBanco: l.proventosCent === 0 && l.heNoBancoMin > 0 };
}

/** Mesma conta do servidor (calcularMei), pra prévia ao vivo no painel. */
function previaMei(valorCent: number, diasMes: number, l: { heMin: number; faltas: number; feriadosTrab: number; metaCent: number; metaPaga: boolean }, debitosCent: number) {
  const dias = Math.max(1, diasMes);
  const vd = valorCent / dias, vh = valorCent / (dias * 8);
  const heCent = Math.round((l.heMin / 60) * vh * 1.5);
  const feriadosCent = Math.round(l.feriadosTrab * vd);
  const faltasCent = Math.round(l.faltas * vd);
  const brutoCent = valorCent + heCent + feriadosCent - faltasCent + l.metaCent;
  const abat = debitosCent + (l.metaPaga ? l.metaCent : 0);
  return { heCent, feriadosCent, faltasCent, brutoCent, abat, liquidoCent: brutoCent - abat };
}

type Painel = { tipo: 'clt' | 'mei' | 'mot'; id: string } | { tipo: 'debito' } | { tipo: 'padrao' } | null;
type Dialogo =
  | { tipo: 'tirar'; pessoaTipo: PessoaTipo; pessoaId: string; nome: string }
  | { tipo: 'fechar' }
  | { tipo: 'remDebito'; id: string; descricao: string; nome: string }
  | null;
type Toast = { msg: string; desfazer?: () => Promise<void> } | null;

export function GestaoPessoal() {
  const { sessao } = useAuth();
  const [params, setParams] = useSearchParams();
  const mes = params.get('mes') ?? mesAtual();
  const abaParam = params.get('aba') as Aba | null;
  const aba: Aba = abaParam && ABAS.includes(abaParam) ? abaParam : 'folha';
  const novo = params.get('novo') as 'MEI' | 'MOTORISTA' | null;
  const ir = useCallback((p: { mes?: string; aba?: Aba; novo?: string | null }) => {
    setParams((at) => {
      const n = new URLSearchParams(at);
      if (p.mes) n.set('mes', p.mes);
      if (p.aba) n.set('aba', p.aba);
      if (p.novo !== undefined) { if (p.novo) n.set('novo', p.novo); else n.delete('novo'); }
      return n;
    });
  }, [setParams]);

  const [dados, setDados] = useState<PessoalCompetencia | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [painel, setPainel] = useState<Painel>(null);
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [busca, setBusca] = useState('');
  const gatilho = useRef<HTMLElement | null>(null);

  const recarregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    try { setDados(await api.get<PessoalCompetencia>(`/pessoal/competencia?comp=${mes}`)); }
    catch (e) { setErro((e as Error).message); setDados(null); }
    finally { setCarregando(false); }
  }, [mes]);
  useEffect(() => { void recarregar(); }, [recarregar, sessao?.tenantId]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); }, [toast]);

  const abrir = (p: Painel, el?: HTMLElement | null) => { gatilho.current = el ?? (document.activeElement as HTMLElement); setPainel(p); };
  const fecharPainel = () => { setPainel(null); setTimeout(() => gatilho.current?.focus?.(), 0); };
  const avisar = (msg: string, desfazer?: () => Promise<void>) => setToast({ msg, desfazer });

  if (novo === 'MEI' || novo === 'MOTORISTA') {
    return <FormPrestador tipoInicial={novo} mes={mes} onVoltar={() => ir({ novo: null })}
      onCriado={(nome, tipo) => { ir({ novo: null, aba: tipo === 'MEI' ? 'mei' : 'motoristas' }); avisar(`${nome} adicionado a partir de ${mesCurto(mes)}.`); void recarregar(); }} />;
  }

  const d = dados;
  const fechado = !!d?.fechado;
  const filtra = <T extends { nome: string }>(l: T[]) => (busca ? l.filter((x) => x.nome.toLowerCase().includes(busca.toLowerCase())) : l);
  const nfPend = (d?.pendencias.nfMei ?? 0) + (d?.pendencias.nfMotorista ?? 0);
  const semBeneficio = d?.clt.filter((c) => c.config.origem === 'NENHUM' || (c.config.vrDiaCent === 0 && c.config.vtTipo === 'NENHUM')).length ?? 0;
  const folhaPend = (d?.pendencias.semPonto ?? 0) + (d?.pendencias.semSalario ?? 0);

  const passos: { aba: Aba | null; titulo: string; status: 'ok' | 'aviso' | 'todo'; texto: string }[] = [
    { aba: 'folha', titulo: 'Conferir folha', status: folhaPend ? 'aviso' : 'ok',
      texto: folhaPend ? `${folhaPend} sem salário ou sem escala` : 'Extras e faltas puxados do ponto' },
    { aba: 'beneficios', titulo: 'Gerar benefícios', status: semBeneficio ? 'aviso' : 'ok',
      texto: semBeneficio ? (d?.padrao ? `${semBeneficio} sem VR/VT` : 'Defina o padrão da empresa') : `Carga de ${d ? mesCurto(d.proxima) : '…'} com acerto` },
    { aba: 'mei', titulo: 'Prestadores', status: nfPend ? 'aviso' : 'ok',
      texto: nfPend ? (nfPend === 1 ? '1 nota fiscal pendente' : `${nfPend} notas fiscais pendentes`) : 'Notas fiscais em dia' },
    { aba: null, titulo: 'Fechar mês', status: fechado ? 'ok' : 'todo', texto: fechado ? 'Fechado — só leitura' : `Congela ${mesCurto(mes)}` },
  ];

  async function tirar(escopo: 'MES' | 'DIANTE') {
    if (dialogo?.tipo !== 'tirar') return;
    const { pessoaTipo, pessoaId, nome } = dialogo;
    try {
      const r = await api.post<{ id: string }>('/pessoal/exclusoes', { pessoaTipo, pessoaId, competencia: mes, escopo });
      setDialogo(null); setPainel(null);
      avisar(escopo === 'MES' ? `${nome} saiu de ${mesCurto(mes)}. Volta em ${mesCurto(somarMes(mes, 1))}.` : `${nome} saiu de ${mesCurto(mes)} em diante. O histórico continua.`,
        async () => { await api.del(`/pessoal/exclusoes/${r.id}`); await recarregar(); });
      await recarregar();
    } catch (e) { setDialogo(null); setErro((e as Error).message); }
  }
  async function fecharMes() {
    try { await api.post('/pessoal/fechar', { competencia: mes }); setDialogo(null); avisar(`${mesLongo(mes)} fechado.`); await recarregar(); }
    catch (e) { setDialogo(null); setErro((e as Error).message); }
  }
  async function reabrir() {
    try { await api.post('/pessoal/reabrir', { competencia: mes }); avisar(`${mesLongo(mes)} reaberto para edição.`); await recarregar(); }
    catch (e) { setErro((e as Error).message); }
  }
  async function removerDebito() {
    if (dialogo?.tipo !== 'remDebito') return;
    try { await api.del(`/pessoal/debitos/${dialogo.id}`); setDialogo(null); avisar(`Débito "${dialogo.descricao}" removido.`); await recarregar(); }
    catch (e) { setDialogo(null); setErro((e as Error).message); }
  }

  const linhaClt = painel?.tipo === 'clt' ? d?.clt.find((c) => c.empregadoId === painel.id) : undefined;
  const linhaMei = painel?.tipo === 'mei' ? d?.mei.find((m) => m.id === painel.id) : undefined;
  const linhaMot = painel?.tipo === 'mot' ? d?.motoristas.find((m) => m.id === painel.id) : undefined;

  return (
    <div className={css.pagina}>
      <div className={css.head}>
        <div>
          <span className={css.lb}>Gestão de pessoal</span>
          <h2>Fechamento de {mesCurto(mes)}</h2>
          <p>Folha, benefícios e prestadores da empresa. Horas extras e faltas dos CLT vêm direto do ponto.</p>
        </div>
        <div className={css.acoes}>
          {!fechado && <Botao variante="ghost" className={css.btnSec} onClick={() => ir({ novo: aba === 'motoristas' ? 'MOTORISTA' : 'MEI' })}>Adicionar MEI ou motorista</Botao>}
          {fechado
            ? (sessao?.perfil === 'ADMIN_CLIENTE' && <Botao variante="ghost" className={css.btnSec} onClick={reabrir}>Reabrir {mesCurto(mes)}</Botao>)
            : <Botao variante="coral" className={css.btnPri} disabled={!d} onClick={() => setDialogo({ tipo: 'fechar' })}>Fechar {mesCurto(mes)}</Botao>}
        </div>
      </div>

      <div className={css.controles}>
        <div className={css.sel}>
          <span className={css.lb}>Competência</span>
          <div className={css.comp}>
            <button aria-label="Mês anterior" onClick={() => ir({ mes: somarMes(mes, -1) })}>‹</button>
            <input type="month" aria-label="Competência" value={mes} onChange={(e) => e.target.value && ir({ mes: e.target.value })} />
            <button aria-label="Próximo mês" onClick={() => ir({ mes: somarMes(mes, 1) })} disabled={mes >= somarMes(mesAtual(), 1)}>›</button>
          </div>
        </div>
      </div>

      {fechado && d && (
        <div className={css.fechadoBar} role="status">
          <b>{mesLongo(mes)} está fechado</b> desde {new Date(d.fechadoEm!).toLocaleDateString('pt-BR')}. Os números abaixo são o retrato do fechamento e não mudam mais.
        </div>
      )}
      {erro && <p className={css.erro} role="alert">{erro}</p>}

      <nav className={css.trilha} aria-label="Trilha de fechamento">
        {passos.map((p, i) => (
          <button key={p.titulo} className={`${css.passo} ${p.aba === aba || (p.aba === 'mei' && aba === 'motoristas') ? css.passoAtual : ''}`}
            aria-current={p.aba === aba ? 'step' : undefined}
            onClick={() => (p.aba ? ir({ aba: p.aba }) : !fechado && d && setDialogo({ tipo: 'fechar' }))}>
            <span className={`${css.bola} ${p.status === 'ok' ? css.bolaOk : p.status === 'aviso' ? css.bolaAviso : ''}`}>{p.status === 'ok' ? '✓' : i + 1}</span>
            <span><b>{p.titulo}</b><span>{p.texto}</span></span>
          </button>
        ))}
      </nav>

      {d && (
        <div className={`${vt.kpis} ${css.kpis}`}>
          <div className={vt.kpi}><div className={vt.kpiK}>Pessoas no mês</div><div className={vt.kpiV}>{d.totais.pessoas.clt + d.totais.pessoas.mei + d.totais.pessoas.motoristas}</div>
            <div className={vt.kpiS}>{d.totais.pessoas.clt} CLT · {d.totais.pessoas.mei} MEI · {d.totais.pessoas.motoristas} motoristas</div></div>
          <div className={`${vt.kpi} ${vt.kpiInk}`} title="Salário − faltas + extras + benefícios do mês (CLT), valor das notas (MEI e motoristas). Débitos, acertos e metas já pagas não entram: esse dinheiro já tinha saído.">
            <div className={vt.kpiK}>Custo bruto da empresa</div><div className={vt.kpiV}>{brl(d.totais.brutoCent)}</div>
            <div className={vt.kpiS}>sem tirar o que já foi pago antes</div></div>
          <div className={`${vt.kpi} ${vt.kpiPeach}`}><div className={vt.kpiK}>Abatimentos</div><div className={vt.kpiV}>{brl(d.totais.abatimentosCent)}</div>
            <div className={vt.kpiS}>débitos, acerto de benefícios e metas já pagas</div></div>
          <div className={vt.kpi}><div className={vt.kpiK}>Líquido a pagar</div><div className={vt.kpiV}>{brl(d.totais.liquidoCent)}</div>
            <div className={vt.kpiS}>o que sai do caixa neste fechamento</div></div>
        </div>
      )}

      <div className={css.abas} role="tablist" aria-label="Seções do fechamento">
        {([
          ['folha', 'Folha CLT', d?.clt.length], ['beneficios', 'Benefícios', d?.clt.length], ['mei', 'MEI', d?.mei.length],
          ['motoristas', 'Motoristas', d?.motoristas.length], ['debitos', 'Débitos', d?.debitos.length],
        ] as [Aba, string, number | undefined][]).map(([k, t, n]) => (
          <button key={k} role="tab" aria-selected={aba === k} className={`${css.aba} ${aba === k ? css.abaOn : ''}`} onClick={() => ir({ aba: k })}>
            {t} {n != null && <span className={css.cont}>{n}</span>}
            {k === 'mei' && (d?.pendencias.nfMei ?? 0) > 0 && <span className={css.contAlerta}>NF</span>}
          </button>
        ))}
      </div>

      <div className={css.barra}>
        <input className={vt.busca} type="search" placeholder="Buscar pessoa" aria-label="Buscar pessoa" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <span className={css.legenda}>
          {d && aba === 'beneficios' && `Dias de ${mesCurto(d.proxima)} já sem feriados · acerto de ${mesCurto(mes)} vem do ponto`}
          {d && aba === 'folha' && `Valor do dia = salário ÷ dias de trabalho de ${mesCurto(mes)}`}
          {d && aba === 'mei' && 'Bruto = valor da nota fiscal · Líquido = o que você paga'}
          {d && aba === 'debitos' && 'Parcelas descontadas na folha ou no pagamento'}
        </span>
        {aba === 'beneficios' && !fechado && d && <Botao variante="ghost" className={css.btnSec} onClick={(e) => abrir({ tipo: 'padrao' }, e.currentTarget)}>{d.padrao ? 'Alterar padrão da empresa' : 'Definir padrão da empresa'}</Botao>}
        {aba === 'debitos' && !fechado && <Botao variante="ghost" className={css.btnSec} onClick={(e) => abrir({ tipo: 'debito' }, e.currentTarget)}>Adicionar débito</Botao>}
      </div>

      {d && aba === 'beneficios' && (
        <div className={css.padraoBar}>
          <span className={css.lb}>Padrão da empresa</span>
          {d.padrao
            ? <span><b>{resumoBen(d.padrao)}</b> <small>desde {mesLongo(d.padrao.vigenteDesde)} · vale pra quem não tem valor próprio</small></span>
            : <span>Ainda não definido. Defina uma vez e todos os CLT sem valor próprio passam a receber.</span>}
        </div>
      )}
      {d && aba === 'beneficios' && (
        <div className={css.nota}>
          Hoje você carrega <b>{mesCurto(d.proxima)}</b>. O que foi pago para <b>{mesCurto(mes)}</b> e não foi usado (feriado, falta, férias, atestado) volta
          como <b>acerto</b> e é abatido aqui. Não precisa lançar "VT a mais" em Débitos.
          {d.clt.some((c) => c.beneficios.pagosEstimado) && <> Como {mesCurto(mes)} ainda não foi fechado no sistema, os dias pagos foram estimados pela escala.</>}
        </div>
      )}
      {d && aba === 'mei' && (
        <div className={css.nota}><b>Bruto</b> = contrato + extras + feriados trabalhados − faltas + meta. É o valor da nota fiscal. <b>Líquido</b> = bruto − débitos − meta que já foi paga antes.</div>
      )}

      {carregando && !d && <p className={css.carregando}>Calculando {mesLongo(mes)}…</p>}

      {d && aba === 'folha' && <TabelaFolha linhas={filtra(d.clt)} mes={mes} onAbrir={(id, el) => abrir({ tipo: 'clt', id }, el)} />}
      {d && aba === 'beneficios' && <TabelaBeneficios linhas={filtra(d.clt)} d={d} onAbrir={(id, el) => abrir({ tipo: 'clt', id }, el)} />}
      {d && aba === 'mei' && <TabelaMei linhas={filtra(d.mei)} onAbrir={(id, el) => abrir({ tipo: 'mei', id }, el)} onNovo={fechado ? undefined : () => ir({ novo: 'MEI' })} />}
      {d && aba === 'motoristas' && <TabelaMot linhas={filtra(d.motoristas)} onAbrir={(id, el) => abrir({ tipo: 'mot', id }, el)} onNovo={fechado ? undefined : () => ir({ novo: 'MOTORISTA' })} />}
      {d && aba === 'debitos' && <TabelaDebitos d={d} busca={busca} fechado={fechado}
        onAbrir={(tipo, id, el) => abrir({ tipo: tipo === 'CLT' ? 'clt' : tipo === 'MEI' ? 'mei' : 'mot', id }, el)}
        onRemover={(id, descricao, nome) => setDialogo({ tipo: 'remDebito', id, descricao, nome })} />}

      {d && d.foraDoMes.length > 0 && (
        <div className={css.fora}>
          <span className={css.lb}>Fora de {mesCurto(mes)}</span>
          {d.foraDoMes.map((f) => (
            <span key={f.exclusaoId} className={css.foraItem}>
              {f.nome} <small>{ROT_TIPO[f.pessoaTipo]} · {f.escopo === 'MES' ? 'só este mês' : `desde ${mesCurto(f.desde)}`}</small>
              {!fechado && f.desde === mes && (
                <button className={css.link} onClick={async () => { try { await api.del(`/pessoal/exclusoes/${f.exclusaoId}`); avisar(`${f.nome} voltou para ${mesCurto(mes)}.`); await recarregar(); } catch (e) { setErro((e as Error).message); } }}>
                  Trazer de volta
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {painel && d && (
        <PainelLateral onFechar={fecharPainel} titulo={
          linhaClt?.nome ?? linhaMei?.nome ?? linhaMot?.nome ?? (painel.tipo === 'padrao' ? 'Padrão de benefícios' : 'Adicionar débito')}
          sub={linhaClt ? `${linhaClt.config.cargo ? `${linhaClt.config.cargo} · ` : ''}CLT · ${mesLongo(mes)}` : linhaMei ? `MEI · ${linhaMei.documento ?? 'sem CNPJ'} · ${mesLongo(mes)}`
            : linhaMot ? `Motorista · ${linhaMot.funcao ?? ''} · ${mesLongo(mes)}`
            : painel.tipo === 'padrao' ? 'Vale para todos os CLT sem valor próprio' : `Desconto parcelado a partir de ${mesCurto(mes)}`}>
          {painel.tipo === 'padrao' && <PainelPadrao d={d} onSalvo={async (msg) => { await recarregar(); fecharPainel(); avisar(msg); }} />}
          {linhaClt && <PainelClt l={linhaClt} d={d} mes={mes} fechado={fechado} onSalvo={recarregar} onAviso={avisar}
            onTirar={() => setDialogo({ tipo: 'tirar', pessoaTipo: 'CLT', pessoaId: linhaClt.empregadoId, nome: linhaClt.nome })} />}
          {linhaMei && <PainelMei key={linhaMei.id} l={linhaMei} mes={mes} fechado={fechado} onContrato={async () => { await recarregar(); avisar(`Contrato de ${linhaMei.nome} atualizado.`); }} onSalvo={async () => { await recarregar(); fecharPainel(); avisar(`Lançamento de ${linhaMei.nome} salvo.`); }}
            onTirar={() => setDialogo({ tipo: 'tirar', pessoaTipo: 'MEI', pessoaId: linhaMei.id, nome: linhaMei.nome })} />}
          {linhaMot && <PainelMot key={linhaMot.id} l={linhaMot} mes={mes} fechado={fechado} onContrato={async () => { await recarregar(); avisar(`Contrato de ${linhaMot.nome} atualizado.`); }} onSalvo={async () => { await recarregar(); fecharPainel(); avisar(`Semanas de ${linhaMot.nome} salvas.`); }}
            onTirar={() => setDialogo({ tipo: 'tirar', pessoaTipo: 'MOTORISTA', pessoaId: linhaMot.id, nome: linhaMot.nome })} />}
          {painel.tipo === 'debito' && <PainelDebito mes={mes} onSalvo={async (desc) => { await recarregar(); fecharPainel(); avisar(`Débito "${desc}" adicionado.`); }} />}
        </PainelLateral>
      )}

      {dialogo?.tipo === 'tirar' && <DialogoTirar nome={dialogo.nome} mes={mes} onCancelar={() => setDialogo(null)} onConfirmar={tirar} />}
      {dialogo?.tipo === 'fechar' && d && (
        <Dialogo titulo={`Fechar ${mesLongo(mes)}?`} onCancelar={() => setDialogo(null)} confirmar={`Fechar ${mesCurto(mes)}`} onConfirmar={fecharMes}>
          <p className={css.hint}>Os números de {mesCurto(mes)} ficam congelados como estão agora, e os dias de benefício carregados para {mesCurto(d.proxima)} viram a base do acerto do mês que vem.</p>
          {(nfPend > 0 || folhaPend > 0) ? (
            <ul className={css.pendList}>
              {nfPend > 0 && <li>{nfPend === 1 ? '1 nota fiscal pendente' : `${nfPend} notas fiscais pendentes`} (MEI e motoristas)</li>}
              {d.pendencias.semSalario > 0 && <li>{d.pendencias.semSalario} CLT sem salário cadastrado</li>}
              {d.pendencias.semPonto > 0 && <li>{d.pendencias.semPonto} CLT sem escala ou REP — sem números do ponto</li>}
            </ul>
          ) : <p className={css.hint}>Nenhuma pendência.</p>}
          <p className={css.hint}>Dá pra reabrir depois, mas só o administrador consegue.</p>
        </Dialogo>
      )}
      {dialogo?.tipo === 'remDebito' && (
        <Dialogo titulo={`Remover o débito "${dialogo.descricao}" de ${dialogo.nome}?`} onCancelar={() => setDialogo(null)} confirmar="Remover débito" perigo onConfirmar={removerDebito}>
          <p className={css.hint}>Todas as parcelas que ainda não caíram em mês fechado deixam de ser descontadas.</p>
        </Dialogo>
      )}

      {toast && (
        <div className={css.toast} role="status">
          {toast.msg}
          {toast.desfazer && <button onClick={async () => { const f = toast.desfazer!; setToast(null); try { await f(); } catch (e) { setErro((e as Error).message); } }}>Desfazer</button>}
        </div>
      )}
    </div>
  );
}

// =================== tabelas ===================

function Linha({ onAbrir, children, rotulo }: { onAbrir: (el: HTMLElement) => void; children: ReactNode; rotulo: string }) {
  return (
    <tr className={vt.row} tabIndex={0} aria-label={rotulo}
      onClick={(e) => onAbrir(e.currentTarget)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAbrir(e.currentTarget); } }}>
      {children}<td className={`${vt.n} ${css.chev}`} aria-hidden="true">›</td>
    </tr>
  );
}
const Vazio = ({ cols, children }: { cols: number; children: ReactNode }) => <tr><td colSpan={cols} className={vt.vazio}>{children}</td></tr>;

function TabelaFolha({ linhas, mes, onAbrir }: { linhas: PessoalLinhaClt[]; mes: string; onAbrir: (id: string, el: HTMLElement) => void }) {
  const t = linhas.reduce((a, l) => ({ sal: a.sal + (l.salarioCent ?? 0), pr: a.pr + l.proventosCent, de: a.de + l.descontosCent, db: a.db + l.debitosCent, li: a.li + l.liquidoSalarioCent, br: a.br + l.custoBrutoCent }), { sal: 0, pr: 0, de: 0, db: 0, li: 0, br: 0 });
  return (
    <div className={vt.tab}><div className={vt.scroll}><table className={vt.table}>
      <thead><tr><th>Colaborador</th><th className={vt.n}>Salário</th><th className={vt.n} title={`Salário ÷ dias de trabalho de ${mesCurto(mes)}`}>Valor do dia</th>
        <th className={vt.n} title="Hora extra paga + indenização de intervalo. Hora extra de quem tem banco vai pro banco e não entra em R$.">Extras e intervalo</th><th className={vt.n}>Faltas e atrasos</th><th className={vt.n}>Débitos</th><th className={vt.n}>Líquido salário</th>
        <th className={vt.n} title="Salário − descontos + extras + benefícios, sem tirar débitos">Custo bruto</th><th aria-label="Abrir" /></tr></thead>
      <tbody>
        {linhas.length === 0 && <Vazio cols={9}>Nenhum funcionário ativo no ponto. Cadastre em <Link to="/rh/funcionarios">Funcionários</Link>.</Vazio>}
        {linhas.map((l) => (
          <Linha key={l.empregadoId} rotulo={`Abrir ${l.nome}`} onAbrir={(el) => onAbrir(l.empregadoId, el)}>
            <td className={vt.nome}>{l.nome}<small>{l.config.cargo ?? (l.matricula ? `#${l.matricula}` : 'CLT')}</small>
              {l.erro && <span className={`${vt.pill} ${vt.pillWarn}`} title={l.erro}>sem escala</span>}
              {l.salarioCent == null && <span className={`${vt.pill} ${vt.pillWarn}`}>sem salário</span>}</td>
            <td className={vt.n}>{l.salarioCent == null ? '—' : brl(l.salarioCent)}</td>
            <td className={vt.n}>{l.diasMes ? brl(l.valorDiaMesCent) : '—'}<small className={css.sub}>÷ {l.diasMes} dias</small></td>
            <td className={vt.n}>{(() => {
              const x = textoExtras(l);
              if (x.valor) return <><span className={vt.pos}>{x.valor}</span><small className={css.sub}>{x.detalhe}</small></>;
              if (x.soBanco) return <span className={`${vt.pill} ${vt.pillMute}`} title="Foram pro banco de horas: não são pagas nesta folha">{minutosParaHhMm(l.heNoBancoMin)} no banco</span>;
              return '—';
            })()}</td>
            <td className={vt.n}>{l.descontosCent > 0 ? <><span className={vt.neg}>{brl(-l.descontosCent)}</span><small className={css.sub}>{l.faltasDias.length ? `${l.faltasDias.length} falta${l.faltasDias.length > 1 ? 's' : ''} · ponto` : 'atrasos · ponto'}</small></> : '—'}</td>
            <td className={vt.n}>{l.debitosCent ? <span className={vt.neg}>{brl(-l.debitosCent)}</span> : '—'}</td>
            <td className={`${vt.n} ${css.forte}`}>{brl(l.liquidoSalarioCent)}</td>
            <td className={vt.n}>{brl(l.custoBrutoCent)}</td>
          </Linha>
        ))}
      </tbody>
      {linhas.length > 0 && <tfoot><tr className={vt.tot}><td>Total · {linhas.length}</td><td className={vt.n}>{brl(t.sal)}</td><td /><td className={vt.n}>{brl(t.pr)}</td>
        <td className={vt.n}>{brl(-t.de)}</td><td className={vt.n}>{brl(-t.db)}</td><td className={vt.n}>{brl(t.li)}</td><td className={vt.n}>{brl(t.br)}</td><td /></tr></tfoot>}
    </table></div></div>
  );
}

function TabelaBeneficios({ linhas, d, onAbrir }: { linhas: PessoalLinhaClt[]; d: PessoalCompetencia; onAbrir: (id: string, el: HTMLElement) => void }) {
  const t = linhas.reduce((a, l) => ({ vr: a.vr + l.beneficios.vrProxCent, vt: a.vt + l.beneficios.vtProxCent, ac: a.ac + l.beneficios.acertoCent, ca: a.ca + l.beneficios.cargaCent }), { vr: 0, vt: 0, ac: 0, ca: 0 });
  return (
    <div className={vt.tab}><div className={vt.scroll}><table className={vt.table}>
      <thead><tr><th>Colaborador</th><th className={vt.n}>Dias de {mesCurto(d.proxima)}</th><th className={vt.n}>VR / VA</th><th className={vt.n}>VT / combustível</th>
        <th className={vt.n}>Acerto de {mesCurto(d.competencia)}</th><th className={vt.n}>A carregar</th><th aria-label="Abrir" /></tr></thead>
      <tbody>
        {linhas.length === 0 && <Vazio cols={7}>Nenhum funcionário ativo no ponto.</Vazio>}
        {linhas.map((l) => {
          const b = l.beneficios, c = l.config;
          const semCfg = c.origem === 'NENHUM' || (c.vrDiaCent === 0 && c.vtTipo === 'NENHUM');
          return (
            <Linha key={l.empregadoId} rotulo={`Abrir benefícios de ${l.nome}`} onAbrir={(el) => onAbrir(l.empregadoId, el)}>
              <td className={vt.nome}>{l.nome}<small>{semCfg ? 'sem benefício' : resumoBen(c)}</small>
                {semCfg ? <span className={`${vt.pill} ${vt.pillWarn}`}>configurar</span>
                  : <span className={`${vt.pill} ${c.origem === 'PROPRIO' ? vt.pillLime : vt.pillMute}`} title={c.vigenteDesde ? `Vale desde ${mesLongo(c.vigenteDesde)}` : undefined}>{c.origem === 'PROPRIO' ? 'valor próprio' : 'padrão'}</span>}</td>
              <td className={vt.n}>{b.diasProx}</td>
              <td className={vt.n}>{b.vrProxCent ? brl(b.vrProxCent) : '—'}</td>
              <td className={vt.n}>{c.vtTipo === 'NENHUM' ? '—' : brl(b.vtProxCent)}<small className={css.sub}>{c.vtTipo === 'FIXO' ? 'combustível · fixo' : c.vtTipo === 'DIA' ? `VT ${brl(c.vtValorCent)}/dia` : ''}</small></td>
              <td className={vt.n}>{b.acertoCent ? <><span className={vt.neg}>{brl(-b.acertoCent)}</span>
                <small className={css.sub}>{b.naoUsados.length} dia{b.naoUsados.length > 1 ? 's' : ''}: {b.naoUsados.slice(0, 2).map((x) => `${ROT_MOTIVO[x.motivo]} ${fmtDia(x.data)}`).join(', ')}{b.naoUsados.length > 2 ? '…' : ''}</small></> : '—'}</td>
              <td className={`${vt.n} ${css.forte}`}>{brl(b.cargaCent)}</td>
            </Linha>
          );
        })}
      </tbody>
      {linhas.length > 0 && <tfoot><tr className={vt.tot}><td>Total · {linhas.length}</td><td /><td className={vt.n}>{brl(t.vr)}</td><td className={vt.n}>{brl(t.vt)}</td>
        <td className={vt.n}>{brl(-t.ac)}</td><td className={vt.n}>{brl(t.ca)}</td><td /></tr></tfoot>}
    </table></div></div>
  );
}

function TabelaMei({ linhas, onAbrir, onNovo }: { linhas: PessoalLinhaMei[]; onAbrir: (id: string, el: HTMLElement) => void; onNovo?: () => void }) {
  const t = linhas.reduce((a, l) => ({ c: a.c + l.valorCent, b: a.b + l.brutoCent, li: a.li + l.liquidoCent }), { c: 0, b: 0, li: 0 });
  return (
    <div className={vt.tab}><div className={vt.scroll}><table className={vt.table}>
      <thead><tr><th>Colaborador MEI</th><th className={vt.n}>Contrato</th><th className={vt.n}>Valor do dia</th><th className={vt.n}>Extras</th><th className={vt.n}>Faltas</th>
        <th className={vt.n}>Meta</th><th className={vt.n}>Bruto (NF)</th><th className={vt.n}>Débitos</th><th className={vt.n}>Líquido</th><th className={vt.n}>Nota</th><th aria-label="Abrir" /></tr></thead>
      <tbody>
        {linhas.length === 0 && <Vazio cols={11}>Nenhum MEI neste mês. {onNovo && <button className={css.link} onClick={onNovo}>Adicionar MEI</button>}</Vazio>}
        {linhas.map((l) => (
          <Linha key={l.id} rotulo={`Abrir lançamento de ${l.nome}`} onAbrir={(el) => onAbrir(l.id, el)}>
            <td className={vt.nome}>{l.nome}<small>{l.documento ?? l.funcao ?? 'MEI'}</small></td>
            <td className={vt.n}>{brl(l.valorCent)}</td>
            <td className={vt.n}>{brl(l.valorDiaCent)}<small className={css.sub}>÷ {l.diasMes} dias</small></td>
            <td className={vt.n}>{l.heCent ? <span className={vt.pos}>{brl(l.heCent + l.feriadosCent)}</span> : l.feriadosCent ? <span className={vt.pos}>{brl(l.feriadosCent)}</span> : '—'}</td>
            <td className={vt.n}>{l.faltasCent ? <span className={vt.neg}>{brl(-l.faltasCent)}</span> : '—'}</td>
            <td className={vt.n}>{!l.lanc.metaCent ? '—' : l.lanc.metaPaga
              ? <span className={`${vt.pill} ${vt.pillOk}`}>{brl(l.lanc.metaCent)} · paga</span>
              : <span className={`${vt.pill} ${vt.pillWarn}`}>{brl(l.lanc.metaCent)} · a pagar</span>}</td>
            <td className={`${vt.n} ${css.forte}`}>{brl(l.brutoCent)}</td>
            <td className={vt.n}>{l.debitosCent ? <span className={vt.neg}>{brl(-l.debitosCent)}</span> : '—'}</td>
            <td className={`${vt.n} ${css.forte}`}>{brl(l.liquidoCent)}</td>
            <td className={vt.n}>{l.lanc.nfNumero ? <span className={`${vt.pill} ${l.lanc.pago ? vt.pillOk : vt.pillMute}`}>NF {l.lanc.nfNumero}{l.lanc.pago ? ' · paga' : ''}</span> : <span className={`${vt.pill} ${vt.pillErr}`}>NF pendente</span>}</td>
          </Linha>
        ))}
      </tbody>
      {linhas.length > 0 && <tfoot><tr className={vt.tot}><td>Total · {linhas.length}</td><td className={vt.n}>{brl(t.c)}</td><td /><td /><td /><td />
        <td className={vt.n}>{brl(t.b)}</td><td /><td className={vt.n}>{brl(t.li)}</td><td /><td /></tr></tfoot>}
    </table></div></div>
  );
}

function TabelaMot({ linhas, onAbrir, onNovo }: { linhas: PessoalLinhaMot[]; onAbrir: (id: string, el: HTMLElement) => void; onNovo?: () => void }) {
  const total = linhas.reduce((a, l) => a + l.totalCent, 0);
  return (
    <div className={vt.tab}><div className={vt.scroll}><table className={vt.table}>
      <thead><tr><th>Motorista</th><th className={vt.n}>Mensal</th><th className={vt.n}>Diária</th><th className={vt.n}>Dias no mês</th><th className={vt.n}>Adicionais</th>
        <th className={vt.n}>Total das NFs</th><th className={vt.n}>Semanas</th><th aria-label="Abrir" /></tr></thead>
      <tbody>
        {linhas.length === 0 && <Vazio cols={8}>Nenhum motorista neste mês. {onNovo && <button className={css.link} onClick={onNovo}>Adicionar motorista</button>}</Vazio>}
        {linhas.map((l) => {
          const comDias = l.semanas.filter((s) => s.dias > 0);
          const pagas = comDias.filter((s) => s.pago).length;
          const semNf = comDias.filter((s) => !s.nfNumero).length;
          return (
            <Linha key={l.id} rotulo={`Abrir semanas de ${l.nome}`} onAbrir={(el) => onAbrir(l.id, el)}>
              <td className={vt.nome}>{l.nome}<small>{l.funcao ?? 'motorista'} · {l.baseDias === 'SEG_SAB' ? 'seg–sáb' : 'seg–sex'}</small></td>
              <td className={vt.n}>{brl(l.valorCent)}</td>
              <td className={vt.n}>{brl(l.diariaCent)}<small className={css.sub}>÷ {l.diasMes} dias</small></td>
              <td className={vt.n}>{l.semanas.reduce((a, s) => a + s.dias, 0)}</td>
              <td className={vt.n}>{l.semanas.some((s) => s.adicionalCent) ? brl(l.semanas.reduce((a, s) => a + s.adicionalCent, 0)) : '—'}</td>
              <td className={`${vt.n} ${css.forte}`}>{brl(l.totalCent)}</td>
              <td className={vt.n}>{semNf ? <span className={`${vt.pill} ${vt.pillErr}`}>{semNf} sem NF</span> : <span className={`${vt.pill} ${pagas === comDias.length ? vt.pillOk : vt.pillMute}`}>{pagas}/{comDias.length} pagas</span>}</td>
            </Linha>
          );
        })}
      </tbody>
      {linhas.length > 0 && <tfoot><tr className={vt.tot}><td>Total · {linhas.length}</td><td /><td /><td /><td /><td className={vt.n}>{brl(total)}</td><td /><td /></tr></tfoot>}
    </table></div></div>
  );
}

function TabelaDebitos({ d, busca, fechado, onAbrir, onRemover }: {
  d: PessoalCompetencia; busca: string; fechado: boolean;
  onAbrir: (tipo: PessoaTipo, id: string, el: HTMLElement) => void; onRemover: (id: string, descricao: string, nome: string) => void;
}) {
  const ok = (n: string) => !busca || n.toLowerCase().includes(busca.toLowerCase());
  const manuais = d.debitos.filter((x) => ok(x.nome));
  const acertos = d.clt.filter((c) => c.beneficios.acertoCent > 0 && ok(c.nome));
  return (
    <div className={vt.tab}><div className={vt.scroll}><table className={vt.table}>
      <thead><tr><th>Débito</th><th className={vt.n}>Valor total</th><th className={vt.n}>Parcela</th><th className={vt.n}>Desconta em {mesCurto(d.competencia)}</th><th>Origem</th><th aria-label="Ações" /></tr></thead>
      <tbody>
        {manuais.length + acertos.length === 0 && <Vazio cols={6}>Nenhum débito em {mesCurto(d.competencia)}. Use "Adicionar débito" para adiantamentos e equipamentos.</Vazio>}
        {manuais.map((x) => (
          <tr key={x.id}>
            <td className={vt.nome}><button className={css.linkNome} onClick={(e) => onAbrir(x.pessoaTipo, x.pessoaId, e.currentTarget)}>{x.descricao}</button><small>{x.nome} · {ROT_TIPO[x.pessoaTipo]}</small></td>
            <td className={vt.n}>{brl(x.valorTotalCent)}</td>
            <td className={vt.n}>{x.parcelaAtual}/{x.parcelas}</td>
            <td className={`${vt.n} ${vt.neg} ${css.forte}`}>{brl(-x.parcelaCent)}</td>
            <td><span className={`${vt.pill} ${vt.pillMute}`}>manual</span></td>
            <td className={vt.n}>{!fechado && <button className={css.link} onClick={() => onRemover(x.id, x.descricao, x.nome)}>Remover</button>}</td>
          </tr>
        ))}
        {acertos.map((c) => (
          <tr key={`ac-${c.empregadoId}`}>
            <td className={vt.nome}><button className={css.linkNome} onClick={(e) => onAbrir('CLT', c.empregadoId, e.currentTarget)}>Acerto de benefícios de {mesCurto(d.competencia)}</button><small>{c.nome} · CLT</small></td>
            <td className={vt.n}>{brl(c.beneficios.acertoCent)}</td><td className={vt.n}>1/1</td>
            <td className={`${vt.n} ${vt.neg} ${css.forte}`}>{brl(-c.beneficios.acertoCent)}</td>
            <td><span className={`${vt.pill} ${vt.pillLime}`} title="Calculado do ponto: abatido na carga de benefícios, não no salário">automático</span></td><td />
          </tr>
        ))}
      </tbody>
    </table></div></div>
  );
}

// =================== painel lateral e diálogos ===================

function PainelLateral({ titulo, sub, onFechar, children }: { titulo: string; sub: string; onFechar: () => void; children: ReactNode }) {
  const x = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    x.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[data-dialogo]')) onFechar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar]);
  return (
    <>
      <div className={css.fundo} onClick={onFechar} />
      <aside className={css.painel} role="dialog" aria-modal="true" aria-labelledby="painel-titulo">
        <div className={css.pTopo}>
          <div><h3 id="painel-titulo">{titulo}</h3><p>{sub}</p></div>
          <button ref={x} className={css.pX} onClick={onFechar} aria-label="Fechar painel">✕</button>
        </div>
        {children}
      </aside>
    </>
  );
}

function Dialogo({ titulo, children, confirmar, perigo, onCancelar, onConfirmar }: {
  titulo: string; children: ReactNode; confirmar: string; perigo?: boolean; onCancelar: () => void; onConfirmar: () => void | Promise<void>;
}) {
  const cancelar = useRef<HTMLButtonElement>(null);
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    const voltar = document.activeElement as HTMLElement | null;
    cancelar.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancelar(); };
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('keydown', esc); voltar?.focus?.(); };
  }, [onCancelar]);
  return (
    <div className={css.dFundo} data-dialogo>
      <div className={css.dialogo} role="alertdialog" aria-modal="true" aria-labelledby="dlg-titulo">
        <h3 id="dlg-titulo">{titulo}</h3>
        {children}
        <div className={css.dAcoes}>
          <button ref={cancelar} className={css.btnTexto} onClick={onCancelar}>Cancelar</button>
          <Botao variante="coral" className={`${css.btnPri} ${perigo ? css.perigo : ''}`} disabled={enviando}
            onClick={async () => { setEnviando(true); try { await onConfirmar(); } finally { setEnviando(false); } }}>{enviando ? 'Um instante…' : confirmar}</Botao>
        </div>
      </div>
    </div>
  );
}

function DialogoTirar({ nome, mes, onCancelar, onConfirmar }: { nome: string; mes: string; onCancelar: () => void; onConfirmar: (e: 'MES' | 'DIANTE') => Promise<void> }) {
  const [escopo, setEscopo] = useState<'MES' | 'DIANTE'>('MES');
  return (
    <Dialogo titulo={`Tirar ${nome} de ${mesCurto(mes)}?`} confirmar={`Tirar de ${mesCurto(mes)}`} perigo onCancelar={onCancelar} onConfirmar={() => onConfirmar(escopo)}>
      <p className={css.hint}>Os meses anteriores continuam exatamente como estão. Escolha o que acontece daqui pra frente:</p>
      <label className={css.opcao}><input type="radio" name="escopo" checked={escopo === 'MES'} onChange={() => setEscopo('MES')} />
        <span><b>Só de {mesCurto(mes)}</b><span>Volta normalmente em {mesCurto(somarMes(mes, 1))}.</span></span></label>
      <label className={css.opcao}><input type="radio" name="escopo" checked={escopo === 'DIANTE'} onChange={() => setEscopo('DIANTE')} />
        <span><b>De {mesCurto(mes)} em diante</b><span>Sai deste mês e dos próximos. O histórico fica guardado.</span></span></label>
    </Dialogo>
  );
}

// ---------- campos ----------

function CampoReais({ id, rotulo, valorCent, onChange, ajuda, disabled }: { id: string; rotulo: string; valorCent: number; onChange: (c: number) => void; ajuda?: string; disabled?: boolean }) {
  const [txt, setTxt] = useState(reaisTxt(valorCent));
  useEffect(() => { setTxt(reaisTxt(valorCent)); }, [valorCent]);
  return (
    <label className={css.campo} htmlFor={id}>
      <span>{rotulo}</span>
      <span className={css.input}><em>R$</em><input id={id} inputMode="decimal" value={txt} disabled={disabled}
        onChange={(e) => { setTxt(e.target.value); onChange(Math.round(numeroBr(e.target.value) * 100)); }}
        onBlur={() => setTxt(reaisTxt(Math.round(numeroBr(txt) * 100)))} /></span>
      {ajuda && <small>{ajuda}</small>}
    </label>
  );
}
function CampoNum({ id, rotulo, valor, onChange, sufixo, max, disabled }: { id: string; rotulo: string; valor: number; onChange: (n: number) => void; sufixo?: string; max?: number; disabled?: boolean }) {
  return (
    <label className={css.campo} htmlFor={id}>
      <span>{rotulo}</span>
      <span className={css.input}><input id={id} type="number" min={0} max={max} value={valor} disabled={disabled}
        onChange={(e) => onChange(Math.max(0, Math.min(max ?? 1e9, Math.floor(Number(e.target.value) || 0))))} />{sufixo && <em>{sufixo}</em>}</span>
    </label>
  );
}
function CampoTexto({ id, rotulo, valor, onChange, placeholder, ajuda, disabled, tipo }: { id: string; rotulo: string; valor: string; onChange: (s: string) => void; placeholder?: string; ajuda?: string; disabled?: boolean; tipo?: string }) {
  return (
    <label className={css.campo} htmlFor={id}>
      <span>{rotulo}</span>
      <span className={css.input}><input id={id} type={tipo ?? 'text'} value={valor} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} /></span>
      {ajuda && <small>{ajuda}</small>}
    </label>
  );
}
function Alternar<T extends string>({ rotulo, valor, opcoes, onChange, disabled }: { rotulo: string; valor: T; opcoes: [T, string][]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className={css.campo} role="group" aria-label={rotulo}>
      <span>{rotulo}</span>
      <div className={css.alternar}>
        {opcoes.map(([v, t]) => <button key={v} type="button" disabled={disabled} aria-pressed={valor === v} onClick={() => onChange(v)}>{t}</button>)}
      </div>
    </div>
  );
}
const Linha2 = ({ k, v, cls }: { k: ReactNode; v: ReactNode; cls?: string }) => <div className={`${css.l2} ${cls ?? ''}`}><span>{k}</span><strong>{v}</strong></div>;

/** Observação do mês: salva sozinha ao sair do campo. */
function Observacao({ pessoaTipo, pessoaId, mes, inicial, disabled }: { pessoaTipo: PessoaTipo; pessoaId: string; mes: string; inicial: string | null; disabled: boolean }) {
  const [txt, setTxt] = useState(inicial ?? '');
  const [estado, setEstado] = useState<'' | 'salvando' | 'salvo' | 'erro'>('');
  return (
    <label className={css.campo} htmlFor={`obs-${pessoaId}`}>
      <span>Observação de {mesCurto(mes)} <small className={css.estado}>{estado === 'salvando' ? 'salvando…' : estado === 'salvo' ? 'salvo' : estado === 'erro' ? 'não salvou — tente de novo' : ''}</small></span>
      <span className={css.input}><textarea id={`obs-${pessoaId}`} rows={3} value={txt} disabled={disabled} placeholder="Ex.: pediu troca de linha de ônibus"
        onChange={(e) => { setTxt(e.target.value); setEstado(''); }}
        onBlur={async () => {
          if ((inicial ?? '') === txt) return;
          setEstado('salvando');
          try { await api.put('/pessoal/lancamento', { pessoaTipo, pessoaId, competencia: mes, observacao: txt }); setEstado('salvo'); }
          catch { setEstado('erro'); }
        }} /></span>
    </label>
  );
}

// ---------- painéis ----------

type FormBen = { vrDiaCent: number; cestaCent: number; vtTipo: VtTipo; vtValorCent: number };

/** Campos de VR/VA, cesta e transporte (usados no padrão da empresa e no valor próprio). */
function CamposBeneficio({ f, set, disabled, prefixo }: { f: FormBen; set: (f: FormBen) => void; disabled?: boolean; prefixo: string }) {
  return (
    <>
      <div className={css.grade2}>
        <CampoReais id={`${prefixo}-vr`} rotulo="VR/VA por dia" valorCent={f.vrDiaCent} onChange={(c) => set({ ...f, vrDiaCent: c })} disabled={disabled} />
        <CampoReais id={`${prefixo}-cesta`} rotulo="Cesta básica (mensal)" valorCent={f.cestaCent} onChange={(c) => set({ ...f, cestaCent: c })} disabled={disabled} />
      </div>
      <Alternar<VtTipo> rotulo="Transporte" valor={f.vtTipo} disabled={disabled} onChange={(v) => set({ ...f, vtTipo: v })}
        opcoes={[['DIA', 'VT por dia'], ['FIXO', 'Combustível fixo'], ['NENHUM', 'Não recebe']]} />
      {f.vtTipo !== 'NENHUM' && <CampoReais id={`${prefixo}-vt`} rotulo={f.vtTipo === 'DIA' ? 'Valor do VT por dia' : 'Valor fixo mensal'} valorCent={f.vtValorCent}
        onChange={(c) => set({ ...f, vtValorCent: c })} disabled={disabled}
        ajuda={f.vtTipo === 'FIXO' ? 'Cada falta abate 1/30. Feriado não abate.' : 'Multiplica pelos dias de trabalho. Faltas e feriados abatem.'} />}
    </>
  );
}

/** "Vale a partir de": o mês do benefício. Só meses cuja carga ainda não saiu. */
function ValeAPartir({ id, prox, mes, valor, onChange }: { id: string; prox: string; mes?: string; valor: string; onChange: (c: string) => void }) {
  // `mes` presente = primeira configuração: dá pra registrar também o que já foi
  // pago no mês atual (base do acerto de feriado/falta deste fechamento).
  const opcoes = [...(mes ? [mes] : []), ...[0, 1, 2, 3, 4, 5].map((n) => somarMes(prox, n))];
  return (
    <label className={css.campo} htmlFor={id}>
      <span>Vale a partir de</span>
      <span className={css.input}><select id={id} value={valor} onChange={(e) => onChange(e.target.value)}>
        {opcoes.map((c) => <option key={c} value={c}>{mesLongo(c)}{c === prox ? ' — carga deste fechamento' : c === mes ? ' — já pago este mês (entra no acerto)' : ''}</option>)}
      </select></span>
      <small>Os meses anteriores continuam com o valor que valia na época. Nada que já foi pago muda.</small>
    </label>
  );
}

function PainelPadrao({ d, onSalvo }: { d: PessoalCompetencia; onSalvo: (msg: string) => Promise<void> }) {
  const base: FormBen = d.padrao ?? { vrDiaCent: 0, cestaCent: 0, vtTipo: 'DIA', vtValorCent: 0 };
  const [f, setF] = useState<FormBen>({ vrDiaCent: base.vrDiaCent, cestaCent: base.cestaCent, vtTipo: base.vtTipo, vtValorCent: base.vtValorCent });
  // Primeira vez: começa no mês atual — é o que já foi pago, e o acerto de
  // feriado/falta deste mês precisa saber o valor.
  const primeira = d.padroes.length === 0;
  const [vig, setVig] = useState(primeira ? d.competencia : d.proxima);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const seguem = d.clt.filter((c) => c.config.origem !== 'PROPRIO').length;
  async function salvar() {
    setSalvando(true); setErro(null);
    try {
      await api.put('/pessoal/padrao', { vrDia: f.vrDiaCent / 100, cestaMensal: f.cestaCent / 100, vtTipo: f.vtTipo, vtValor: f.vtValorCent / 100, vigenteDesde: vig });
      await onSalvo(`Padrão salvo a partir de ${mesLongo(vig)}.`);
    } catch (e) { setErro((e as Error).message); setSalvando(false); }
  }
  return (
    <>
      <div className={css.pCorpo}>
        <p className={css.hint}>Defina uma vez: todo CLT sem valor próprio recebe estes valores, todo mês, até você mudar. Hoje {seguem === 1 ? '1 pessoa segue' : `${seguem} pessoas seguem`} o padrão.</p>
        <section className={css.bloco}>
          <span className={css.lb}>Valores</span>
          <CamposBeneficio f={f} set={setF} prefixo="pd" />
          <ValeAPartir id="pd-vig" prox={d.proxima} mes={primeira ? d.competencia : undefined} valor={vig} onChange={setVig} />
        </section>
        {d.padroes.length > 0 && (
          <section className={css.bloco}>
            <span className={css.lb}>Histórico</span>
            {d.padroes.map((p: PessoalPadrao) => <Linha2 key={p.vigenteDesde} k={`desde ${mesLongo(p.vigenteDesde)}`} v={resumoBen(p)} />)}
          </section>
        )}
      </div>
      <div className={css.pRodape}>
        {erro && <p className={css.alerta}>{erro}</p>}
        <Botao variante="coral" className={css.btnPri} disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : `Salvar padrão a partir de ${mesCurto(vig)}`}</Botao>
      </div>
    </>
  );
}

function PainelClt({ l, d, mes, fechado, onSalvo, onAviso, onTirar }: {
  l: PessoalLinhaClt; d: PessoalCompetencia; mes: string; fechado: boolean; onSalvo: () => Promise<void>; onAviso: (m: string) => void; onTirar: () => void;
}) {
  const inicial = () => ({
    modo: (l.config.origem === 'PROPRIO' ? 'PROPRIO' : 'PADRAO') as 'PADRAO' | 'PROPRIO',
    ben: { vrDiaCent: l.config.vrDiaCent, cestaCent: l.config.cestaCent, vtTipo: l.config.vtTipo === 'NENHUM' && l.config.origem !== 'PROPRIO' ? 'DIA' as VtTipo : l.config.vtTipo, vtValorCent: l.config.vtValorCent },
    cargo: l.config.cargo ?? '', pix: l.config.chavePix ?? '', vig: d.proxima,
  });
  const [f, setF] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { setF(inicial()); }, [l.config]);
  const ini = inicial();
  const mudou = JSON.stringify({ ...f, vig: '' }) !== JSON.stringify({ ...ini, vig: '' });
  const b = l.beneficios;
  async function salvar() {
    setSalvando(true); setErro(null);
    try {
      const proprio = f.modo === 'PROPRIO';
      await api.put(`/pessoal/clt/${l.empregadoId}/config`, {
        cargo: f.cargo, chavePix: f.pix, vigenteDesde: f.vig, usaPadrao: !proprio,
        vrDia: proprio ? f.ben.vrDiaCent / 100 : 0, cestaMensal: proprio ? f.ben.cestaCent / 100 : 0,
        vtTipo: proprio ? f.ben.vtTipo : 'NENHUM', vtValor: proprio && f.ben.vtTipo !== 'NENHUM' ? f.ben.vtValorCent / 100 : 0,
      });
      await onSalvo(); onAviso(`${l.nome}: ${proprio ? 'valor próprio' : 'padrão da empresa'} a partir de ${mesLongo(f.vig)}.`);
    } catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }
  return (
    <>
      <div className={css.pCorpo}>
        {l.erro && <p className={css.alerta}>Sem números do ponto: {l.erro}. Confira a escala em Funcionários.</p>}
        <section className={css.bloco}>
          <span className={css.lb}>Valor do dia em {mesCurto(mes)}</span>
          <Linha2 cls={css.grande} k={`${l.diasMes} dias de trabalho`} v={l.salarioCent == null ? 'sem salário' : brl(l.valorDiaMesCent)} />
          <p className={css.formula}>{l.salarioCent == null ? 'Sem salário no cadastro.' : `${brl(l.salarioCent)} ÷ ${l.diasMes} (dias da escala neste mês, sem os feriados cadastrados)`}</p>
          <Linha2 k={<span className={css.mute}>Base do desconto de falta (÷ 30)</span>} v={brl(l.valorDia30Cent)} />
          <Linha2 k={<span className={css.mute}>Valor-hora (÷ 220)</span>} v={brl(l.valorHoraCent)} />
          <Link className={css.link} to="/rh/funcionarios">O salário vem de Funcionários — editar lá</Link>
        </section>

        <section className={css.bloco}>
          <span className={css.lb}>Do ponto</span>
          <Linha2 k="Horas extras" v={l.heMin === 0 ? '—' : l.heNoBancoMin >= l.heMin ? `${minutosParaHhMm(l.heMin)} · no banco` : brl(Math.max(0, l.proventosCent - l.indenizacaoCent))} />
          {l.heNoBancoMin > 0 && <p className={css.formula}>{minutosParaHhMm(l.heNoBancoMin)} foram pro banco de horas — não são pagas nesta folha.</p>}
          {l.indenizacaoCent > 0 && <>
            <Linha2 k="Indenização de intervalo (Art. 71)" v={brl(l.indenizacaoCent)} />
            <p className={css.formula}>{minutosParaHhMm(l.indenizacaoMin)} de almoço abaixo do mínimo legal, pagos com 50%. Não é hora extra: é indenização obrigatória e não pode ir pro banco. Os dias aparecem com "intervalo curto" na apuração.</p>
          </>}
          <Linha2 k="Faltas" v={l.faltasDias.length ? l.faltasDias.map(fmtDia).join(', ') : '—'} cls={l.faltasDias.length ? css.neg : ''} />
          <Linha2 k="Descontos (falta, atraso, DSR)" v={l.descontosCent ? brl(-l.descontosCent) : '—'} cls={l.descontosCent ? css.neg : ''} />
          <Link className={css.link} to={`/rh/apuracao?emp=${l.empregadoId}&mes=${mes}`}>Abrir apuração do ponto</Link>
        </section>

        <section className={css.bloco}>
          <span className={css.lb}>Benefícios · carga de {mesCurto(d.proxima)}</span>
          <Linha2 k={`VR/VA · ${b.diasProx} dias${l.config.cestaCent ? ' + cesta' : ''}`} v={brl(b.vrProxCent)} />
          <Linha2 k={l.config.vtTipo === 'FIXO' ? 'Combustível · fixo mensal' : l.config.vtTipo === 'DIA' ? `VT · ${b.diasProx} dias` : 'Transporte'} v={l.config.vtTipo === 'NENHUM' ? '—' : brl(b.vtProxCent)} />
          <Linha2 k={`Acerto de ${mesCurto(mes)}`} v={b.acertoCent ? brl(-b.acertoCent) : '—'} cls={b.acertoCent ? css.neg : ''} />
          {b.naoUsados.length > 0 && <p className={css.formula}>{b.naoUsados.map((x) => `${fmtDia(x.data)} ${ROT_MOTIVO[x.motivo]}`).join(' · ')} — {b.acertoCent
            ? `devolvido pelo valor que foi pago em ${mesCurto(mes)}`
            : `nenhum valor registrado como pago em ${mesCurto(mes)}, nada a devolver`}</p>}
          {b.pagosEstimado && <p className={css.formula}>Dias pagos em {mesCurto(mes)} estimados pela escala (mês anterior não fechado no sistema).</p>}
          <Linha2 cls={css.total} k="A carregar" v={brl(b.cargaCent)} />
        </section>

        <section className={css.bloco}>
          <span className={css.lb}>Valores de benefício</span>
          <p className={css.formula}>Hoje: {l.config.origem === 'PROPRIO' ? 'valor próprio' : l.config.origem === 'PADRAO' ? 'padrão da empresa' : 'sem benefício'}{l.config.vigenteDesde ? ` desde ${mesLongo(l.config.vigenteDesde)}` : ''} · {resumoBen(l.config)}</p>
          <Alternar<'PADRAO' | 'PROPRIO'> rotulo="De onde vem o valor" valor={f.modo} disabled={fechado} onChange={(v) => setF({ ...f, modo: v })}
            opcoes={[['PADRAO', d.padrao ? 'Padrão da empresa' : 'Padrão da empresa (não definido)'], ['PROPRIO', 'Valor próprio']]} />
          {f.modo === 'PADRAO'
            ? <p className={css.hint}>{d.padrao ? `${resumoBen(d.padrao)}. Se o padrão mudar, muda pra esta pessoa também.` : 'Defina o padrão em Benefícios → "Definir padrão da empresa".'}</p>
            : <CamposBeneficio f={f.ben} set={(ben) => setF({ ...f, ben })} disabled={fechado} prefixo="pp" />}
          <div className={css.grade2}>
            <CampoTexto id="cargo" rotulo="Cargo" valor={f.cargo} onChange={(v) => setF({ ...f, cargo: v })} placeholder="Auxiliar de logística" disabled={fechado} />
            <CampoTexto id="pix" rotulo="Chave Pix (opcional)" valor={f.pix} onChange={(v) => setF({ ...f, pix: v })} disabled={fechado} />
          </div>
          {!fechado && <ValeAPartir id="pp-vig" prox={d.proxima} valor={f.vig} onChange={(v) => setF({ ...f, vig: v })} />}
          {erro && <p className={css.alerta}>{erro}</p>}
          {!fechado && <Botao variante="coral" className={css.btnPri} disabled={!mudou || salvando} onClick={salvar}>{salvando ? 'Salvando…' : `Salvar a partir de ${mesCurto(f.vig)}`}</Botao>}
        </section>

        <section className={css.bloco}>
          <span className={css.lb}>Resumo</span>
          <Linha2 k="Líquido do salário" v={brl(l.liquidoSalarioCent)} />
          <Linha2 k="Débitos descontados" v={l.debitosCent ? brl(-l.debitosCent) : '—'} />
          <Linha2 cls={css.total} k="Custo bruto da empresa" v={brl(l.custoBrutoCent)} />
          <p className={css.formula}>O custo bruto não tira débitos nem acertos: esse dinheiro já tinha saído antes.</p>
        </section>

        <Observacao pessoaTipo="CLT" pessoaId={l.empregadoId} mes={mes} inicial={l.observacao} disabled={fechado} />
        {!fechado && <ZonaTirar nome={l.nome} mes={mes} onTirar={onTirar} />}
      </div>
    </>
  );
}

function ZonaTirar({ nome, mes, onTirar }: { nome: string; mes: string; onTirar: () => void }) {
  return (
    <section className={`${css.bloco} ${css.zonaPerigo}`}>
      <span className={css.lb}>Tirar deste mês</span>
      <p className={css.formula}>Os meses anteriores nunca mudam. Você escolhe se a pessoa volta no mês seguinte.</p>
      <button className={css.btnContorno} onClick={onTirar}>Tirar {nome.split(' ')[0]} de {mesCurto(mes)}…</button>
    </section>
  );
}

function DadosContrato({ p, mes, fechado, onSalvo }: { p: PessoalLinhaMei | PessoalLinhaMot; mes: string; fechado: boolean; onSalvo: () => Promise<void> }) {
  const [aberto, setAberto] = useState<'' | 'dados' | 'reajuste'>('');
  const [f, setF] = useState({ nome: p.nome, documento: p.documento ?? '', funcao: p.funcao ?? '', chavePix: p.chavePix ?? '' });
  const [r, setR] = useState({ valorCent: p.valorCent, baseDias: p.baseDias, vig: mes });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const motorista = 'semanas' in p;
  const opcoesVig = [0, 1, 2, 3, 4, 5].map((n) => somarMes(mes, n));
  async function enviar(corpo: Record<string, unknown>) {
    setSalvando(true); setErro(null);
    try { await api.patch(`/pessoal/prestadores/${p.id}`, corpo); setAberto(''); await onSalvo(); }
    catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }
  return (
    <section className={css.bloco}>
      <span className={css.lb}>Contrato</span>
      <Linha2 k={`Valor em ${mesCurto(mes)}`} v={brl(p.valorCent)} />
      <p className={css.formula}>Vale desde {mesLongo(p.valorDesde)} · {p.baseDias === 'SEG_SAB' ? 'segunda a sábado' : 'segunda a sexta'}</p>
      {p.historicoValores.length > 1 && (
        <div className={css.historico}>
          {p.historicoValores.map((h) => (
            <Linha2 key={h.vigenteDesde} cls={h.vigenteDesde === p.valorDesde ? css.histAtual : ''}
              k={<span className={css.mute}>desde {mesLongo(h.vigenteDesde)}</span>} v={brl(h.valorCent)} />
          ))}
        </div>
      )}

      {!fechado && aberto === '' && (
        <div className={css.acoes}>
          <button className={css.btnContornoNeutro} onClick={() => { setR({ valorCent: p.valorCent, baseDias: p.baseDias, vig: mes }); setAberto('reajuste'); }}>Reajustar valor</button>
          <button className={css.link} onClick={() => { setF({ nome: p.nome, documento: p.documento ?? '', funcao: p.funcao ?? '', chavePix: p.chavePix ?? '' }); setAberto('dados'); }}>Editar nome, {motorista ? 'documento' : 'CNPJ'} ou Pix</button>
        </div>
      )}

      {aberto === 'reajuste' && (
        <>
          <CampoReais id="rj-val" rotulo="Novo valor mensal" valorCent={r.valorCent} onChange={(c) => setR({ ...r, valorCent: c })} />
          <Alternar<BaseDias> rotulo="Dias que contam" valor={r.baseDias} onChange={(v) => setR({ ...r, baseDias: v })} opcoes={[['SEG_SAB', 'Segunda a sábado'], ['SEG_SEX', 'Segunda a sexta']]} />
          <label className={css.campo} htmlFor="rj-vig">
            <span>Vale a partir de</span>
            <span className={css.input}><select id="rj-vig" value={r.vig} onChange={(e) => setR({ ...r, vig: e.target.value })}>
              {opcoesVig.map((c) => <option key={c} value={c}>{mesLongo(c)}{c === mes ? ' — este fechamento' : ''}</option>)}
            </select></span>
            <small>Os meses anteriores continuam com {brl(p.valorCent)}, fechados ou não.</small>
          </label>
          {erro && <p className={css.alerta}>{erro}</p>}
          <div className={css.dAcoes}>
            <button className={css.btnTexto} onClick={() => { setAberto(''); setErro(null); }}>Cancelar</button>
            <Botao variante="coral" className={css.btnPri} disabled={salvando || r.valorCent <= 0 || (r.valorCent === p.valorCent && r.baseDias === p.baseDias)}
              onClick={() => enviar({ valorMensal: r.valorCent / 100, baseDias: r.baseDias, vigenteDesde: r.vig })}>
              {salvando ? 'Salvando…' : `Reajustar a partir de ${mesCurto(r.vig)}`}
            </Botao>
          </div>
        </>
      )}

      {aberto === 'dados' && (
        <>
          <CampoTexto id="c-nome" rotulo="Nome" valor={f.nome} onChange={(v) => setF({ ...f, nome: v })} />
          <div className={css.grade2}>
            <CampoTexto id="c-doc" rotulo={motorista ? 'Documento' : 'CNPJ'} valor={f.documento} onChange={(v) => setF({ ...f, documento: v })} />
            <CampoTexto id="c-fun" rotulo={motorista ? 'Categoria' : 'Função'} valor={f.funcao} onChange={(v) => setF({ ...f, funcao: v })} />
          </div>
          <CampoTexto id="c-pix" rotulo="Chave Pix (opcional)" valor={f.chavePix} onChange={(v) => setF({ ...f, chavePix: v })} />
          <p className={css.formula}>Dados cadastrais mudam em todos os meses. Pra mudar valor, use "Reajustar valor".</p>
          {erro && <p className={css.alerta}>{erro}</p>}
          <div className={css.dAcoes}>
            <button className={css.btnTexto} onClick={() => { setAberto(''); setErro(null); }}>Cancelar</button>
            <Botao variante="coral" className={css.btnPri} disabled={salvando || !f.nome.trim()}
              onClick={() => enviar({ nome: f.nome, documento: f.documento, funcao: f.funcao, chavePix: f.chavePix })}>{salvando ? 'Salvando…' : 'Salvar dados'}</Botao>
          </div>
        </>
      )}
    </section>
  );
}

function PainelMei({ l, mes, fechado, onSalvo, onContrato, onTirar }: { l: PessoalLinhaMei; mes: string; fechado: boolean; onSalvo: () => Promise<void>; onContrato: () => Promise<void>; onTirar: () => void }) {
  const [f, setF] = useState({ ...l.lanc });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const pv = useMemo(() => previaMei(l.valorCent, l.diasMes, f, l.debitosCent), [l.valorCent, l.diasMes, l.debitosCent, f]);
  const hojeIso = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  async function salvar() {
    setSalvando(true); setErro(null);
    try {
      await api.put('/pessoal/lancamento', {
        pessoaTipo: 'MEI', pessoaId: l.id, competencia: mes,
        heMin: f.heMin, faltas: f.faltas, feriadosTrab: f.feriadosTrab, meta: f.metaCent / 100, metaPaga: f.metaPaga,
        metaPagaEm: f.metaPaga ? (f.metaPagaEm || hojeIso) : null, nfNumero: f.nfNumero ?? '', nfData: f.nfData || null, pago: f.pago,
      });
      await onSalvo();
    } catch (e) { setErro((e as Error).message); setSalvando(false); }
  }
  return (
    <>
      <div className={css.pCorpo}>
        <section className={css.bloco}>
          <span className={css.lb}>Base de {mesCurto(mes)}</span>
          <Linha2 k={`Contrato (desde ${mesCurto(l.valorDesde)})`} v={brl(l.valorCent)} />
          <Linha2 cls={css.grande} k={`${l.diasMes} dias (${l.baseDias === 'SEG_SAB' ? 'seg–sáb' : 'seg–sex'}, sem feriados)`} v={brl(l.valorDiaCent)} />
          <Linha2 k={<span className={css.mute}>Valor-hora ({l.diasMes} × 8h) · extra × 1,5</span>} v={`${brl(l.valorHoraCent)} · ${brl(Math.round(l.valorHoraCent * 1.5))}`} />
        </section>
        <div className={css.grade2}>
          <CampoNum id="he-h" rotulo="Horas extras" sufixo="h" valor={Math.floor(f.heMin / 60)} onChange={(n) => setF({ ...f, heMin: n * 60 + (f.heMin % 60) })} disabled={fechado} />
          <CampoNum id="he-m" rotulo="e minutos" sufixo="min" max={59} valor={f.heMin % 60} onChange={(n) => setF({ ...f, heMin: Math.floor(f.heMin / 60) * 60 + n })} disabled={fechado} />
          <CampoNum id="faltas" rotulo="Faltas" sufixo="dias" max={31} valor={f.faltas} onChange={(n) => setF({ ...f, faltas: n })} disabled={fechado} />
          <CampoNum id="fer" rotulo="Feriados trabalhados" sufixo="dias" max={31} valor={f.feriadosTrab} onChange={(n) => setF({ ...f, feriadosTrab: n })} disabled={fechado} />
        </div>
        <section className={css.bloco}>
          <span className={css.lb}>Meta</span>
          <CampoReais id="meta" rotulo={`Valor da meta em ${mesCurto(mes)}`} valorCent={f.metaCent} onChange={(c) => setF({ ...f, metaCent: c })} disabled={fechado} />
          {f.metaCent > 0 && <>
            <Alternar<'nao' | 'sim'> rotulo="A meta já foi paga?" valor={f.metaPaga ? 'sim' : 'nao'} disabled={fechado}
              onChange={(v) => setF({ ...f, metaPaga: v === 'sim', metaPagaEm: v === 'sim' ? (f.metaPagaEm ?? hojeIso) : null })}
              opcoes={[['nao', 'Ainda não — somar no líquido'], ['sim', 'Já paga — não somar']]} />
            {f.metaPaga && <CampoTexto id="meta-em" tipo="date" rotulo="Paga em" valor={f.metaPagaEm ?? ''} onChange={(v) => setF({ ...f, metaPagaEm: v })} disabled={fechado} />}
            <p className={css.formula}>{f.metaPaga ? 'Continua na nota fiscal (bruto), mas sai do valor a pagar.' : 'Entra na nota fiscal e no valor a pagar.'}</p>
          </>}
        </section>
        <section className={css.bloco}>
          <span className={css.lb}>Nota fiscal e pagamento</span>
          <div className={css.grade2}>
            <CampoTexto id="nf" rotulo="Número da NF" valor={f.nfNumero ?? ''} placeholder="000214" onChange={(v) => setF({ ...f, nfNumero: v })} disabled={fechado} />
            <CampoTexto id="nf-data" tipo="date" rotulo="Data da NF" valor={f.nfData ?? ''} onChange={(v) => setF({ ...f, nfData: v })} disabled={fechado} />
          </div>
          <Alternar<'nao' | 'sim'> rotulo="Pagamento" valor={f.pago ? 'sim' : 'nao'} disabled={fechado} onChange={(v) => setF({ ...f, pago: v === 'sim' })}
            opcoes={[['nao', 'Pendente'], ['sim', 'Pago']]} />
        </section>
        <Observacao pessoaTipo="MEI" pessoaId={l.id} mes={mes} inicial={l.lanc.observacao} disabled={fechado} />
        <DadosContrato p={l} mes={mes} fechado={fechado} onSalvo={onContrato} />
        {!fechado && <ZonaTirar nome={l.nome} mes={mes} onTirar={onTirar} />}
      </div>
      <div className={css.pRodape}>
        <Linha2 k="Bruto · valor da NF" v={brl(pv.brutoCent)} />
        <Linha2 k={<span className={css.mute}>− débitos{f.metaPaga && f.metaCent ? ' − meta já paga' : ''}</span>} v={pv.abat ? brl(-pv.abat) : '—'} cls={css.neg} />
        <Linha2 cls={css.grande} k="Líquido a pagar" v={brl(pv.liquidoCent)} />
        <p className={css.formula}>{brl(l.valorCent)} + extras {brl(pv.heCent)} + feriados {brl(pv.feriadosCent)} − faltas {brl(pv.faltasCent)} + meta {brl(f.metaCent)}</p>
        {erro && <p className={css.alerta}>{erro}</p>}
        {!fechado && <Botao variante="coral" className={css.btnPri} disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar lançamento'}</Botao>}
      </div>
    </>
  );
}

function PainelMot({ l, mes, fechado, onSalvo, onContrato, onTirar }: { l: PessoalLinhaMot; mes: string; fechado: boolean; onSalvo: () => Promise<void>; onContrato: () => Promise<void>; onTirar: () => void }) {
  const [sem, setSem] = useState(l.semanas.map((s) => ({ ...s, diasManual: s.dias !== s.diasAuto })));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const diaria = l.valorCent / Math.max(1, l.diasMes);
  // Total do mês arredonda uma vez só (26 dias × diária = mensal exato).
  const total = Math.round(diaria * sem.reduce((a, s) => a + s.dias, 0)) + sem.reduce((a, s) => a + s.adicionalCent, 0);
  const up = (i: number, p: Partial<(typeof sem)[number]>) => setSem(sem.map((s, j) => (j === i ? { ...s, ...p } : s)));
  async function salvar() {
    setSalvando(true); setErro(null);
    try {
      for (let i = 0; i < sem.length; i++) {
        const s = sem[i]!, o = l.semanas[i]!;
        if (s.dias === o.dias && s.adicionalCent === o.adicionalCent && (s.nfNumero ?? '') === (o.nfNumero ?? '') && s.pago === o.pago) continue;
        await api.put('/pessoal/lancamento', {
          pessoaTipo: 'MOTORISTA', pessoaId: l.id, competencia: mes, periodo: s.inicio,
          dias: s.dias === s.diasAuto ? null : s.dias, adicional: s.adicionalCent / 100, nfNumero: s.nfNumero ?? '', pago: s.pago,
        });
      }
      await onSalvo();
    } catch (e) { setErro((e as Error).message); setSalvando(false); }
  }
  return (
    <>
      <div className={css.pCorpo}>
        <section className={css.bloco}>
          <span className={css.lb}>Base de {mesCurto(mes)}</span>
          <Linha2 cls={css.grande} k={`Diária · ${brl(l.valorCent)} ÷ ${l.diasMes} dias`} v={brl(l.diariaCent)} />
          <p className={css.formula}>{l.baseDias === 'SEG_SAB' ? 'Segunda a sábado' : 'Segunda a sexta'}, sem feriados. Os dias de cada semana já vêm preenchidos; ajuste se ele faltou ou trabalhou a mais.</p>
        </section>
        {sem.map((s, i) => (
          <section key={s.inicio} className={css.bloco}>
            <div className={css.l2}><span className={css.lb}>Semana {fmtDia(s.inicio)} a {fmtDia(s.fim)}</span><strong>{brl(Math.round(diaria * s.dias) + s.adicionalCent)}</strong></div>
            <div className={css.grade2}>
              <CampoNum id={`d-${i}`} rotulo={`Dias (previsto ${s.diasAuto})`} max={7} valor={s.dias} onChange={(n) => up(i, { dias: n })} disabled={fechado} />
              <CampoReais id={`a-${i}`} rotulo="Adicionais" valorCent={s.adicionalCent} onChange={(c) => up(i, { adicionalCent: c })} disabled={fechado} ajuda="Sábado extra, freelancer…" />
              <CampoTexto id={`n-${i}`} rotulo="Número da NF" valor={s.nfNumero ?? ''} onChange={(v) => up(i, { nfNumero: v })} disabled={fechado} />
              <Alternar<'nao' | 'sim'> rotulo="Pagamento" valor={s.pago ? 'sim' : 'nao'} disabled={fechado} onChange={(v) => up(i, { pago: v === 'sim' })} opcoes={[['nao', 'Pendente'], ['sim', 'Pago']]} />
            </div>
          </section>
        ))}
        <Observacao pessoaTipo="MOTORISTA" pessoaId={l.id} mes={mes} inicial={l.observacao} disabled={fechado} />
        <DadosContrato p={l} mes={mes} fechado={fechado} onSalvo={onContrato} />
        {!fechado && <ZonaTirar nome={l.nome} mes={mes} onTirar={onTirar} />}
      </div>
      <div className={css.pRodape}>
        <Linha2 k="Total das notas do mês" v={brl(total)} />
        <Linha2 k={<span className={css.mute}>− débitos</span>} v={l.debitosCent ? brl(-l.debitosCent) : '—'} cls={css.neg} />
        <Linha2 cls={css.grande} k="Líquido a pagar" v={brl(total - l.debitosCent)} />
        {erro && <p className={css.alerta}>{erro}</p>}
        {!fechado && <Botao variante="coral" className={css.btnPri} disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar semanas'}</Botao>}
      </div>
    </>
  );
}

function PainelDebito({ mes, onSalvo }: { mes: string; onSalvo: (descricao: string) => Promise<void> }) {
  const [pessoas, setPessoas] = useState<PessoalPessoa[]>([]);
  const [f, setF] = useState({ pessoa: '', descricao: '', valorCent: 0, parcelas: 1, inicio: mes });
  const [erro, setErro] = useState<string | null>(null);
  const [tocado, setTocado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { api.get<PessoalPessoa[]>('/pessoal/pessoas').then(setPessoas).catch((e) => setErro((e as Error).message)); }, []);
  const valido = !!f.pessoa && !!f.descricao.trim() && f.valorCent > 0 && f.parcelas >= 1;
  const parcela = f.parcelas ? Math.floor(f.valorCent / f.parcelas) : 0;
  async function salvar() {
    setTocado(true);
    if (!valido) return;
    const [pessoaTipo, pessoaId] = f.pessoa.split(':');
    setSalvando(true); setErro(null);
    try {
      await api.post('/pessoal/debitos', { pessoaTipo, pessoaId, descricao: f.descricao, valorTotal: f.valorCent / 100, parcelas: f.parcelas, competenciaInicio: f.inicio });
      await onSalvo(f.descricao.trim());
    } catch (e) { setErro((e as Error).message); setSalvando(false); }
  }
  return (
    <>
      <div className={css.pCorpo}>
        <label className={css.campo} htmlFor="db-p"><span>Quem</span>
          <span className={css.input}><select id="db-p" value={f.pessoa} onChange={(e) => setF({ ...f, pessoa: e.target.value })}>
            <option value="">Selecione a pessoa</option>
            {(['CLT', 'MEI', 'MOTORISTA'] as PessoaTipo[]).map((t) => {
              const doTipo = pessoas.filter((p) => p.pessoaTipo === t);
              return doTipo.length ? <optgroup key={t} label={ROT_TIPO[t]}>{doTipo.map((p) => <option key={p.pessoaId} value={`${t}:${p.pessoaId}`}>{p.nome}</option>)}</optgroup> : null;
            })}
          </select></span>
          {tocado && !f.pessoa && <small className={css.erroCampo}>Escolha quem vai ter o desconto.</small>}
        </label>
        <CampoTexto id="db-d" rotulo="Descrição" valor={f.descricao} placeholder="Adiantamento, capacete…" onChange={(v) => setF({ ...f, descricao: v })} />
        {tocado && !f.descricao.trim() && <small className={css.erroCampo}>Diga o que é o débito — aparece pro RH e no fechamento.</small>}
        <div className={css.grade2}>
          <CampoReais id="db-v" rotulo="Valor total" valorCent={f.valorCent} onChange={(c) => setF({ ...f, valorCent: c })} />
          <CampoNum id="db-n" rotulo="Parcelas" max={60} valor={f.parcelas} onChange={(n) => setF({ ...f, parcelas: Math.max(1, n) })} />
        </div>
        {tocado && f.valorCent <= 0 && <small className={css.erroCampo}>Informe um valor maior que zero.</small>}
        <label className={css.campo} htmlFor="db-i"><span>Primeira parcela em</span>
          <span className={css.input}><input id="db-i" type="month" value={f.inicio} min={mes} onChange={(e) => e.target.value && setF({ ...f, inicio: e.target.value })} /></span></label>
        {f.valorCent > 0 && <p className={css.formula}>{f.parcelas}× de {brl(parcela)} a partir de {mesLongo(f.inicio)}{f.parcelas > 1 && f.valorCent % f.parcelas ? ' (a última ajusta os centavos)' : ''}.</p>}
      </div>
      <div className={css.pRodape}>
        {erro && <p className={css.alerta}>{erro}</p>}
        <Botao variante="coral" className={css.btnPri} disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Adicionar débito'}</Botao>
      </div>
    </>
  );
}

// =================== cadastro de prestador (página) ===================

function FormPrestador({ tipoInicial, mes, onVoltar, onCriado }: { tipoInicial: 'MEI' | 'MOTORISTA'; mes: string; onVoltar: () => void; onCriado: (nome: string, tipo: 'MEI' | 'MOTORISTA') => void }) {
  const [f, setF] = useState({ tipo: tipoInicial, nome: '', documento: '', funcao: '', valorCent: 0, baseDias: (tipoInicial === 'MEI' ? 'SEG_SAB' : 'SEG_SEX') as BaseDias, chavePix: '', inicio: mes });
  const [tocado, setTocado] = useState<Record<string, boolean>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const erros = {
    nome: !f.nome.trim() ? 'Informe o nome completo.' : '',
    valor: f.valorCent <= 0 ? `Informe o valor ${f.tipo === 'MEI' ? 'do contrato' : 'mensal'}.` : '',
  };
  const mei = f.tipo === 'MEI';
  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setTocado({ nome: true, valor: true });
    if (erros.nome || erros.valor) return;
    setSalvando(true); setErro(null);
    try {
      await api.post('/pessoal/prestadores', {
        tipo: f.tipo, nome: f.nome, documento: f.documento, funcao: f.funcao, valorMensal: f.valorCent / 100,
        baseDias: f.baseDias, chavePix: f.chavePix, competenciaInicio: f.inicio,
      });
      onCriado(f.nome.trim(), f.tipo);
    } catch (err) { setErro((err as Error).message); setSalvando(false); }
  }
  return (
    <div className={css.pagina}>
      <div className={vt.crumb}><button onClick={onVoltar}>← Fechamento de {mesCurto(mes)}</button><span>/</span><span>Adicionar {mei ? 'MEI' : 'motorista'}</span></div>
      <form className={css.form} onSubmit={enviar} noValidate>
        <h2>Adicionar {mei ? 'MEI' : 'motorista'}</h2>
        <p className={css.hint}>Funcionários CLT não precisam ser adicionados: eles já vêm da base do ponto.</p>
        <section className={css.secao}>
          <h3><span className={css.num}>1</span>Tipo de contrato</h3>
          <div className={css.escolha} role="group" aria-label="Tipo de contrato">
            <button type="button" aria-pressed={mei} onClick={() => setF({ ...f, tipo: 'MEI', baseDias: 'SEG_SAB' })}><b>MEI</b><span>Contrato mensal com nota fiscal no fim do mês.</span></button>
            <button type="button" aria-pressed={!mei} onClick={() => setF({ ...f, tipo: 'MOTORISTA', baseDias: 'SEG_SEX' })}><b>Motorista</b><span>Contrato pago por semana, com nota a cada semana.</span></button>
          </div>
        </section>
        <section className={css.secao}>
          <h3><span className={css.num}>2</span>Quem é</h3>
          <div onBlur={() => setTocado((t) => ({ ...t, nome: true }))}>
            <CampoTexto id="p-nome" rotulo="Nome completo" valor={f.nome} placeholder="Ana Souza" onChange={(v) => setF({ ...f, nome: v })} />
            {tocado.nome && erros.nome && <small className={css.erroCampo}>{erros.nome}</small>}
          </div>
          <div className={css.grade2}>
            <CampoTexto id="p-doc" rotulo={mei ? 'CNPJ do MEI' : 'Documento (opcional)'} valor={f.documento} placeholder={mei ? '00.000.000/0001-00' : 'CPF ou CNPJ'} onChange={(v) => setF({ ...f, documento: v })} />
            <CampoTexto id="p-fun" rotulo={mei ? 'Função' : 'Categoria / cliente'} valor={f.funcao} placeholder={mei ? 'Vendedor externo' : 'Cobra · 814'} onChange={(v) => setF({ ...f, funcao: v })} />
          </div>
          <CampoTexto id="p-pix" rotulo="Chave Pix (opcional)" valor={f.chavePix} onChange={(v) => setF({ ...f, chavePix: v })} />
        </section>
        <section className={css.secao}>
          <h3><span className={css.num}>3</span>Valores</h3>
          <div onBlur={() => setTocado((t) => ({ ...t, valor: true }))}>
            <CampoReais id="p-val" rotulo={mei ? 'Valor do contrato (mensal)' : 'Valor mensal'} valorCent={f.valorCent} onChange={(c) => setF({ ...f, valorCent: c })} />
            {tocado.valor && erros.valor && <small className={css.erroCampo}>{erros.valor}</small>}
          </div>
          <Alternar<BaseDias> rotulo="Dias que contam para o valor do dia" valor={f.baseDias} onChange={(v) => setF({ ...f, baseDias: v })}
            opcoes={[['SEG_SAB', 'Segunda a sábado'], ['SEG_SEX', 'Segunda a sexta']]} />
          <p className={css.hint}>Valor do dia = valor mensal ÷ dias do mês nessa base, já sem os feriados da empresa.</p>
        </section>
        <section className={css.secao}>
          <h3><span className={css.num}>4</span>Começa em</h3>
          <label className={css.campo} htmlFor="p-ini"><span>Primeira competência</span>
            <span className={css.input}><input id="p-ini" type="month" value={f.inicio} onChange={(e) => e.target.value && setF({ ...f, inicio: e.target.value })} /></span>
            <small>Aparece desta competência em diante. Meses anteriores não mudam.</small></label>
        </section>
        {erro && <p className={css.erro} role="alert">{erro}</p>}
        <div className={css.barraFixa}>
          <button type="button" className={css.btnTexto} onClick={onVoltar}>Cancelar</button>
          <Botao type="submit" variante="coral" className={css.btnPri} disabled={salvando}>{salvando ? 'Adicionando…' : `Adicionar ${mei ? 'MEI' : 'motorista'}`}</Botao>
        </div>
      </form>
    </div>
  );
}
