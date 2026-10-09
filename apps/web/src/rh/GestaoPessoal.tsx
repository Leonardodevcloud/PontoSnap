import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import QRCode from 'qrcode';
import { docIncompleto, fmtDoc, lerReais, mascaraDoc, minutosParaHhMm } from '../lib/formato';
import { arquivoParaBase64, salvarBlob } from '../lib/download';
import { brCodePix, normalizarChave } from '../lib/pix';
import { Botao } from '../components/Botao';
import type {
  BaseDias, PessoaTipo, PessoalCompetencia, PessoalDebito, PessoalHistorico, PessoalPessoaHistorico, PessoalNfArquivo, PessoalPagamentoMes, PessoalLinhaClt, PessoalLinhaMei, PessoalLinhaMot, PessoalPadrao, PessoalPessoa, VtTipo,
} from '../tipos';
import vt from './VisaoTodos.module.css';
import css from './GestaoPessoal.module.css';

/**
 * Gestão de Pessoal — fechamento do mês da empresa ativa.
 * CLT vem do ponto (sem cadastro aqui); MEI e motoristas são cadastrados aqui.
 * Estado de navegação na URL: ?mes=YYYY-MM&aba=...&novo=MEI|MOTORISTA
 */

type Aba = 'folha' | 'beneficios' | 'mei' | 'motoristas' | 'debitos' | 'historico';
const ABAS: Aba[] = ['folha', 'beneficios', 'mei', 'motoristas', 'debitos', 'historico'];

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
const numeroBr = lerReais;
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
  const ir = useCallback((p: { mes?: string; aba?: Aba; novo?: string | null; pessoa?: string | null }) => {
    setParams((at) => {
      const n = new URLSearchParams(at);
      if (p.pessoa !== undefined) { if (p.pessoa) n.set('pessoa', p.pessoa); else n.delete('pessoa'); }
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
  const [pix, setPix] = useState<PixAlvo | null>(null);
  const [comoAberto, setComoAberto] = useState(false);
  const ultimaAba = useRef<Aba>('folha');
  useEffect(() => { if (aba !== 'historico') ultimaAba.current = aba; setComoAberto(false); }, [aba]);
  const [verNf, setVerNf] = useState<{ arquivo: PessoalNfArquivo; titulo: string } | null>(null);
  const gatilho = useRef<HTMLElement | null>(null);

  const recarregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    try { setDados(await api.get<PessoalCompetencia>(`/pessoal/competencia?comp=${mes}`)); }
    catch (e) { setErro((e as Error).message); setDados(null); }
    finally { setCarregando(false); }
  }, [mes]);
  useEffect(() => { void recarregar(); }, [recarregar, sessao?.tenantId]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); }, [toast]);

  /**
   * Pagamento sem esperar o servidor: a tela muda na hora e a gravação vai em
   * segundo plano (sem recalcular o mês inteiro). Se falhar, volta o que era.
   */
  function aplicarPagamento(tipo: 'MEI' | 'MOTORISTA', id: string, pg: PessoalPagamentoMes, semanas: string[]) {
    setDados((at) => at && ({
      ...at,
      mei: tipo !== 'MEI' ? at.mei : at.mei.map((m) => (m.id !== id ? m : { ...m, lanc: { ...m.lanc, ...pg } })),
      motoristas: tipo !== 'MOTORISTA' ? at.motoristas : at.motoristas.map((m) => (m.id !== id ? m : {
        ...m, pagamento: pg, semanas: m.semanas.map((s) => (semanas.includes(s.inicio) ? { ...s, pago: pg.pago } : s)),
      })),
    }));
  }
  function registrarPagamento(r: PixRegistro, pago: boolean, valorCent: number | null) {
    const antes = { pago: r.pago, valorPagoCent: r.valorPagoCent, pagoEm: r.pagoEm };
    const agora: PessoalPagamentoMes = pago ? { pago: true, valorPagoCent: valorCent, pagoEm: new Date().toISOString() } : { pago: false, valorPagoCent: null, pagoEm: null };
    aplicarPagamento(r.pessoaTipo, r.pessoaId, agora, r.semanas);
    const enviar = (pg: PessoalPagamentoMes) => api.put<PessoalPagamentoMes>('/pessoal/pagamento', {
      pessoaTipo: r.pessoaTipo, pessoaId: r.pessoaId, competencia: mes, semanas: r.semanas,
      pago: pg.pago, valorPago: pg.pago && pg.valorPagoCent != null ? pg.valorPagoCent / 100 : null,
    });
    enviar(agora)
      .then((res) => aplicarPagamento(r.pessoaTipo, r.pessoaId, res, r.semanas))
      .catch((e) => { aplicarPagamento(r.pessoaTipo, r.pessoaId, antes, r.semanas); setErro(`Não deu pra salvar o pagamento de ${r.nome}: ${(e as Error).message}`); });
    avisar(pago ? `${r.nome}: pago ${brl(valorCent ?? 0)} às ${fmtHoraCurta(agora.pagoEm!)}.` : `${r.nome}: pagamento desfeito.`, async () => {
      aplicarPagamento(r.pessoaTipo, r.pessoaId, antes, r.semanas);
      const res = await enviar(antes.pago ? antes : { pago: false, valorPagoCent: null, pagoEm: null });
      aplicarPagamento(r.pessoaTipo, r.pessoaId, antes.pago ? { ...res, pagoEm: antes.pagoEm ?? res.pagoEm } : res, r.semanas);
    });
  }

  const abrir = (p: Painel, el?: HTMLElement | null) => { gatilho.current = el ?? (document.activeElement as HTMLElement); setPainel(p); };
  const fecharPainel = () => { setPainel(null); setTimeout(() => gatilho.current?.focus?.(), 0); };
  const avisar = (msg: string, desfazer?: () => Promise<void>) => setToast({ msg, desfazer });

  const empresas = [...new Set([...(dados?.mei ?? []), ...(dados?.motoristas ?? [])].map((x) => x.empresa).filter((x): x is string => !!x))].sort();
  if (novo === 'MEI' || novo === 'MOTORISTA') {
    return <FormPrestador tipoInicial={novo} mes={mes} empresas={empresas} onVoltar={() => ir({ novo: null })}
      onCriado={(nome, tipo) => { ir({ novo: null, aba: tipo === 'MEI' ? 'mei' : 'motoristas' }); avisar(`${nome} adicionado a partir de ${mesCurto(mes)}.`); void recarregar(); }} />;
  }

  const d = dados;
  const fechado = !!d?.fechado;
  const filtra = <T extends { nome: string; empresa?: string | null }>(l: T[]) => (busca
    ? l.filter((x) => `${x.nome} ${x.empresa ?? ''}`.toLowerCase().includes(busca.toLowerCase())) : l);
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

  const visao: 'fech' | 'hist' = aba === 'historico' ? 'hist' : 'fech';
  const comoTexto: Record<Exclude<Aba, 'historico'>, ReactNode> = {
    folha: <>Valor do dia = salário ÷ dias de trabalho de {mesCurto(mes)}. Extras, faltas e atrasos vêm do ponto. Hora extra de quem tem banco de horas vai pro banco e não entra em R$. Indenização de intervalo é paga sempre (não vai pro banco).</>,
    beneficios: d ? <>Hoje você carrega <b>{mesCurto(d.proxima)}</b>. O que foi pago para <b>{mesCurto(mes)}</b> e não foi usado (feriado, falta, férias, atestado) volta
      como <b>acerto</b> e é abatido aqui. Não precisa lançar "VT a mais" em Débitos. A cesta só é paga sem falta no mês e depois da carência.
      {d.clt.some((c) => c.beneficios.pagosEstimado) && <> Como {mesCurto(mes)} ainda não foi fechado no sistema, os dias pagos foram estimados pela escala.</>}</> : null,
    mei: <><b>Bruto</b> = contrato + extras + feriados trabalhados − faltas + meta. É o valor da nota fiscal. <b>Líquido</b> = bruto − débitos − meta que já foi paga antes. Valor-hora = contrato ÷ (dias do mês × 8h); extra × 1,5.</>,
    motoristas: <>Diária = valor mensal ÷ dias do mês (sem feriados). Cada semana já vem com os dias previstos; ajuste no painel se ele faltou ou trabalhou a mais. <b>Líquido</b> = total das notas − débitos.</>,
    debitos: <>Débitos parcelados são descontados um pouco por mês, na folha (CLT) ou no pagamento (MEI e motoristas). A última parcela ajusta os centavos.</>,
  };
  const acaoAba = aba === 'beneficios' && !fechado && d
    ? <Botao variante="ghost" className={css.btnSec} onClick={(e) => abrir({ tipo: 'padrao' }, e.currentTarget)}>{d.padrao ? 'Alterar padrão da empresa' : 'Definir padrão da empresa'}</Botao>
    : aba === 'debitos' && !fechado ? <Botao variante="ghost" className={css.btnSec} onClick={(e) => abrir({ tipo: 'debito' }, e.currentTarget)}>Adicionar débito</Botao>
    : null;

  return (
    <div className={css.pagina}>
      <div className={css.topo}>
        <h2>Gestão de pessoal</h2>
        <div className={css.seg} role="group" aria-label="Visão">
          <button type="button" aria-pressed={visao === 'fech'} onClick={() => ir({ aba: ultimaAba.current })}>Fechamento do mês</button>
          <button type="button" aria-pressed={visao === 'hist'} onClick={() => ir({ aba: 'historico' })}>Histórico</button>
        </div>
      </div>
      {erro && <p className={css.erro} role="alert">{erro}</p>}

      {visao === 'hist' && (
        <AbaHistorico sel={params.get('pessoa')} onSel={(k) => ir({ pessoa: k })} onVerNf={(arquivo, titulo) => setVerNf({ arquivo, titulo })}
          onAbrirMes={(comp, tipo, id) => { ir({ mes: comp, aba: tipo === 'CLT' ? 'folha' : tipo === 'MEI' ? 'mei' : 'motoristas' }); abrir({ tipo: tipo === 'CLT' ? 'clt' : tipo === 'MEI' ? 'mei' : 'mot', id }); }} />
      )}

      {visao === 'fech' && <>
        <div className={css.barraMes}>
          <div className={css.comp}>
            <button aria-label="Mês anterior" onClick={() => ir({ mes: somarMes(mes, -1) })}>‹</button>
            <input type="month" aria-label="Competência" value={mes} onChange={(e) => e.target.value && ir({ mes: e.target.value })} />
            <button aria-label="Próximo mês" onClick={() => ir({ mes: somarMes(mes, 1) })} disabled={mes >= somarMes(mesAtual(), 1)}>›</button>
          </div>
          {d && (fechado
            ? <span className={`${css.chip} ${css.chipOk}`} title={`Fechado em ${new Date(d.fechadoEm!).toLocaleDateString('pt-BR')}`}>fechado em {new Date(d.fechadoEm!).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>
            : <span className={`${css.chip} ${css.chipAberto}`}>em aberto</span>)}
          <span className={css.esp} />
          {!fechado && <Botao variante="ghost" className={css.btnSec} onClick={() => ir({ novo: aba === 'motoristas' ? 'MOTORISTA' : 'MEI' })}>Adicionar MEI ou motorista</Botao>}
          {fechado
            ? (sessao?.perfil === 'ADMIN_CLIENTE' && <Botao variante="ghost" className={css.btnSec} onClick={reabrir}>Reabrir {mesCurto(mes)}</Botao>)
            : <Botao variante="coral" className={css.btnPri} disabled={!d} onClick={() => setDialogo({ tipo: 'fechar' })}>Fechar {mesCurto(mes)}</Botao>}
        </div>
        {fechado && <p className={css.fechadoLinha}>Os números de {mesCurto(mes)} são o retrato do fechamento e não mudam mais. Nota fiscal e pagamento ainda podem ser registrados.</p>}

        <nav className={css.trilha} aria-label="Passos do fechamento">
          {passos.map((p, i) => (
            <button key={p.titulo} className={`${css.passo} ${p.aba === aba || (p.aba === 'mei' && aba === 'motoristas') ? css.passoAtual : ''}`}
              aria-current={p.aba === aba ? 'step' : undefined}
              onClick={() => (p.aba ? ir({ aba: p.aba }) : !fechado && d && setDialogo({ tipo: 'fechar' }))}>
              <span className={`${css.bola} ${p.status === 'ok' ? css.bolaOk : p.status === 'aviso' ? css.bolaAviso : ''}`}>{p.status === 'ok' ? '✓' : p.status === 'aviso' ? '!' : i + 1}</span>
              <b>{p.titulo}</b><span className={css.passoTxt} title={p.texto}>{p.texto}</span>
            </button>
          ))}
        </nav>

        <div className={css.abas} role="tablist" aria-label="Seções do fechamento">
          {([
            ['folha', 'Folha CLT', d?.clt.length], ['beneficios', 'Benefícios', d?.clt.length], ['mei', 'MEI', d?.mei.length],
            ['motoristas', 'Motoristas', d?.motoristas.length], ['debitos', 'Débitos', d?.debitos.length],
          ] as [Aba, string, number | undefined][]).map(([k, t, n]) => (
            <button key={k} role="tab" aria-selected={aba === k} className={`${css.aba} ${aba === k ? css.abaOn : ''}`} onClick={() => ir({ aba: k })}>
              {t} {n != null && <span className={css.cont}>{n}</span>}
              {k === 'mei' && (d?.pendencias.nfMei ?? 0) > 0 && <span className={css.contAlerta}>NF</span>}
              {k === 'motoristas' && (d?.pendencias.nfMotorista ?? 0) > 0 && <span className={css.contAlerta}>NF</span>}
            </button>
          ))}
        </div>

        {d && aba !== 'historico' && <ResumoAba aba={aba} d={d} />}
        {d && aba === 'folha' && <AvisoPrevia />}

        <div className={css.barra}>
          <input className={vt.busca} type="search" placeholder={aba === 'mei' || aba === 'motoristas' ? 'Buscar pessoa ou empresa' : 'Buscar pessoa'} aria-label="Buscar pessoa" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <button type="button" className={css.como} aria-expanded={comoAberto} aria-controls="como-calc" onClick={() => setComoAberto(!comoAberto)}>
            <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 11v6M12 7.5v.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
            {aba === 'beneficios' ? 'Como funciona o acerto' : 'Como é calculado'}
          </button>
          <span className={css.esp} />
          {acaoAba}
        </div>
        {comoAberto && aba !== 'historico' && <div id="como-calc" className={css.nota}>{comoTexto[aba]}</div>}

      {carregando && !d && <p className={css.carregando}>Calculando {mesLongo(mes)}…</p>}

      {d && aba === 'folha' && <TabelaFolha linhas={filtra(d.clt)} debitos={d.debitos} mes={mes} onAbrir={(id, el) => abrir({ tipo: 'clt', id }, el)} onPix={setPix} />}
      {d && aba === 'beneficios' && <TabelaBeneficios linhas={filtra(d.clt)} d={d} onAbrir={(id, el) => abrir({ tipo: 'clt', id }, el)} />}
      {d && aba === 'mei' && <TabelaMei linhas={filtra(d.mei)} debitos={d.debitos} onAbrir={(id, el) => abrir({ tipo: 'mei', id }, el)} onNovo={fechado ? undefined : () => ir({ novo: 'MEI' })}
        onPix={setPix} onPago={(l, v) => registrarPagamento(registroMei(l), v, l.liquidoCent)} onVerNf={(arquivo, titulo) => setVerNf({ arquivo, titulo })} />}
      {d && aba === 'motoristas' && <TabelaMot linhas={filtra(d.motoristas)} debitos={d.debitos} onAbrir={(id, el) => abrir({ tipo: 'mot', id }, el)} onNovo={fechado ? undefined : () => ir({ novo: 'MOTORISTA' })}
        onPix={setPix} onPago={(l, v) => registrarPagamento(registroMot(l), v, l.liquidoCent)} />}
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

      </>}

      {painel && d && (
        <PainelLateral onFechar={fecharPainel} titulo={
          linhaClt?.nome ?? linhaMei?.nome ?? linhaMot?.nome ?? (painel.tipo === 'padrao' ? 'Padrão de benefícios' : 'Adicionar débito')}
          sub={linhaClt ? `${linhaClt.config.cargo ? `${linhaClt.config.cargo} · ` : ''}CLT · ${mesLongo(mes)}` : linhaMei ? `MEI · ${fmtDoc(linhaMei.documento) ?? 'sem CNPJ'} · ${mesLongo(mes)}`
            : linhaMot ? `Motorista · ${linhaMot.funcao ?? ''} · ${mesLongo(mes)}`
            : painel.tipo === 'padrao' ? 'Vale para todos os CLT sem valor próprio' : `Desconto parcelado a partir de ${mesCurto(mes)}`}>
          {painel.tipo === 'padrao' && <PainelPadrao d={d} onSalvo={async (msg) => { await recarregar(); fecharPainel(); avisar(msg); }} />}
          {linhaClt && <PainelClt l={linhaClt} d={d} mes={mes} fechado={fechado} onSalvo={recarregar} onAviso={avisar}
            onTirar={() => setDialogo({ tipo: 'tirar', pessoaTipo: 'CLT', pessoaId: linhaClt.empregadoId, nome: linhaClt.nome })} />}
          {linhaMei && <PainelMei key={linhaMei.id} l={linhaMei} mes={mes} fechado={fechado} empresas={empresas} onContrato={async () => { await recarregar(); avisar(`Contrato de ${linhaMei.nome} atualizado.`); }} onSalvo={async () => { await recarregar(); fecharPainel(); avisar(`Lançamento de ${linhaMei.nome} salvo.`); }} onRecarregar={recarregar} onAviso={avisar}
            onTirar={() => setDialogo({ tipo: 'tirar', pessoaTipo: 'MEI', pessoaId: linhaMei.id, nome: linhaMei.nome })} />}
          {linhaMot && <PainelMot key={linhaMot.id} l={linhaMot} mes={mes} fechado={fechado} empresas={empresas} onContrato={async () => { await recarregar(); avisar(`Contrato de ${linhaMot.nome} atualizado.`); }} onSalvo={async () => { await recarregar(); fecharPainel(); avisar(`Semanas de ${linhaMot.nome} salvas.`); }} onRecarregar={recarregar} onAviso={avisar}
            onTirar={() => setDialogo({ tipo: 'tirar', pessoaTipo: 'MOTORISTA', pessoaId: linhaMot.id, nome: linhaMot.nome })} />}
          {painel.tipo === 'debito' && <PainelDebito mes={mes} onSalvo={async (desc) => { await recarregar(); fecharPainel(); avisar(`Débito "${desc}" adicionado.`); }} />}
        </PainelLateral>
      )}

      {dialogo?.tipo === 'tirar' && <DialogoTirar nome={dialogo.nome} mes={mes} onCancelar={() => setDialogo(null)} onConfirmar={tirar} />}
      {dialogo?.tipo === 'fechar' && d && (
        <Dialogo titulo={`Fechar ${mesLongo(mes)}?`} onCancelar={() => setDialogo(null)} confirmar={`Fechar ${mesCurto(mes)}`} onConfirmar={fecharMes}>
          <p className={css.hint}>Os números de {mesCurto(mes)} ficam congelados como estão agora, e os dias de benefício carregados para {mesCurto(d.proxima)} viram a base do acerto do mês que vem.</p>
          <div className={css.fecharResumo}>
            <Linha2 k={`Pessoas · ${d.totais.pessoas.clt} CLT, ${d.totais.pessoas.mei} MEI, ${d.totais.pessoas.motoristas} motoristas`} v={String(d.totais.pessoas.clt + d.totais.pessoas.mei + d.totais.pessoas.motoristas)} />
            <Linha2 k={<span title="Salário − faltas + extras + benefícios (CLT) e valor das notas (MEI e motoristas), sem tirar o que já foi pago antes">Custo bruto da empresa</span>} v={brl(d.totais.brutoCent)} />
            <Linha2 k={<span className={css.mute}>− débitos, acerto de benefícios e metas já pagas</span>} v={brl(-d.totais.abatimentosCent)} cls={css.neg} />
            <Linha2 cls={css.grande} k="Líquido do fechamento" v={brl(d.totais.liquidoCent)} />
          </div>
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

      {pix && d && <ModalPix key={`${pix.nome}`} alvo={atualizarAlvo(pix, d)} mes={mes} onFechar={() => setPix(null)}
        onRegistrar={(r, pago, valor) => registrarPagamento(r, pago, valor)} />}
      {verNf && <VisualizarNf arquivo={verNf.arquivo} titulo={verNf.titulo} onFechar={() => setVerNf(null)}
        onBaixar={async () => { try { salvarBlob(await api.baixar(`/pessoal/nf/${verNf.arquivo.id}`), verNf.arquivo.nome); } catch (e) { setErro((e as Error).message); } }} />}

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

function TabelaFolha({ linhas, debitos, mes, onAbrir, onPix }: { linhas: PessoalLinhaClt[]; debitos: PessoalDebito[]; mes: string; onAbrir: (id: string, el: HTMLElement) => void; onPix: (a: PixAlvo) => void }) {
  const t = linhas.reduce((a, l) => ({ sal: a.sal + (l.salarioCent ?? 0), pr: a.pr + l.proventosCent, de: a.de + l.descontosCent, db: a.db + l.debitosCent, li: a.li + l.liquidoSalarioCent, br: a.br + l.custoBrutoCent }), { sal: 0, pr: 0, de: 0, db: 0, li: 0, br: 0 });
  return (
    <div className={vt.tab}><div className={vt.scroll}><table className={`${vt.table} ${css.compacta}`}>
      <thead><tr><th>Colaborador</th><th className={vt.n}>Salário</th><th className={vt.n} title={`Salário ÷ dias de trabalho de ${mesCurto(mes)}`}>Valor do dia</th>
        <th className={vt.n} title="Hora extra paga + indenização de intervalo. Hora extra de quem tem banco vai pro banco e não entra em R$.">Extras e intervalo</th><th className={vt.n}>Faltas e atrasos</th><th className={vt.n}>Débitos</th><th className={vt.n} title="Simulação a partir do ponto, sem INSS, IRRF e encargos. O valor real vem da contabilidade.">Líquido (prévia)</th>
        <th className={vt.n} title="Salário − descontos + extras + benefícios, sem tirar débitos">Custo bruto</th><th aria-label="Abrir" /></tr></thead>
      <tbody>
        {linhas.length === 0 && <Vazio cols={9}>Nenhum funcionário ativo no ponto. Cadastre em <Link to="/rh/funcionarios">Funcionários</Link>.</Vazio>}
        {linhas.map((l) => (
          <Linha key={l.empregadoId} rotulo={`Abrir ${l.nome}`} onAbrir={(el) => onAbrir(l.empregadoId, el)}>
            <td className={vt.nome}><span className={css.nomeLinha}>{l.nome}<BotaoPix nome={l.nome} chave={l.config.chavePix} onPix={() => onPix(pixClt(l, debitos))} /></span><small>{l.config.cargo ?? (l.matricula ? `#${l.matricula}` : 'CLT')}</small>
              {l.erro && <span className={`${vt.pill} ${vt.pillWarn}`} title={l.erro}>sem escala</span>}
              {l.salarioCent == null && <span className={`${vt.pill} ${vt.pillWarn}`}>sem salário</span>}</td>
            <td className={vt.n}>{l.salarioCent == null ? '—' : brl(l.salarioCent)}{l.salarioPartes.length > 1 && <small className={css.sub} title={l.salarioPartes.map((p) => `${brl(p.salarioCent)} de ${fmtDia(p.desde)} a ${fmtDia(p.ate)}`).join(' · ')}>proporcional · mudou {fmtDia(l.salarioPartes[1]!.desde)}</small>}</td>
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

/** Cesta do mês: paga, perdida por falta, em carência ou sem cesta. */
function StatusCesta({ l }: { l: PessoalLinhaClt }) {
  const b = l.beneficios;
  if (b.cestaStatus === 'PAGA') return <>{brl(b.cestaCent)}</>;
  if (b.cestaStatus === 'PERDIDA_FALTA') return <span className={`${vt.pill} ${vt.pillErr}`} title="Faltou no mês: a cesta não é paga">perdida · falta {l.faltasDias.slice(0, 1).map(fmtDia).join('')}</span>;
  if (b.cestaStatus === 'CARENCIA') return <span className={`${vt.pill} ${vt.pillMute}`} title="Ainda na carência">a partir de {b.cestaDesde ? mesCurto(b.cestaDesde) : '—'}</span>;
  return <>—</>;
}

function TabelaBeneficios({ linhas, d, onAbrir }: { linhas: PessoalLinhaClt[]; d: PessoalCompetencia; onAbrir: (id: string, el: HTMLElement) => void }) {
  const t = linhas.reduce((a, l) => ({ vr: a.vr + l.beneficios.vrProxCent, ce: a.ce + l.beneficios.cestaCent, vt: a.vt + l.beneficios.vtProxCent, ac: a.ac + l.beneficios.acertoCent, ca: a.ca + l.beneficios.cargaCent }), { vr: 0, ce: 0, vt: 0, ac: 0, ca: 0 });
  return (
    <div className={vt.tab}><div className={vt.scroll}><table className={`${vt.table} ${css.compacta}`}>
      <thead><tr><th>Colaborador</th><th className={vt.n}>Dias de {mesCurto(d.proxima)}</th><th className={vt.n}>VR / VA</th>
        <th className={vt.n} title={`Cesta de ${mesCurto(d.competencia)}: só pra quem não faltou no mês e já passou da carência`}>Cesta</th><th className={vt.n}>VT / combustível</th>
        <th className={vt.n}>Acerto de {mesCurto(d.competencia)}</th><th className={vt.n}>A carregar</th><th aria-label="Abrir" /></tr></thead>
      <tbody>
        {linhas.length === 0 && <Vazio cols={8}>Nenhum funcionário ativo no ponto.</Vazio>}
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
              <td className={vt.n}><StatusCesta l={l} /></td>
              <td className={vt.n}>{c.vtTipo === 'NENHUM' ? '—' : brl(b.vtProxCent)}<small className={css.sub}>{c.vtTipo === 'FIXO' ? 'combustível · fixo' : c.vtTipo === 'DIA' ? `VT ${brl(c.vtValorCent)}/dia` : ''}</small></td>
              <td className={vt.n}>{b.acertoCent ? <><span className={vt.neg}>{brl(-b.acertoCent)}</span>
                <small className={`${css.sub} ${css.subCorta}`} title={b.naoUsados.map((x) => `${ROT_MOTIVO[x.motivo]} ${fmtDia(x.data)}`).join(', ')}>{b.naoUsados.length} dia{b.naoUsados.length > 1 ? 's' : ''}: {b.naoUsados.slice(0, 2).map((x) => `${ROT_MOTIVO[x.motivo]} ${fmtDia(x.data)}`).join(', ')}{b.naoUsados.length > 2 ? '…' : ''}</small></> : '—'}</td>
              <td className={`${vt.n} ${css.forte}`}>{brl(b.cargaCent)}</td>
            </Linha>
          );
        })}
      </tbody>
      {linhas.length > 0 && <tfoot><tr className={vt.tot}><td>Total · {linhas.length}</td><td /><td className={vt.n}>{brl(t.vr)}</td><td className={vt.n}>{brl(t.ce)}</td><td className={vt.n}>{brl(t.vt)}</td>
        <td className={vt.n}>{brl(-t.ac)}</td><td className={vt.n}>{brl(t.ca)}</td><td /></tr></tfoot>}
    </table></div></div>
  );
}

function TabelaMei({ linhas, debitos, onAbrir, onNovo, onPix, onPago, onVerNf }: {
  linhas: PessoalLinhaMei[]; debitos: PessoalDebito[]; onAbrir: (id: string, el: HTMLElement) => void; onNovo?: () => void;
  onPix: (a: PixAlvo) => void; onPago: (l: PessoalLinhaMei, pago: boolean) => void; onVerNf: (a: PessoalNfArquivo, titulo: string) => void;
}) {
  const t = linhas.reduce((a, l) => ({ c: a.c + l.valorCent, b: a.b + l.brutoCent, li: a.li + l.liquidoCent, pg: a.pg + (l.lanc.pago ? (l.lanc.valorPagoCent ?? l.liquidoCent) : 0) }), { c: 0, b: 0, li: 0, pg: 0 });
  return (
    <div className={vt.tab}><div className={vt.scroll}><table className={`${vt.table} ${css.compacta}`}>
      <thead><tr><th>Colaborador MEI</th><th>Empresa</th><th className={vt.n}>Contrato</th><th className={vt.n}>Extras</th><th className={vt.n}>Faltas</th>
        <th className={vt.n}>Meta</th><th className={vt.n}>Bruto (NF)</th><th className={vt.n}>Débitos</th><th className={vt.n}>Líquido</th><th className={vt.n}>Pagamento</th><th aria-label="Abrir" /></tr></thead>
      <tbody>
        {linhas.length === 0 && <Vazio cols={11}>Nenhum MEI neste mês. {onNovo && <button className={css.link} onClick={onNovo}>Adicionar MEI</button>}</Vazio>}
        {linhas.map((l) => (
          <Linha key={l.id} rotulo={`Abrir lançamento de ${l.nome}`} onAbrir={(el) => onAbrir(l.id, el)}>
            <td className={vt.nome}><span className={css.nomeLinha}>{l.nome}<BotaoPix chave={l.chavePix} nome={l.nome} onPix={() => onPix(pixMei(l, debitos))} /></span><small>{fmtDoc(l.documento) ?? l.funcao ?? 'MEI'}</small></td>
            <td className={css.empresa}>{l.empresa ?? <span className={css.mute}>—</span>}</td>
            <td className={vt.n}>{brl(l.valorCent)}<small className={css.sub} title={`${l.diasMes} dias no mês`}>{brl(l.valorDiaCent)}/dia</small></td>
            <td className={vt.n}>{l.heCent + l.feriadosCent ? <><span className={vt.pos}>{brl(l.heCent + l.feriadosCent)}</span>
              <small className={css.sub}>{[l.lanc.heMin ? minutosParaHhMm(l.lanc.heMin) : '', l.lanc.feriadosTrab ? `${l.lanc.feriadosTrab} feriado${l.lanc.feriadosTrab > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')}</small></> : '—'}</td>
            <td className={vt.n}>{l.faltasCent ? <><span className={vt.neg}>{brl(-l.faltasCent)}</span><small className={css.sub}>{l.lanc.faltas} falta{l.lanc.faltas > 1 ? 's' : ''}</small></> : '—'}</td>
            <td className={vt.n}>{!l.lanc.metaCent ? '—' : <>{brl(l.lanc.metaCent)}
              <small className={`${css.sub} ${l.lanc.metaPaga ? css.subOk : css.subWarn}`}>{l.lanc.metaPaga ? 'já paga' : 'a pagar'}</small></>}</td>
            <td className={`${vt.n} ${css.forte}`}>{brl(l.brutoCent)}
              <CelulaNf numero={l.lanc.nfNumero} arquivo={l.lanc.nfArquivo} onVer={(a) => onVerNf(a, `Nota de ${l.nome}`)} /></td>
            <td className={vt.n}>{l.debitosCent ? <span className={vt.neg}>{brl(-l.debitosCent)}</span> : '—'}</td>
            <td className={`${vt.n} ${css.forte}`}>{brl(l.liquidoCent)}</td>
            <td className={vt.n}><CelulaPagamento nome={l.nome} pago={l.lanc.pago} valorPagoCent={l.lanc.valorPagoCent} liquidoCent={l.liquidoCent} pagoEm={l.lanc.pagoEm} onMudar={(v) => onPago(l, v)} /></td>
          </Linha>
        ))}
      </tbody>
      {linhas.length > 0 && <tfoot><tr className={vt.tot}><td>Total · {linhas.length}</td><td /><td className={vt.n}>{brl(t.c)}</td><td /><td /><td />
        <td className={vt.n}>{brl(t.b)}</td><td /><td className={vt.n}>{brl(t.li)}</td>
        <td className={vt.n}>{brl(t.pg)}<small className={css.sub}>{linhas.filter((l) => l.lanc.pago).length} de {linhas.length} pagos</small></td><td /></tr></tfoot>}
    </table></div></div>
  );
}

function TabelaMot({ linhas, debitos, onAbrir, onNovo, onPix, onPago }: {
  linhas: PessoalLinhaMot[]; debitos: PessoalDebito[]; onAbrir: (id: string, el: HTMLElement) => void; onNovo?: () => void;
  onPix: (a: PixAlvo) => void; onPago: (l: PessoalLinhaMot, pago: boolean) => void;
}) {
  const total = linhas.reduce((a, l) => a + l.totalCent, 0);
  const pagoTot = linhas.reduce((a, l) => a + (l.pagamento.pago ? (l.pagamento.valorPagoCent ?? l.liquidoCent) : 0), 0);
  return (
    <div className={vt.tab}><div className={vt.scroll}><table className={`${vt.table} ${css.compacta}`}>
      <thead><tr><th>Motorista</th><th>Empresa</th><th className={vt.n}>Mensal</th><th className={vt.n}>Dias no mês</th><th className={vt.n}>Adicionais</th>
        <th className={vt.n}>Total das NFs</th><th className={vt.n}>Notas</th><th className={vt.n}>Pagamento</th><th aria-label="Abrir" /></tr></thead>
      <tbody>
        {linhas.length === 0 && <Vazio cols={9}>Nenhum motorista neste mês. {onNovo && <button className={css.link} onClick={onNovo}>Adicionar motorista</button>}</Vazio>}
        {linhas.map((l) => {
          const comDias = l.semanas.filter((s) => s.dias > 0);
          const pagas = comDias.filter((s) => s.pago).length;
          const semNf = comDias.filter((s) => !s.nfNumero && !s.nfArquivo).length;
          const pago = l.pagamento.pago || (comDias.length > 0 && pagas === comDias.length);
          return (
            <Linha key={l.id} rotulo={`Abrir semanas de ${l.nome}`} onAbrir={(el) => onAbrir(l.id, el)}>
              <td className={vt.nome}><span className={css.nomeLinha}>{l.nome}<BotaoPix chave={l.chavePix} nome={l.nome} onPix={() => onPix(pixMot(l, debitos))} /></span><small>{l.funcao ?? 'motorista'} · {l.baseDias === 'SEG_SAB' ? 'seg–sáb' : 'seg–sex'}</small></td>
              <td className={css.empresa}>{l.empresa ?? <span className={css.mute}>—</span>}</td>
              <td className={vt.n}>{brl(l.valorCent)}<small className={css.sub} title={`${l.diasMes} dias no mês`}>{brl(l.diariaCent)}/dia</small></td>
              <td className={vt.n}>{l.semanas.reduce((a, s) => a + s.dias, 0)}</td>
              <td className={vt.n}>{l.semanas.some((s) => s.adicionalCent) ? brl(l.semanas.reduce((a, s) => a + s.adicionalCent, 0)) : '—'}</td>
              <td className={`${vt.n} ${css.forte}`}>{brl(l.totalCent)}{l.debitosCent > 0 && <small className={css.sub}>líquido {brl(l.liquidoCent)}</small>}</td>
              <td className={vt.n}>{semNf ? <span className={`${vt.pill} ${vt.pillErr}`}>{semNf} sem NF</span> : <span className={`${vt.pill} ${vt.pillMute}`}>{comDias.length ? 'em dia' : '—'}</span>}</td>
              <td className={vt.n}>{comDias.length > 0 && <CelulaPagamento nome={l.nome} pago={pago} valorPagoCent={l.pagamento.valorPagoCent} liquidoCent={l.liquidoCent} pagoEm={l.pagamento.pagoEm}
                parcial={!pago && pagas > 0 ? `${pagas}/${comDias.length} semanas` : undefined} onMudar={(v) => onPago(l, v)} />}</td>
            </Linha>
          );
        })}
      </tbody>
      {linhas.length > 0 && <tfoot><tr className={vt.tot}><td>Total · {linhas.length}</td><td /><td /><td /><td /><td className={vt.n}>{brl(total)}</td><td />
        <td className={vt.n}>{brl(pagoTot)}</td><td /></tr></tfoot>}
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
    <div className={vt.tab}><div className={vt.scroll}><table className={`${vt.table} ${css.compacta}`}>
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
  // Enquanto o campo está em foco, o texto é do usuário: nada de reformatar a
  // cada tecla (era isso que jogava os dígitos pra depois da vírgula). Formata
  // ao sair do campo. De fora, só sincroniza quando não está sendo editado.
  const [txt, setTxt] = useState(reaisTxt(valorCent));
  const editando = useRef(false);
  useEffect(() => { if (!editando.current) setTxt(reaisTxt(valorCent)); }, [valorCent]);
  return (
    <label className={css.campo} htmlFor={id}>
      <span>{rotulo}</span>
      <span className={css.input}><em>R$</em><input id={id} inputMode="decimal" value={txt} disabled={disabled} autoComplete="off"
        onFocus={(e) => { editando.current = true; if (valorCent === 0) setTxt(''); else e.currentTarget.select(); }}
        onChange={(e) => { const v = e.target.value.replace(/[^\d.,]/g, ''); setTxt(v); onChange(Math.round(numeroBr(v) * 100)); }}
        onBlur={() => { editando.current = false; setTxt(reaisTxt(Math.round(numeroBr(txt) * 100))); }} /></span>
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
function CampoTexto({ id, rotulo, valor, onChange, placeholder, ajuda, disabled, tipo, numerico, erro }: {
  id: string; rotulo: string; valor: string; onChange: (s: string) => void; placeholder?: string; ajuda?: string; disabled?: boolean; tipo?: string;
  numerico?: boolean; erro?: string;
}) {
  // Erro só aparece depois que a pessoa sai do campo (não grita enquanto digita).
  const [saiu, setSaiu] = useState(false);
  const mostraErro = !!erro && saiu;
  return (
    <label className={css.campo} htmlFor={id}>
      <span>{rotulo}</span>
      <span className={css.input}><input id={id} type={tipo ?? 'text'} value={valor} placeholder={placeholder} disabled={disabled}
        inputMode={numerico ? 'numeric' : undefined} autoComplete={numerico ? 'off' : undefined} aria-invalid={mostraErro || undefined}
        onBlur={() => setSaiu(true)} onChange={(e) => onChange(e.target.value)} /></span>
      {mostraErro ? <small className={css.erroCampo}>{erro}</small> : ajuda && <small>{ajuda}</small>}
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
        <p className={css.formula}>Cesta básica: só é paga no mês sem falta e depois da carência (3 meses após o início no ponto, ou o mês definido no painel de cada pessoa).</p>
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
          {l.salarioPartes.length > 1 && (
            <div className={css.historico}>
              <span className={css.lb}>Salário mudou neste mês — proporcional</span>
              {l.salarioPartes.map((p) => (
                <Linha2 key={p.desde} k={<span className={css.mute}>{fmtDia(p.desde)} a {fmtDia(p.ate)} · {brl(p.salarioCent)}</span>} v={brl(p.valorCent)} />
              ))}
              <p className={css.formula}>Base de 30 dias. Extras e faltas de cada dia usam o salário daquele dia.</p>
            </div>
          )}
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
          <Linha2 k={`VR/VA · ${b.diasProx} dias`} v={brl(b.vrProxCent)} />
          <Linha2 k={`Cesta básica de ${mesCurto(mes)}`} v={<StatusCesta l={l} />} />
          {b.cestaStatus === 'PERDIDA_FALTA' && <p className={css.formula}>Faltou em {l.faltasDias.map(fmtDia).join(', ')} — com falta no mês a cesta não é paga.</p>}
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

        <Admissao l={l} onSalvo={onSalvo} onAviso={onAviso} />
        <InicioCesta l={l} fechado={fechado} onSalvo={onSalvo} onAviso={onAviso} />

        <section className={css.bloco}>
          <span className={css.lb}>Resumo</span>
          <Linha2 k="Líquido do salário (prévia)" v={brl(l.liquidoSalarioCent)} />
          <Linha2 k="Débitos descontados" v={l.debitosCent ? brl(-l.debitosCent) : '—'} />
          <Linha2 cls={css.total} k="Custo bruto da empresa" v={brl(l.custoBrutoCent)} />
          <p className={css.formula}>O custo bruto não tira débitos nem acertos: esse dinheiro já tinha saído antes.</p>
          <p className={css.formula}><b>Prévia:</b> sem INSS, IRRF e encargos. O valor real de pagamento é o que a contabilidade informar.</p>
        </section>

        <Observacao pessoaTipo="CLT" pessoaId={l.empregadoId} mes={mes} inicial={l.observacao} disabled={fechado} />
        {!fechado && <ZonaTirar nome={l.nome} mes={mes} onTirar={onTirar} />}
      </div>
    </>
  );
}

/** Mês a partir do qual a cesta é paga (carência). Vazio = automático. */
function InicioCesta({ l, fechado, onSalvo, onAviso }: { l: PessoalLinhaClt; fechado: boolean; onSalvo: () => Promise<void>; onAviso: (m: string) => void }) {
  const b = l.beneficios;
  const [valor, setValor] = useState(b.cestaDesde ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { setValor(b.cestaDesde ?? ''); }, [b.cestaDesde]);
  async function salvar(v: string | null) {
    setSalvando(true); setErro(null);
    try {
      await api.put(`/pessoal/clt/${l.empregadoId}/cesta`, { cestaDesde: v });
      await onSalvo(); onAviso(v ? `Cesta de ${l.nome} a partir de ${mesLongo(v)}.` : `Cesta de ${l.nome} volta ao automático.`);
    } catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }
  return (
    <section className={css.bloco}>
      <span className={css.lb}>Cesta básica</span>
      <p className={css.formula}>
        {b.cestaDesde
          ? `Recebe a partir de ${mesLongo(b.cestaDesde)}${b.cestaDesdeOrigem === 'AUTO' ? ` (automático: 3 meses depois ${l.admissao ? 'da admissão' : 'do início no ponto'})` : ' (definido aqui)'}.`
          : 'Sem carência: recebe desde já.'} Mês com falta não paga a cesta.
      </p>
      {!fechado && (
        <>
          <label className={css.campo} htmlFor="cesta-desde">
            <span>Recebe a partir de</span>
            <span className={css.input}><input id="cesta-desde" type="month" value={valor} onChange={(e) => setValor(e.target.value)} /></span>
          </label>
          {erro && <p className={css.alerta}>{erro}</p>}
          <div className={css.acoes}>
            <Botao variante="ghost" className={css.btnSec} disabled={salvando || !valor || (valor === b.cestaDesde && b.cestaDesdeOrigem === 'MANUAL')} onClick={() => salvar(valor)}>
              {salvando ? 'Salvando…' : valor ? `Cesta a partir de ${mesCurto(valor)}` : 'Escolha o mês'}
            </Botao>
            {b.cestaDesdeOrigem === 'MANUAL' && <button className={css.link} onClick={() => salvar(null)}>Voltar ao automático</button>}
          </div>
        </>
      )}
    </section>
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

function DadosContrato({ p, mes, fechado, empresas, onSalvo }: { p: PessoalLinhaMei | PessoalLinhaMot; mes: string; fechado: boolean; empresas: string[]; onSalvo: () => Promise<void> }) {
  const [aberto, setAberto] = useState<'' | 'dados' | 'reajuste'>('');
  const [f, setF] = useState({ nome: p.nome, empresa: p.empresa ?? '', inicioAtividade: p.inicioAtividade ?? '', documento: mascaraDoc(p.documento ?? ''), funcao: p.funcao ?? '', chavePix: p.chavePix ?? '' });
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
      {p.empresa && <Linha2 k={<span className={css.mute}>Empresa</span>} v={p.empresa} />}
      <Linha2 k={<span className={css.mute}>Presta serviço desde</span>} v={p.inicioAtividade ? new Date(`${p.inicioAtividade}T12:00:00`).toLocaleDateString('pt-BR') : 'não informado'} />
      <p className={css.formula}>{p.historicoValores.length > 1 ? `Reajustado em ${mesLongo(p.valorDesde)}` : `No sistema desde ${mesLongo(p.competenciaInicio)}`} · {p.baseDias === 'SEG_SAB' ? 'segunda a sábado' : 'segunda a sexta'}</p>
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
          <button className={css.link} onClick={() => { setF({ nome: p.nome, empresa: p.empresa ?? '', inicioAtividade: p.inicioAtividade ?? '', documento: mascaraDoc(p.documento ?? ''), funcao: p.funcao ?? '', chavePix: p.chavePix ?? '' }); setAberto('dados'); }}>Editar nome, empresa, {motorista ? 'documento' : 'CNPJ'} ou Pix</button>
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
          <CampoEmpresa id="c-emp" valor={f.empresa} empresas={empresas} onChange={(v) => setF({ ...f, empresa: v })} />
          <CampoTexto id="c-desde" tipo="date" rotulo="Presta serviço desde" valor={f.inicioAtividade} onChange={(v) => setF({ ...f, inicioAtividade: v })}
            ajuda="Data real de início, mesmo que antes de usar o sistema." />
          <div className={css.grade2}>
            <CampoTexto id="c-doc" rotulo={motorista ? 'CPF ou CNPJ' : 'CNPJ'} valor={f.documento} numerico placeholder={motorista ? '000.000.000-00' : '00.000.000/0001-00'}
              onChange={(v) => setF({ ...f, documento: mascaraDoc(v) })} erro={docIncompleto(f.documento, !motorista)} />
            <CampoTexto id="c-fun" rotulo={motorista ? 'Categoria' : 'Função'} valor={f.funcao} onChange={(v) => setF({ ...f, funcao: v })} />
          </div>
          <CampoTexto id="c-pix" rotulo="Chave Pix (opcional)" valor={f.chavePix} placeholder="CPF, CNPJ, celular, e-mail ou aleatória" onChange={(v) => setF({ ...f, chavePix: v })}
            erro={f.chavePix.trim() && !normalizarChave(f.chavePix) ? 'Não reconheci essa chave Pix.' : ''} />
          <p className={css.formula}>Dados cadastrais mudam em todos os meses. Pra mudar valor, use "Reajustar valor".</p>
          {erro && <p className={css.alerta}>{erro}</p>}
          <div className={css.dAcoes}>
            <button className={css.btnTexto} onClick={() => { setAberto(''); setErro(null); }}>Cancelar</button>
            <Botao variante="coral" className={css.btnPri} disabled={salvando || !f.nome.trim() || !!docIncompleto(f.documento, !motorista)}
              onClick={() => enviar({ nome: f.nome, empresa: f.empresa, inicioAtividade: f.inicioAtividade || null, documento: f.documento, funcao: f.funcao, chavePix: f.chavePix })}>{salvando ? 'Salvando…' : 'Salvar dados'}</Botao>
          </div>
        </>
      )}
    </section>
  );
}

function PainelMei({ l, mes, fechado, empresas, onSalvo, onContrato, onTirar, onRecarregar, onAviso }: {
  l: PessoalLinhaMei; mes: string; fechado: boolean; empresas: string[]; onSalvo: () => Promise<void>; onContrato: () => Promise<void>; onTirar: () => void;
  onRecarregar: () => Promise<void>; onAviso: (m: string) => void;
}) {
  const [f, setF] = useState({ ...l.lanc });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const pv = useMemo(() => previaMei(l.valorCent, l.diasMes, f, l.debitosCent), [l.valorCent, l.diasMes, l.debitosCent, f]);
  const hojeIso = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  async function salvar() {
    setSalvando(true); setErro(null);
    try {
      // Marcou "pago" agora: registra o líquido como valor pago (pelo Pix dá pra pagar outro valor).
      const valorPago = f.pago && !l.lanc.pago ? { valorPago: Math.max(0, pv.liquidoCent) / 100 } : {};
      // Mês fechado: só NF e pagamento (o resto está congelado).
      await api.put('/pessoal/lancamento', fechado ? {
        pessoaTipo: 'MEI', pessoaId: l.id, competencia: mes, nfNumero: f.nfNumero ?? '', nfData: f.nfData || null, pago: f.pago, ...valorPago,
      } : {
        pessoaTipo: 'MEI', pessoaId: l.id, competencia: mes,
        heMin: f.heMin, faltas: f.faltas, feriadosTrab: f.feriadosTrab, meta: f.metaCent / 100, metaPaga: f.metaPaga,
        metaPagaEm: f.metaPaga ? (f.metaPagaEm || hojeIso) : null, nfNumero: f.nfNumero ?? '', nfData: f.nfData || null, pago: f.pago, ...valorPago,
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
            <CampoTexto id="nf" rotulo="Número da NF" valor={f.nfNumero ?? ''} placeholder="000214" onChange={(v) => setF({ ...f, nfNumero: v })} />
            <CampoTexto id="nf-data" tipo="date" rotulo="Data da NF" valor={f.nfData ?? ''} onChange={(v) => setF({ ...f, nfData: v })} />
          </div>
          <AnexoNf pessoaTipo="MEI" pessoaId={l.id} mes={mes} periodo="MES" nome={l.nome} arquivo={l.lanc.nfArquivo} onMudou={onRecarregar} onAviso={onAviso} />
          <Alternar<'nao' | 'sim'> rotulo="Pagamento" valor={f.pago ? 'sim' : 'nao'} onChange={(v) => setF({ ...f, pago: v === 'sim' })}
            opcoes={[['nao', 'Pendente'], ['sim', 'Pago']]} />
          {l.lanc.pago && l.lanc.pagoEm && <p className={css.formula}>Pago{l.lanc.valorPagoCent != null ? ` ${brl(l.lanc.valorPagoCent)}` : ''} em {fmtPagoEm(l.lanc.pagoEm)}.</p>}
          {fechado && <p className={css.formula}>Mês fechado: os valores estão congelados, mas a nota e o pagamento ainda podem ser registrados.</p>}
        </section>
        <Observacao pessoaTipo="MEI" pessoaId={l.id} mes={mes} inicial={l.lanc.observacao} disabled={fechado} />
        <DadosContrato p={l} mes={mes} fechado={fechado} empresas={empresas} onSalvo={onContrato} />
        {!fechado && <ZonaTirar nome={l.nome} mes={mes} onTirar={onTirar} />}
      </div>
      <div className={css.pRodape}>
        <Linha2 k="Bruto · valor da NF" v={brl(pv.brutoCent)} />
        <Linha2 k={<span className={css.mute}>− débitos{f.metaPaga && f.metaCent ? ' − meta já paga' : ''}</span>} v={pv.abat ? brl(-pv.abat) : '—'} cls={css.neg} />
        <Linha2 cls={css.grande} k="Líquido a pagar" v={brl(pv.liquidoCent)} />
        <p className={css.formula}>{brl(l.valorCent)} + extras {brl(pv.heCent)} + feriados {brl(pv.feriadosCent)} − faltas {brl(pv.faltasCent)} + meta {brl(f.metaCent)}</p>
        {erro && <p className={css.alerta}>{erro}</p>}
        <Botao variante="coral" className={css.btnPri} disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : fechado ? 'Salvar nota e pagamento' : 'Salvar lançamento'}</Botao>
      </div>
    </>
  );
}

function PainelMot({ l, mes, fechado, empresas, onSalvo, onContrato, onTirar, onRecarregar, onAviso }: {
  l: PessoalLinhaMot; mes: string; fechado: boolean; empresas: string[]; onSalvo: () => Promise<void>; onContrato: () => Promise<void>; onTirar: () => void;
  onRecarregar: () => Promise<void>; onAviso: (m: string) => void;
}) {
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
        await api.put('/pessoal/lancamento', fechado ? {
          pessoaTipo: 'MOTORISTA', pessoaId: l.id, competencia: mes, periodo: s.inicio, nfNumero: s.nfNumero ?? '', pago: s.pago,
        } : {
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
              <CampoTexto id={`n-${i}`} rotulo="Número da NF" valor={s.nfNumero ?? ''} onChange={(v) => up(i, { nfNumero: v })} />
              <Alternar<'nao' | 'sim'> rotulo="Pagamento" valor={s.pago ? 'sim' : 'nao'} onChange={(v) => up(i, { pago: v === 'sim' })} opcoes={[['nao', 'Pendente'], ['sim', 'Pago']]} />
            </div>
            {s.dias > 0 && <AnexoNf pessoaTipo="MOTORISTA" pessoaId={l.id} mes={mes} periodo={s.inicio} nome={`${l.nome} · semana ${fmtDia(s.inicio)}`}
              arquivo={l.semanas[i]?.nfArquivo ?? null} onMudou={onRecarregar} onAviso={onAviso} />}
          </section>
        ))}
        <Observacao pessoaTipo="MOTORISTA" pessoaId={l.id} mes={mes} inicial={l.observacao} disabled={fechado} />
        <DadosContrato p={l} mes={mes} fechado={fechado} empresas={empresas} onSalvo={onContrato} />
        {!fechado && <ZonaTirar nome={l.nome} mes={mes} onTirar={onTirar} />}
      </div>
      <div className={css.pRodape}>
        <Linha2 k="Total das notas do mês" v={brl(total)} />
        <Linha2 k={<span className={css.mute}>− débitos</span>} v={l.debitosCent ? brl(-l.debitosCent) : '—'} cls={css.neg} />
        <Linha2 cls={css.grande} k="Líquido a pagar" v={brl(total - l.debitosCent)} />
        {erro && <p className={css.alerta}>{erro}</p>}
        {fechado && <p className={css.formula}>Mês fechado: só nota e pagamento podem mudar.</p>}
        <Botao variante="coral" className={css.btnPri} disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : fechado ? 'Salvar notas e pagamentos' : 'Salvar semanas'}</Botao>
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

function FormPrestador({ tipoInicial, mes, empresas, onVoltar, onCriado }: { tipoInicial: 'MEI' | 'MOTORISTA'; mes: string; empresas: string[]; onVoltar: () => void; onCriado: (nome: string, tipo: 'MEI' | 'MOTORISTA') => void }) {
  const [f, setF] = useState({ tipo: tipoInicial, nome: '', empresa: '', inicioAtividade: '', documento: '', funcao: '', valorCent: 0, baseDias: (tipoInicial === 'MEI' ? 'SEG_SAB' : 'SEG_SEX') as BaseDias, chavePix: '', inicio: mes });
  const [tocado, setTocado] = useState<Record<string, boolean>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const erros = {
    nome: !f.nome.trim() ? 'Informe o nome completo.' : '',
    valor: f.valorCent <= 0 ? `Informe o valor ${f.tipo === 'MEI' ? 'do contrato' : 'mensal'}.` : '',
    documento: docIncompleto(f.documento, f.tipo === 'MEI'),
  };
  const mei = f.tipo === 'MEI';
  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setTocado({ nome: true, valor: true });
    if (erros.nome || erros.valor) return;
    if (erros.documento) { document.getElementById('p-doc')?.focus(); return; }
    setSalvando(true); setErro(null);
    try {
      await api.post('/pessoal/prestadores', {
        tipo: f.tipo, nome: f.nome, empresa: f.empresa, inicioAtividade: f.inicioAtividade || null, documento: f.documento, funcao: f.funcao, valorMensal: f.valorCent / 100,
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
          <CampoEmpresa id="p-emp" valor={f.empresa} empresas={empresas} onChange={(v) => setF({ ...f, empresa: v })} />
          <div className={css.grade2}>
            <CampoTexto id="p-doc" rotulo={mei ? 'CNPJ do MEI' : 'CPF ou CNPJ (opcional)'} valor={f.documento} numerico placeholder={mei ? '00.000.000/0001-00' : '000.000.000-00'}
              onChange={(v) => setF({ ...f, documento: mascaraDoc(v) })} erro={erros.documento} />
            <CampoTexto id="p-fun" rotulo={mei ? 'Função' : 'Categoria / cliente'} valor={f.funcao} placeholder={mei ? 'Vendedor externo' : 'Cobra · 814'} onChange={(v) => setF({ ...f, funcao: v })} />
          </div>
          <CampoTexto id="p-pix" rotulo="Chave Pix (opcional)" valor={f.chavePix} placeholder="CPF, CNPJ, celular, e-mail ou aleatória" onChange={(v) => setF({ ...f, chavePix: v })}
            erro={f.chavePix.trim() && !normalizarChave(f.chavePix) ? 'Não reconheci essa chave Pix.' : ''} ajuda="Usada no QR Code de pagamento." />
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
          <h3><span className={css.num}>4</span>Datas</h3>
          <label className={css.campo} htmlFor="p-desde"><span>Presta serviço desde (opcional)</span>
            <span className={css.input}><input id="p-desde" type="date" value={f.inicioAtividade} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setF({ ...f, inicioAtividade: e.target.value })} /></span>
            <small>Quando a pessoa começou de verdade, mesmo que antes de usar o sistema. Aparece no histórico.</small></label>
          <label className={css.campo} htmlFor="p-ini"><span>Primeira competência no sistema</span>
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


// =================== Pix, pago e nota fiscal ===================

/** O que pode entrar no Pix (marcável) e o que sempre desconta. */
type PixItem = { id: string; rotulo: string; detalhe?: string; cent: number; marcado: boolean; bloqueio?: string };
type PixAbatimento = { rotulo: string; detalhe?: string; cent: number };
/** Pagamento que dá pra registrar (MEI e motorista; CLT é prévia, sem registro). */
type PixRegistro = { pessoaTipo: 'MEI' | 'MOTORISTA'; pessoaId: string; nome: string; semanas: string[] } & PessoalPagamentoMes;
type PixAlvo = {
  origem: { tipo: 'CLT' | 'MEI' | 'MOTORISTA'; id: string };
  nome: string; chave: string; itens: PixItem[]; abatimentos: PixAbatimento[]; registro: PixRegistro | null; previa?: boolean;
};

const fmtHoraCurta = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fmtPagoEm = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} · ${fmtHoraCurta(iso)}`;
};
const debitosDaPessoa = (debitos: PessoalDebito[], tipo: PessoaTipo, id: string): PixAbatimento[] =>
  debitos.filter((x) => x.pessoaTipo === tipo && x.pessoaId === id)
    .map((x) => ({ rotulo: 'Débito', detalhe: `${x.descricao}${x.parcelas > 1 ? ` · parcela ${x.parcelaAtual}/${x.parcelas}` : ''}`, cent: x.parcelaCent }));

function registroMei(l: PessoalLinhaMei): PixRegistro {
  return { pessoaTipo: 'MEI', pessoaId: l.id, nome: l.nome, semanas: [], pago: l.lanc.pago, valorPagoCent: l.lanc.valorPagoCent, pagoEm: l.lanc.pagoEm };
}
function registroMot(l: PessoalLinhaMot): PixRegistro {
  const comDias = l.semanas.filter((s) => s.dias > 0);
  const pago = l.pagamento.pago || (comDias.length > 0 && comDias.every((s) => s.pago));
  return { pessoaTipo: 'MOTORISTA', pessoaId: l.id, nome: l.nome, semanas: comDias.map((s) => s.inicio), pago, valorPagoCent: l.pagamento.valorPagoCent, pagoEm: l.pagamento.pagoEm };
}
function pixMei(l: PessoalLinhaMei, debitos: PessoalDebito[]): PixAlvo {
  const itens: PixItem[] = [{ id: 'contrato', rotulo: 'Contrato', detalhe: `valor mensal · ${brl(l.valorDiaCent)}/dia`, cent: l.valorCent, marcado: true }];
  if (l.heCent) itens.push({ id: 'he', rotulo: 'Horas extras', detalhe: `${minutosParaHhMm(l.lanc.heMin)} × ${brl(Math.round(l.valorHoraCent * 1.5))}`, cent: l.heCent, marcado: true });
  if (l.feriadosCent) itens.push({ id: 'fer', rotulo: 'Feriados trabalhados', detalhe: `${l.lanc.feriadosTrab} dia${l.lanc.feriadosTrab > 1 ? 's' : ''}`, cent: l.feriadosCent, marcado: true });
  if (l.lanc.metaCent) itens.push(l.lanc.metaPaga
    ? { id: 'meta', rotulo: 'Meta', detalhe: 'já foi paga', cent: l.lanc.metaCent, marcado: false, bloqueio: l.lanc.metaPagaEm ? `paga em ${fmtDia(l.lanc.metaPagaEm)}` : 'já paga' }
    : { id: 'meta', rotulo: 'Meta', detalhe: 'ainda não paga', cent: l.lanc.metaCent, marcado: true });
  const abatimentos: PixAbatimento[] = [];
  if (l.faltasCent) abatimentos.push({ rotulo: 'Faltas', detalhe: `${l.lanc.faltas} dia${l.lanc.faltas > 1 ? 's' : ''}`, cent: l.faltasCent });
  abatimentos.push(...debitosDaPessoa(debitos, 'MEI', l.id));
  return { origem: { tipo: 'MEI', id: l.id }, nome: l.nome, chave: l.chavePix ?? '', itens, abatimentos, registro: registroMei(l) };
}
function pixMot(l: PessoalLinhaMot, debitos: PessoalDebito[]): PixAlvo {
  const dias = l.semanas.reduce((a, s) => a + s.dias, 0);
  const adic = l.semanas.reduce((a, s) => a + s.adicionalCent, 0);
  const itens: PixItem[] = [{ id: 'diarias', rotulo: 'Diárias', detalhe: `${dias} dia${dias === 1 ? '' : 's'} × ${brl(l.diariaCent)}`, cent: l.totalCent - adic, marcado: true }];
  if (adic) itens.push({ id: 'adic', rotulo: 'Adicionais', detalhe: 'sábado extra, freelancer…', cent: adic, marcado: true });
  return { origem: { tipo: 'MOTORISTA', id: l.id }, nome: l.nome, chave: l.chavePix ?? '', itens, abatimentos: debitosDaPessoa(debitos, 'MOTORISTA', l.id), registro: registroMot(l) };
}
function pixClt(l: PessoalLinhaClt, debitos: PessoalDebito[]): PixAlvo {
  const itens: PixItem[] = [{ id: 'sal', rotulo: 'Salário do mês', detalhe: l.salarioPartes.length > 1 ? 'proporcional (mudou no mês)' : undefined, cent: l.salarioCent ?? 0, marcado: true }];
  if (l.proventosCent) itens.push({ id: 'ext', rotulo: 'Extras e intervalo', detalhe: 'pagos nesta folha', cent: l.proventosCent, marcado: true });
  const abatimentos: PixAbatimento[] = [];
  if (l.descontosCent) abatimentos.push({ rotulo: 'Faltas e atrasos', detalhe: 'do ponto', cent: l.descontosCent });
  abatimentos.push(...debitosDaPessoa(debitos, 'CLT', l.empregadoId));
  return { origem: { tipo: 'CLT', id: l.empregadoId }, nome: l.nome, chave: l.config.chavePix ?? '', itens, abatimentos, registro: null, previa: true };
}
/** Refaz o alvo com os dados mais novos (ex.: depois de registrar o pagamento). */
function atualizarAlvo(a: PixAlvo, d: PessoalCompetencia): PixAlvo {
  if (a.origem.tipo === 'MEI') { const l = d.mei.find((x) => x.id === a.origem.id); return l ? pixMei(l, d.debitos) : a; }
  if (a.origem.tipo === 'MOTORISTA') { const l = d.motoristas.find((x) => x.id === a.origem.id); return l ? pixMot(l, d.debitos) : a; }
  const l = d.clt.find((x) => x.empregadoId === a.origem.id); return l ? pixClt(l, d.debitos) : a;
}

const ROT_CHAVE = { CPF: 'CPF', CNPJ: 'CNPJ', TELEFONE: 'celular', EMAIL: 'e-mail', ALEATORIA: 'chave aleatória' } as const;

/** Ícone de Pix ao lado do nome. Sem chave cadastrada, fica apagado com dica. */
function BotaoPix({ nome, chave, onPix }: { nome: string; chave: string | null; onPix: () => void }) {
  const ok = !!chave && !!normalizarChave(chave);
  return (
    <button type="button" className={`${css.pixBtn} ${ok ? '' : css.pixSem}`} disabled={!ok}
      title={ok ? `Pagar ${nome} por Pix` : chave ? 'Chave Pix inválida — corrija no cadastro' : 'Sem chave Pix cadastrada'}
      aria-label={ok ? `Pagar ${nome} por Pix` : `${nome} sem chave Pix`}
      onClick={(e) => { e.stopPropagation(); if (ok) onPix(); }}
      onKeyDown={(e) => e.stopPropagation()}>
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2.6 9.1 5.5a3 3 0 0 1 2.1.9L12 7.2l.8-.8a3 3 0 0 1 2.1-.9L12 2.6Zm-5.7 4.1L3.6 9.4a3.7 3.7 0 0 0 0 5.2l2.7 2.7h1.4c.5 0 1-.2 1.4-.6l1.7-1.7a1.7 1.7 0 0 1 2.4 0l1.7 1.7c.4.4.9.6 1.4.6h1.4l2.7-2.7a3.7 3.7 0 0 0 0-5.2l-2.7-2.7h-1.4c-.5 0-1 .2-1.4.6l-1.7 1.7a1.7 1.7 0 0 1-2.4 0L9.1 7.3a2 2 0 0 0-1.4-.6H6.3Zm2.8 11.8L12 21.4l2.9-2.9a3 3 0 0 1-2.1-.9l-.8-.8-.8.8a3 3 0 0 1-2.1.9Z"/></svg>
    </button>
  );
}

function ModalPix({ alvo, mes, onFechar, onRegistrar }: {
  alvo: PixAlvo; mes: string; onFechar: () => void; onRegistrar: (r: PixRegistro, pago: boolean, valorCent: number | null) => void;
}) {
  const norm = normalizarChave(alvo.chave)!;
  const [marcados, setMarcados] = useState<Record<string, boolean>>(() => Object.fromEntries(alvo.itens.map((i) => [i.id, i.marcado])));
  const [modo, setModo] = useState<'itens' | 'outro'>('itens');
  const [outroCent, setOutroCent] = useState(0);
  const [img, setImg] = useState('');
  const [copiado, setCopiado] = useState(false);
  const fechar = useRef<HTMLButtonElement>(null);
  const somaItens = alvo.itens.reduce((a, i) => a + (marcados[i.id] && !i.bloqueio ? i.cent : 0), 0);
  const somaAbat = alvo.abatimentos.reduce((a, x) => a + x.cent, 0);
  const totalItens = Math.max(0, somaItens - somaAbat);
  const valor = modo === 'itens' ? totalItens : outroCent;
  const codigo = useMemo(() => brCodePix({
    chave: norm.chave, nome: alvo.nome, valorCent: valor > 0 ? valor : null, txid: `PS${mes.replace('-', '')}`,
  }), [norm.chave, alvo.nome, valor, mes]);
  useEffect(() => {
    let vivo = true;
    QRCode.toDataURL(codigo, { margin: 1, width: 216, errorCorrectionLevel: 'M', color: { dark: '#10403F', light: '#FFFFFF' } })
      .then((u) => { if (vivo) setImg(u); }).catch(() => setImg(''));
    return () => { vivo = false; };
  }, [codigo]);
  useEffect(() => {
    const voltar = document.activeElement as HTMLElement | null;
    fechar.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('keydown', esc); voltar?.focus?.(); };
  }, [onFechar]);
  async function copiar() {
    try { await navigator.clipboard.writeText(codigo); setCopiado(true); setTimeout(() => setCopiado(false), 2500); } catch { /* sem permissão: o texto está visível pra copiar */ }
  }
  const r = alvo.registro;
  return (
    <div className={css.dFundo} data-dialogo onClick={onFechar}>
      <div className={`${css.dialogo} ${css.pixModal}`} role="dialog" aria-modal="true" aria-labelledby="pix-titulo" onClick={(e) => e.stopPropagation()}>
        <div className={css.pixTopo}>
          <div><h3 id="pix-titulo">Pagar {alvo.nome}</h3>
            <p className={css.hint}>Pix ({ROT_CHAVE[norm.tipo]}) <b className={css.mono}>{norm.tipo === 'CPF' || norm.tipo === 'CNPJ' ? mascaraDoc(norm.chave) : norm.chave}</b> · {mesLongo(mes)}</p></div>
          <button ref={fechar} className={css.pX} onClick={onFechar} aria-label="Fechar">✕</button>
        </div>
        {r?.pago && (
          <div className={css.pagoFaixa}>
            <span>Pago{r.valorPagoCent != null ? ` ${brl(r.valorPagoCent)}` : ' (valor não registrado)'}{r.pagoEm ? ` em ${fmtPagoEm(r.pagoEm)}` : ''}</span>
            <button type="button" className={css.link} onClick={() => onRegistrar(r, false, null)}>Desfazer pagamento</button>
          </div>
        )}
        {alvo.previa && <p className={css.previaLinha}><b>Prévia</b> sem INSS, IRRF e encargos — confira o valor com a contabilidade antes de pagar.</p>}
        <div className={css.pixGrade}>
          <div>
            <span className={css.lb}>O que entra neste pagamento</span>
            <div className={css.pixItens}>
              {alvo.itens.map((i) => (
                <label key={i.id} className={`${css.pixItem} ${!marcados[i.id] || i.bloqueio ? css.pixItemOff : ''}`} title={i.bloqueio}>
                  <input type="checkbox" checked={!!marcados[i.id] && !i.bloqueio} disabled={!!i.bloqueio || modo === 'outro'}
                    onChange={(e) => setMarcados({ ...marcados, [i.id]: e.target.checked })} />
                  <span>{i.rotulo}{(i.bloqueio ?? i.detalhe) && <small>{i.bloqueio ?? i.detalhe}</small>}</span>
                  <b className={css.mono}>{brl(i.cent)}</b>
                </label>
              ))}
            </div>
            {alvo.abatimentos.length > 0 && (
              <div className={css.pixAbat}>
                <span className={css.lb}>Sempre descontado</span>
                {alvo.abatimentos.map((x, k) => (
                  <div key={k} className={css.pixItem}><span className={css.pixMenos} aria-hidden="true">−</span>
                    <span>{x.rotulo}{x.detalhe && <small>{x.detalhe}</small>}</span><b className={`${css.mono} ${css.neg}`}>{brl(x.cent)}</b></div>
                ))}
              </div>
            )}
            <div className={css.pixTotal}><span>Total</span><strong>{brl(totalItens)}</strong></div>
            <div className={css.alternar} role="group" aria-label="Valor do Pix" style={{ marginTop: 10 }}>
              <button type="button" aria-pressed={modo === 'itens'} onClick={() => setModo('itens')}>Usar o total</button>
              <button type="button" aria-pressed={modo === 'outro'} onClick={() => { if (!outroCent) setOutroCent(totalItens); setModo('outro'); }}>Digitar outro valor</button>
            </div>
            {modo === 'outro' && (
              <CampoReais id="pix-outro" rotulo="Valor a pagar" valorCent={outroCent} onChange={setOutroCent}
                ajuda="Adiantamento ou pagamento em partes. Esse valor vai pro QR e vira o valor pago." />
            )}
          </div>
          <div className={css.pixLado}>
            <div className={css.pixQr}>{img ? <img src={img} width={216} height={216} alt={`QR Code Pix de ${alvo.nome}${valor > 0 ? ` no valor de ${brl(valor)}` : ''}`} /> : <span className={css.hint}>Gerando…</span>}</div>
            <div className={css.pixValor}><span>Valor no QR Code</span><strong>{valor > 0 ? brl(valor) : 'sem valor'}</strong></div>
            <label className={css.campo} htmlFor="pix-cc"><span>Pix copia e cola</span>
              <textarea id="pix-cc" className={css.pixCc} readOnly value={codigo} rows={3} onFocus={(e) => e.currentTarget.select()} /></label>
          </div>
        </div>
        <p className={css.formula}>Confira o nome do recebedor no app do banco antes de confirmar.</p>
        <div className={css.dAcoes}>
          <button className={css.btnTexto} onClick={onFechar}>Fechar</button>
          <button type="button" className={css.btnContornoNeutro} onClick={copiar}>{copiado ? 'Copiado ✓' : 'Copiar código'}</button>
          {r && <Botao variante="coral" className={css.btnPri} disabled={valor <= 0}
            onClick={() => { onRegistrar(r, true, valor); onFechar(); }}>{r.pago ? `Atualizar para ${brl(valor)}` : `Registrar pagamento de ${brl(valor)}`}</Botao>}
        </div>
      </div>
    </div>
  );
}

/** Pagamento na linha: valor pago + data/hora, e o interruptor. */
function CelulaPagamento({ nome, pago, valorPagoCent, liquidoCent, pagoEm, parcial, onMudar }: {
  nome: string; pago: boolean; valorPagoCent: number | null; liquidoCent: number; pagoEm: string | null; parcial?: string; onMudar: (v: boolean) => void;
}) {
  return (
    <span className={css.pagCel}>
      <span className={css.pagV}>
        {pago ? <PagoInfo pago valorPagoCent={valorPagoCent} liquidoCent={liquidoCent} pagoEm={pagoEm} /> : <small className={css.sub}>{parcial ?? 'a pagar'}</small>}
      </span>
      <TogglePago nome={nome} pago={pago} onMudar={async (v) => onMudar(v)} />
    </span>
  );
}

/** NF na tabela: com arquivo, abre a nota direto (sem o painel). */
function CelulaNf({ numero, arquivo, onVer }: { numero: string | null; arquivo: PessoalNfArquivo | null; onVer: (a: PessoalNfArquivo) => void }) {
  if (!numero && !arquivo) return <small className={`${css.sub} ${css.subErr}`}>NF pendente</small>;
  const curto = numero ? (numero.length > 14 ? `…${numero.slice(-8)}` : numero) : 'anexada';
  if (!arquivo) return <small className={css.sub} title={`NF ${numero} — sem arquivo anexado`}>NF {curto}</small>;
  return (
    <button type="button" className={css.nfLink} title={`Abrir ${numero ? `NF ${numero}` : arquivo.nome}`}
      onClick={(e) => { e.stopPropagation(); onVer(arquivo); }} onKeyDown={(e) => e.stopPropagation()}>
      NF {curto}<IconeClipe />
    </button>
  );
}

function AvisoPrevia() {
  return (
    <div className={css.previa} role="note">
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 7v6M12 16.5v.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
      <span><b>Prévia, não é holerite.</b> Os valores da folha CLT são uma simulação a partir do ponto, sem INSS, IRRF, FGTS e demais encargos. O valor real de pagamento de cada funcionário é o que a contabilidade informar.</span>
    </div>
  );
}

/** Interruptor "pago" na linha da tabela — não abre o painel. */
function TogglePago({ nome, pago, parcial, onMudar, children }: { nome: string; pago: boolean; parcial?: string; onMudar: (v: boolean) => Promise<void>; children?: ReactNode }) {
  const [enviando, setEnviando] = useState(false);
  return (
    <span className={css.pagoCel} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button type="button" role="switch" aria-checked={pago} disabled={enviando} className={`${css.chave} ${pago ? css.chaveOn : ''}`}
        aria-label={`${nome}: ${pago ? 'pago' : parcial ? `${parcial} semanas pagas` : 'pagamento pendente'}`}
        title={pago ? 'Pago — clique para voltar a pendente' : parcial ? `${parcial} semanas pagas — clique para marcar todas` : 'Marcar como pago'}
        onClick={async () => { setEnviando(true); try { await onMudar(!pago); } finally { setEnviando(false); } }}>
        <span className={css.chaveBola} />
      </button>
      {parcial && <small className={css.sub}>{parcial} pagas</small>}
      {children}
    </span>
  );
}

const IconeClipe = () => (
  <svg className={css.clipe} viewBox="0 0 24 24" width="12" height="12" aria-label="com arquivo"><path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"
    d="M20 11.5 12.4 19a5 5 0 0 1-7.1-7.1l7.8-7.7a3.3 3.3 0 0 1 4.7 4.7l-7.6 7.6a1.7 1.7 0 0 1-2.4-2.4l7-6.9" /></svg>
);

const tamanho = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`);
const NF_ACEITA = '.pdf,.xml,.png,.jpg,.jpeg,.webp,application/pdf,text/xml,application/xml,image/png,image/jpeg,image/webp';

/** Arquivo da nota fiscal: enviar, ver, baixar, trocar e remover. Funciona em mês fechado. */
function AnexoNf({ pessoaTipo, pessoaId, mes, periodo, nome, arquivo, onMudou, onAviso }: {
  pessoaTipo: 'MEI' | 'MOTORISTA'; pessoaId: string; mes: string; periodo: string; nome: string; arquivo: PessoalNfArquivo | null;
  onMudou: () => Promise<void>; onAviso: (m: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState<'' | 'enviando' | 'removendo'>('');
  const [erro, setErro] = useState<string | null>(null);
  const [ver, setVer] = useState(false);
  const [confirmaRemover, setConfirmaRemover] = useState(false);
  async function enviar(file: File) {
    setErro(null);
    if (file.size > 5 * 1024 * 1024) { setErro('Arquivo maior que 5 MB. Envie um PDF menor.'); return; }
    const mime = file.type || (file.name.toLowerCase().endsWith('.xml') ? 'application/xml' : file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '');
    setOcupado('enviando');
    try {
      await api.post('/pessoal/nf', { pessoaTipo, pessoaId, competencia: mes, periodo, arquivoBase64: await arquivoParaBase64(file), arquivoNome: file.name, arquivoMime: mime });
      await onMudou();
      onAviso(`Nota de ${nome} ${arquivo ? 'substituída' : 'anexada'}.`);
    } catch (e) { setErro((e as Error).message); }
    finally { setOcupado(''); if (input.current) input.current.value = ''; }
  }
  async function baixar() {
    if (!arquivo) return;
    try { salvarBlob(await api.baixar(`/pessoal/nf/${arquivo.id}`), arquivo.nome); } catch (e) { setErro((e as Error).message); }
  }
  async function remover() {
    if (!arquivo) return;
    setOcupado('removendo'); setErro(null);
    try { await api.del(`/pessoal/nf/${arquivo.id}`); setConfirmaRemover(false); await onMudou(); onAviso(`Arquivo da nota de ${nome} removido.`); }
    catch (e) { setErro((e as Error).message); }
    finally { setOcupado(''); }
  }
  return (
    <div className={css.anexo}>
      <input ref={input} type="file" accept={NF_ACEITA} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void enviar(f); }} />
      {arquivo ? (
        <>
          <div className={css.anexoArq}>
            <span className={css.anexoIco} aria-hidden="true">{arquivo.mime === 'application/pdf' ? 'PDF' : arquivo.mime.includes('xml') ? 'XML' : 'IMG'}</span>
            <span className={css.anexoNome}><b title={arquivo.nome}>{arquivo.nome}</b><small>{tamanho(arquivo.bytes)} · enviado {fmtDia(arquivo.enviadoEm.slice(0, 10))}</small></span>
          </div>
          {confirmaRemover ? (
            <div className={css.anexoAcoes}>
              <span className={css.hint}>Remover o arquivo?</span>
              <button type="button" className={css.btnTexto} onClick={() => setConfirmaRemover(false)}>Não</button>
              <button type="button" className={`${css.link} ${css.linkPerigo}`} disabled={!!ocupado} onClick={remover}>{ocupado === 'removendo' ? 'Removendo…' : 'Sim, remover'}</button>
            </div>
          ) : (
            <div className={css.anexoAcoes}>
              <button type="button" className={css.btnContornoNeutro} onClick={() => setVer(true)}>Ver</button>
              <button type="button" className={css.btnContornoNeutro} onClick={baixar}>Baixar</button>
              <button type="button" className={css.link} disabled={!!ocupado} onClick={() => input.current?.click()}>{ocupado === 'enviando' ? 'Enviando…' : 'Trocar'}</button>
              <button type="button" className={`${css.link} ${css.linkPerigo}`} onClick={() => setConfirmaRemover(true)}>Remover</button>
            </div>
          )}
        </>
      ) : (
        <button type="button" className={css.anexoVazio} disabled={!!ocupado} onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void enviar(f); }}>
          <IconeClipe /> {ocupado === 'enviando' ? 'Enviando…' : <>Anexar arquivo da nota <small>PDF, XML ou foto · até 5 MB</small></>}
        </button>
      )}
      {erro && <p className={css.alerta}>{erro}</p>}
      {ver && arquivo && <VisualizarNf arquivo={arquivo} titulo={`Nota de ${nome}`} onBaixar={baixar} onFechar={() => setVer(false)} />}
    </div>
  );
}

function VisualizarNf({ arquivo, titulo, onBaixar, onFechar }: { arquivo: PessoalNfArquivo; titulo: string; onBaixar: () => void; onFechar: () => void }) {
  const [url, setUrl] = useState('');
  const [texto, setTexto] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const fechar = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let u = '';
    let vivo = true;
    api.baixar(`/pessoal/nf/${arquivo.id}`).then(async (b) => {
      if (!vivo) return;
      if (arquivo.mime.includes('xml')) setTexto(await b.text());
      else { u = URL.createObjectURL(new Blob([b], { type: arquivo.mime })); setUrl(u); }
    }).catch((e) => setErro((e as Error).message));
    return () => { vivo = false; if (u) URL.revokeObjectURL(u); };
  }, [arquivo.id, arquivo.mime]);
  useEffect(() => {
    fechar.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onFechar(); } };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [onFechar]);
  return (
    <div className={css.dFundo} data-dialogo onClick={onFechar}>
      <div className={css.visor} role="dialog" aria-modal="true" aria-labelledby="visor-titulo" onClick={(e) => e.stopPropagation()}>
        <div className={css.visorTopo}>
          <div><h3 id="visor-titulo">{titulo}</h3><p className={css.hint}>{arquivo.nome} · {tamanho(arquivo.bytes)}</p></div>
          <div className={css.anexoAcoes}>
            <button type="button" className={css.btnContornoNeutro} onClick={onBaixar}>Baixar</button>
            <button ref={fechar} className={css.pX} onClick={onFechar} aria-label="Fechar visualização">✕</button>
          </div>
        </div>
        <div className={css.visorCorpo}>
          {erro ? <p className={css.alerta}>{erro}</p>
            : texto !== null ? <pre className={css.visorXml}>{texto}</pre>
            : !url ? <p className={css.hint}>Carregando…</p>
            : arquivo.mime === 'application/pdf' ? <iframe title={arquivo.nome} src={url} className={css.visorPdf} />
            : <img src={url} alt={arquivo.nome} className={css.visorImg} />}
        </div>
      </div>
    </div>
  );
}

/** Empresa: texto livre, com as que já foram usadas como sugestão. */
function CampoEmpresa({ id, valor, empresas, onChange }: { id: string; valor: string; empresas: string[]; onChange: (v: string) => void }) {
  return (
    <label className={css.campo} htmlFor={id}>
      <span>Empresa</span>
      <span className={css.input}><input id={id} value={valor} list={`${id}-lista`} maxLength={120} autoComplete="off" placeholder="Para quem presta o serviço"
        onChange={(e) => onChange(e.target.value)} /></span>
      <datalist id={`${id}-lista`}>{empresas.map((e) => <option key={e} value={e} />)}</datalist>
      <small>{empresas.length ? 'Escolha uma das que já usou ou digite uma nova.' : 'Opcional. Aparece na tabela, depois do nome.'}</small>
    </label>
  );
}

// =================== histórico da pessoa ===================

const ROT_GRUPO: Record<PessoaTipo, string> = { CLT: 'CLT', MEI: 'MEI', MOTORISTA: 'Motoristas' };
const chaveP = (p: { pessoaTipo: PessoaTipo; pessoaId: string }) => `${p.pessoaTipo}:${p.pessoaId}`;
const mesAbrev = (c: string) => `${(MESES[Number(c.slice(5, 7)) - 1] ?? '').slice(0, 3)}/${c.slice(0, 4)}`;

function AbaHistorico({ sel, onSel, onAbrirMes, onVerNf }: {
  sel: string | null; onSel: (k: string | null) => void;
  onAbrirMes: (comp: string, tipo: PessoaTipo, id: string) => void; onVerNf: (a: PessoalNfArquivo, titulo: string) => void;
}) {
  const [pessoas, setPessoas] = useState<PessoalPessoaHistorico[] | null>(null);
  const [q, setQ] = useState('');
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const [hist, setHist] = useState<PessoalHistorico | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [notasMot, setNotasMot] = useState<{ nome: string; comp: string; semanas: PessoalLinhaMot['semanas'] } | null>(null);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => { api.get<PessoalPessoaHistorico[]>('/pessoal/historico/pessoas').then(setPessoas).catch((e) => setErro((e as Error).message)); }, []);
  useEffect(() => {
    if (!sel) { setHist(null); return; }
    const [tipo, id] = sel.split(':');
    let vivo = true;
    setCarregando(true); setErro(null);
    api.get<PessoalHistorico>(`/pessoal/historico/${tipo}/${id}`)
      .then((h) => { if (vivo) setHist(h); }).catch((e) => { if (vivo) setErro((e as Error).message); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [sel]);
  useEffect(() => {
    if (!notasMot) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelectorAll('[data-dialogo]')[1]) setNotasMot(null); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [notasMot]);
  useEffect(() => {
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, []);

  const pessoa = pessoas?.find((p) => chaveP(p) === sel) ?? null;
  const termo = q.trim().toLowerCase();
  const filtradas = (pessoas ?? []).filter((p) => !termo || `${p.nome} ${p.detalhe ?? ''}`.toLowerCase().includes(termo));
  const grupos: [string, PessoalPessoaHistorico[]][] = [
    ...(['MEI', 'MOTORISTA', 'CLT'] as PessoaTipo[]).map((t) => [ROT_GRUPO[t], filtradas.filter((p) => p.pessoaTipo === t && !p.inativo)] as [string, PessoalPessoaHistorico[]]),
    ['Inativos', filtradas.filter((p) => p.inativo)],
  ];
  const ordem = grupos.flatMap(([, l]) => l);
  const escolher = (p: PessoalPessoaHistorico) => { onSel(chaveP(p)); setQ(''); setAberto(false); };

  return (
    <div className={css.hist}>
      <div className={css.histBusca} ref={caixa}>
        <label htmlFor="hist-q" className={css.histRot}>Pessoa</label>
        <div className={css.combo}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2.2" /><path d="m20 20-4-4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
          <input id="hist-q" role="combobox" aria-expanded={aberto} aria-controls="hist-lista" aria-autocomplete="list" autoComplete="off"
            aria-activedescendant={aberto && ordem[ativo] ? `hist-op-${ativo}` : undefined}
            placeholder={pessoas ? 'Digite o nome ou escolha na lista' : 'Carregando pessoas…'}
            value={aberto ? q : (pessoa?.nome ?? q)}
            onFocus={() => { setAberto(true); setAtivo(0); }}
            onChange={(e) => { setQ(e.target.value); setAberto(true); setAtivo(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setAberto(true); setAtivo((a) => Math.min(a + 1, ordem.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo((a) => Math.max(a - 1, 0)); }
              else if (e.key === 'Enter' && aberto && ordem[ativo]) { e.preventDefault(); escolher(ordem[ativo]!); }
              else if (e.key === 'Escape') setAberto(false);
            }} />
          {aberto && pessoas && (
            <div className={css.comboLista} id="hist-lista" role="listbox" aria-label="Pessoas">
              {ordem.length === 0 && <p className={css.hint} style={{ padding: '10px 12px', margin: 0 }}>Ninguém com "{q}".</p>}
              {grupos.map(([g, l]) => l.length > 0 && (
                <div key={g} role="group" aria-label={g}>
                  <div className={css.comboGrupo}>{g}</div>
                  {l.map((p) => {
                    const i = ordem.indexOf(p);
                    return (
                      <div key={chaveP(p)} id={`hist-op-${i}`} role="option" aria-selected={i === ativo}
                        className={`${css.comboOp} ${i === ativo ? css.comboOpAt : ''}`}
                        onMouseEnter={() => setAtivo(i)} onMouseDown={(e) => { e.preventDefault(); escolher(p); }}>
                        <span>{p.nome}{p.inativo && <small> · {ROT_TIPO[p.pessoaTipo]}</small>}</span>
                        <small>{p.inativo && p.desde ? `saiu em ${mesAbrev(p.desde)}` : p.inativo ? 'inativo' : p.detalhe ?? ''}</small>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {erro && <p className={css.erro} role="alert">{erro}</p>}
      {!sel && !erro && (
        <div className={css.histVazio}><b>Escolha uma pessoa</b>Aparecem todos os meses dela: os fechados, com o retrato do fechamento, e o mês em aberto, com os números de agora.</div>
      )}
      {sel && carregando && !hist && <p className={css.carregando}>Montando o histórico…</p>}
      {hist && sel === chaveP(hist) && <HistoricoPessoa h={hist} pessoa={pessoa} onAbrirMes={onAbrirMes} onVerNf={onVerNf}
        onNotasMot={(nome, comp, semanas) => setNotasMot({ nome, comp, semanas })} />}

      {notasMot && (
        <div className={css.dFundo} data-dialogo onClick={() => setNotasMot(null)}>
          <div className={css.dialogo} role="dialog" aria-modal="true" aria-labelledby="nm-t" onClick={(e) => e.stopPropagation()}>
            <div className={css.pixTopo}><div><h3 id="nm-t">Notas de {notasMot.nome}</h3><p className={css.hint} style={{ margin: '4px 0 0' }}>{mesLongo(notasMot.comp)} · por semana</p></div>
              <button className={css.pX} onClick={() => setNotasMot(null)} aria-label="Fechar" autoFocus>✕</button></div>
            {notasMot.semanas.filter((x) => x.dias > 0).map((x) => (
              <div key={x.inicio} className={css.l2}>
                <span>Semana {fmtDia(x.inicio)} a {fmtDia(x.fim)}<small className={css.sub}>{x.dias} dia{x.dias > 1 ? 's' : ''} · {brl(x.totalCent)}{x.pago ? ' · paga' : ''}</small></span>
                <strong><CelulaNf numero={x.nfNumero} arquivo={x.nfArquivo} onVer={(a) => onVerNf(a, `Nota de ${notasMot.nome} · semana ${fmtDia(x.inicio)}`)} /></strong>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HistoricoPessoa({ h, pessoa, onAbrirMes, onVerNf, onNotasMot }: {
  h: PessoalHistorico; pessoa: PessoalPessoaHistorico | null;
  onAbrirMes: (comp: string, tipo: PessoaTipo, id: string) => void; onVerNf: (a: PessoalNfArquivo, titulo: string) => void;
  onNotasMot: (nome: string, comp: string, semanas: PessoalLinhaMot['semanas']) => void;
}) {
  const meses = h.meses;
  const fech = meses.filter((m) => m.fechado).length;
  const kMeses = { k: 'Meses no sistema', v: String(meses.length), s: `${fech} fechado${fech === 1 ? '' : 's'} · ${meses.length - fech} em aberto` };
  const inicioReal = (ini: string | null, sistema: string): [string, ReactNode] => ['Presta serviço desde', ini
    ? <>{mesLongo(ini.slice(0, 7))}<small>no sistema desde {mesAbrev(sistema)}</small></>
    : <>não informado<small>no sistema desde {mesAbrev(sistema)}</small></>];
  const contrato = (l: PessoalLinhaMei | PessoalLinhaMot): [string, ReactNode] => ['Contrato', <>{brl(l.valorCent)}/mês<small>
    {l.historicoValores.length > 1 ? `reajustado em ${mesAbrev(l.valorDesde)}` : l.baseDias === 'SEG_SAB' ? 'seg–sáb' : 'seg–sex'}</small></>];
  if (meses.length === 0) {
    return <div className={css.histVazio}><b>Nada por aqui ainda</b>{pessoa?.nome ?? 'Essa pessoa'} não aparece em nenhum mês fechado nem no mês atual.</div>;
  }
  const abrir = (comp: string) => <button type="button" className={css.link} onClick={() => onAbrirMes(comp, h.pessoaTipo, h.pessoaId)}>Abrir mês</button>;
  const compCel = (m: (typeof meses)[number]) => (
    <td className={css.histComp}>{mesAbrev(m.competencia)}
      <small>{m.fechado ? <span className={`${vt.pill} ${vt.pillOk}`}>fechado</span> : <span className={`${vt.pill} ${vt.pillWarn}`}>em aberto</span>}</small></td>
  );
  let perfil: { tipo: string; nome: string; info: [string, ReactNode][] };
  let kpis: { k: string; v: string; s: string; dark?: boolean }[];
  let tabela: ReactNode;

  if (h.pessoaTipo === 'MEI') {
    const ls = meses.map((m) => ({ m, l: m.linha as PessoalLinhaMei }));
    const ult = ls[0]!.l;
    const pagos = ls.filter((x) => x.l.lanc.pago);
    const semNf = ls.filter((x) => !x.l.lanc.nfNumero && !x.l.lanc.nfArquivo).length;
    const naoPagos = ls.length - pagos.length;
    perfil = { tipo: 'MEI', nome: ult.nome, info: [['Empresa', ult.empresa ?? '—'], ['CNPJ', fmtDoc(ult.documento) ?? '—'], inicioReal(ult.inicioAtividade, ult.competenciaInicio), contrato(ult), ['Pix', ult.chavePix ?? '—']] };
    kpis = [kMeses,
      { k: 'Total pago', v: brl(pagos.reduce((a, x) => a + (x.l.lanc.valorPagoCent ?? x.l.liquidoCent), 0)), s: pagos.length ? `em ${pagos.length} pagamento${pagos.length === 1 ? '' : 's'}` : 'nenhum pagamento ainda', dark: true },
      { k: 'Bruto (NFs)', v: brl(ls.reduce((a, x) => a + x.l.brutoCent, 0)), s: 'soma das notas' },
      { k: 'Pendências', v: semNf || naoPagos ? [semNf ? `${semNf} NF` : '', naoPagos ? `${naoPagos} a pagar` : ''].filter(Boolean).join(' · ') : 'nenhuma', s: semNf ? 'meses sem nota' : 'tudo em dia' }];
    tabela = (
      <table className={`${vt.table} ${css.compacta}`}>
        <thead><tr><th>Competência</th><th className={vt.n}>Contrato</th><th className={vt.n}>Extras</th><th className={vt.n}>Faltas</th><th className={vt.n}>Meta</th>
          <th className={vt.n}>Bruto (NF)</th><th className={vt.n}>Débitos</th><th className={vt.n}>Líquido</th><th className={vt.n}>Pagamento</th><th aria-label="Abrir mês" /></tr></thead>
        <tbody>{ls.map(({ m, l }) => (
          <tr key={m.competencia} className={m.fechado ? '' : css.histAberto}>
            {compCel(m)}
            <td className={vt.n}>{brl(l.valorCent)}</td>
            <td className={vt.n}>{l.heCent + l.feriadosCent ? <span className={vt.pos}>{brl(l.heCent + l.feriadosCent)}</span> : '—'}</td>
            <td className={vt.n}>{l.faltasCent ? <><span className={vt.neg}>{brl(-l.faltasCent)}</span><small className={css.sub}>{l.lanc.faltas} falta{l.lanc.faltas > 1 ? 's' : ''}</small></> : '—'}</td>
            <td className={vt.n}>{!l.lanc.metaCent ? '—' : <>{brl(l.lanc.metaCent)}<small className={`${css.sub} ${l.lanc.metaPaga ? css.subOk : css.subWarn}`}>{l.lanc.metaPaga ? 'já paga' : 'a pagar'}</small></>}</td>
            <td className={`${vt.n} ${css.forte}`}>{brl(l.brutoCent)}<CelulaNf numero={l.lanc.nfNumero} arquivo={l.lanc.nfArquivo} onVer={(a) => onVerNf(a, `Nota de ${l.nome} · ${mesLongo(m.competencia)}`)} /></td>
            <td className={vt.n}>{l.debitosCent ? <span className={vt.neg}>{brl(-l.debitosCent)}</span> : '—'}</td>
            <td className={`${vt.n} ${css.forte}`}>{brl(l.liquidoCent)}</td>
            <td className={vt.n}><PagoInfo pago={l.lanc.pago} valorPagoCent={l.lanc.valorPagoCent} liquidoCent={l.liquidoCent} pagoEm={l.lanc.pagoEm} /></td>
            <td className={vt.n}>{abrir(m.competencia)}</td>
          </tr>
        ))}</tbody>
      </table>
    );
  } else if (h.pessoaTipo === 'MOTORISTA') {
    const ls = meses.map((m) => ({ m, l: m.linha as PessoalLinhaMot }));
    const ult = ls[0]!.l;
    const pagoDe = (l: PessoalLinhaMot) => l.pagamento.pago || (l.semanas.some((x) => x.dias > 0) && l.semanas.filter((x) => x.dias > 0).every((x) => x.pago));
    const pagos = ls.filter((x) => pagoDe(x.l));
    const semNf = ls.reduce((a, x) => a + x.l.semanas.filter((s) => s.dias > 0 && !s.nfNumero && !s.nfArquivo).length, 0);
    perfil = { tipo: 'Motorista', nome: ult.nome, info: [['Empresa', ult.empresa ?? '—'], ['Documento', fmtDoc(ult.documento) ?? '—'], inicioReal(ult.inicioAtividade, ult.competenciaInicio), contrato(ult), ['Pix', ult.chavePix ?? '—']] };
    kpis = [kMeses,
      { k: 'Total pago', v: brl(pagos.reduce((a, x) => a + (x.l.pagamento.valorPagoCent ?? x.l.liquidoCent), 0)), s: pagos.length ? `em ${pagos.length} ${pagos.length === 1 ? 'mês pago' : 'meses pagos'}` : 'nenhum mês pago ainda', dark: true },
      { k: 'Total das NFs', v: brl(ls.reduce((a, x) => a + x.l.totalCent, 0)), s: 'soma das semanas' },
      { k: 'Pendências', v: semNf ? `${semNf} semana${semNf > 1 ? 's' : ''}` : 'nenhuma', s: semNf ? 'sem nota fiscal' : 'notas em dia' }];
    tabela = (
      <table className={`${vt.table} ${css.compacta}`}>
        <thead><tr><th>Competência</th><th className={vt.n}>Dias</th><th className={vt.n}>Adicionais</th><th className={vt.n}>Total das NFs</th><th className={vt.n}>Débitos</th>
          <th className={vt.n}>Líquido</th><th className={vt.n}>Notas</th><th className={vt.n}>Pagamento</th><th aria-label="Abrir mês" /></tr></thead>
        <tbody>{ls.map(({ m, l }) => {
          const com = l.semanas.filter((x) => x.dias > 0);
          const comNf = com.filter((x) => x.nfNumero || x.nfArquivo).length;
          return (
            <tr key={m.competencia} className={m.fechado ? '' : css.histAberto}>
              {compCel(m)}
              <td className={vt.n}>{l.semanas.reduce((a, x) => a + x.dias, 0)}</td>
              <td className={vt.n}>{l.semanas.some((x) => x.adicionalCent) ? brl(l.semanas.reduce((a, x) => a + x.adicionalCent, 0)) : '—'}</td>
              <td className={`${vt.n} ${css.forte}`}>{brl(l.totalCent)}</td>
              <td className={vt.n}>{l.debitosCent ? <span className={vt.neg}>{brl(-l.debitosCent)}</span> : '—'}</td>
              <td className={`${vt.n} ${css.forte}`}>{brl(l.liquidoCent)}</td>
              <td className={vt.n}>{com.length === 0 ? '—' : <>
                <small className={`${css.sub} ${comNf < com.length ? css.subErr : ''}`}>{comNf} de {com.length} com NF</small>
                <button type="button" className={css.nfLink} onClick={() => onNotasMot(l.nome, m.competencia, l.semanas)}>ver notas</button></>}</td>
              <td className={vt.n}><PagoInfo pago={pagoDe(l)} valorPagoCent={l.pagamento.valorPagoCent} liquidoCent={l.liquidoCent} pagoEm={l.pagamento.pagoEm} /></td>
              <td className={vt.n}>{abrir(m.competencia)}</td>
            </tr>
          );
        })}</tbody>
      </table>
    );
  } else {
    const ls = meses.map((m) => ({ m, l: m.linha as PessoalLinhaClt }));
    const ult = ls[0]!.l;
    const faltas = ls.reduce((a, x) => a + x.l.faltasDias.length, 0);
    perfil = { tipo: 'CLT', nome: ult.nome, info: [['Matrícula', ult.matricula ? `#${ult.matricula}` : '—'], ['Cargo', ult.config.cargo ?? '—'],
      ['Admissão', ult.admissao ? new Date(`${ult.admissao}T12:00:00`).toLocaleDateString('pt-BR') : <>não informada<small>edite no painel do funcionário</small></>],
      ['Salário atual', ult.salarioCent == null ? '—' : brl(ult.salarioCent)], ['Benefício', ult.config.origem === 'PROPRIO' ? 'valor próprio' : ult.config.origem === 'PADRAO' ? 'padrão da empresa' : 'sem benefício'], ['Pix', ult.config.chavePix ?? '—']] };
    kpis = [kMeses,
      { k: 'Líquido (prévia)', v: brl(ls.reduce((a, x) => a + x.l.liquidoSalarioCent, 0)), s: 'soma dos meses, sem encargos', dark: true },
      { k: 'Faltas', v: `${faltas} dia${faltas === 1 ? '' : 's'}`, s: ls.filter((x) => x.l.faltasDias.length).map((x) => `${x.l.faltasDias.length} em ${mesAbrev(x.m.competencia).slice(0, 3)}`).join(' · ') || 'nenhuma' },
      { k: 'Benefícios carregados', v: brl(ls.reduce((a, x) => a + x.l.beneficios.cargaCent, 0)), s: 'VR/VA, cesta e VT, já com acerto' }];
    tabela = (
      <table className={`${vt.table} ${css.compacta}`}>
        <thead><tr><th>Competência</th><th className={vt.n}>Salário</th><th className={vt.n} title="Hora extra paga + indenização de intervalo">Extras</th><th className={vt.n}>Faltas e atrasos</th><th className={vt.n}>Débitos</th>
          <th className={vt.n}>Líquido (prévia)</th><th className={vt.n}>Benefícios</th><th className={vt.n} title="Horas extras que foram pro banco">Banco</th><th className={vt.n}>Custo bruto</th><th aria-label="Abrir mês" /></tr></thead>
        <tbody>{ls.map(({ m, l }) => (
          <tr key={m.competencia} className={m.fechado ? '' : css.histAberto}>
            {compCel(m)}
            <td className={vt.n}>{l.salarioCent == null ? '—' : brl(l.salarioCent)}{l.salarioPartes.length > 1 && <small className={css.sub}>proporcional</small>}</td>
            <td className={vt.n}>{l.proventosCent ? <span className={vt.pos}>{brl(l.proventosCent)}</span> : '—'}</td>
            <td className={vt.n}>{l.descontosCent ? <><span className={vt.neg}>{brl(-l.descontosCent)}</span><small className={css.sub}>{l.faltasDias.length ? `${l.faltasDias.length} falta${l.faltasDias.length > 1 ? 's' : ''}` : 'atrasos'}</small></> : '—'}</td>
            <td className={vt.n}>{l.debitosCent ? <span className={vt.neg}>{brl(-l.debitosCent)}</span> : '—'}</td>
            <td className={`${vt.n} ${css.forte}`}>{brl(l.liquidoSalarioCent)}</td>
            <td className={vt.n}>{l.beneficios.cargaCent ? brl(l.beneficios.cargaCent) : '—'}<small className={css.sub}>carga de {mesAbrev(somarMes(m.competencia, 1)).slice(0, 3)}</small></td>
            <td className={vt.n}>{l.heNoBancoMin ? minutosParaHhMm(l.heNoBancoMin) : '—'}</td>
            <td className={vt.n}>{brl(l.custoBrutoCent)}</td>
            <td className={vt.n}>{abrir(m.competencia)}</td>
          </tr>
        ))}</tbody>
      </table>
    );
  }

  return (
    <>
      <div className={css.histPerfil}>
        <div><span className={css.histTag}>{perfil.tipo}</span><h3>{perfil.nome}</h3></div>
        <dl>{perfil.info.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </div>
      {h.pessoaTipo === 'CLT' && <AvisoPrevia />}
      <Resumo itens={kpis.map((x) => ({ k: x.k, v: x.v, s: x.s, tom: x.dark ? 'ok' as const : undefined }))} />
      <div className={vt.tab}><div className={vt.scroll}>{tabela}</div></div>
      <p className={css.hint}>Mês fechado mostra o retrato do fechamento; o mês em aberto (em amarelo) mostra os números de agora. Nota e pagamento são sempre os atuais. "Abrir mês" leva ao fechamento daquela competência com a pessoa aberta.</p>
    </>
  );
}

function PagoInfo({ pago, valorPagoCent, liquidoCent, pagoEm }: { pago: boolean; valorPagoCent: number | null; liquidoCent: number; pagoEm: string | null }) {
  if (!pago) return <small className={`${css.sub} ${css.subWarn}`}>a pagar</small>;
  // Pago antes de existir o valor pago: considera o líquido do mês.
  return <><b>{brl(valorPagoCent ?? liquidoCent)}</b><small className={css.sub}>{[pagoEm ? fmtPagoEm(pagoEm) : '', valorPagoCent == null ? 'líquido' : ''].filter(Boolean).join(' · ')}</small></>;
}

/** Admissão real do CLT (pode ser antes do ponto). Base da carência da cesta. */
function Admissao({ l, onSalvo, onAviso }: { l: PessoalLinhaClt; onSalvo: () => Promise<void>; onAviso: (m: string) => void }) {
  const [valor, setValor] = useState(l.admissao ?? '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { setValor(l.admissao ?? ''); }, [l.admissao]);
  async function salvar() {
    setSalvando(true); setErro(null);
    try {
      await api.put(`/pessoal/clt/${l.empregadoId}/admissao`, { dataAdmissao: valor || null });
      await onSalvo(); onAviso(valor ? `Admissão de ${l.nome}: ${new Date(`${valor}T12:00:00`).toLocaleDateString('pt-BR')}.` : `Admissão de ${l.nome} apagada.`);
    } catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }
  return (
    <section className={css.bloco}>
      <span className={css.lb}>Admissão</span>
      <p className={css.formula}>Data real de entrada na empresa, mesmo que antes de usar o ponto. Conta a carência da cesta e aparece no histórico.</p>
      <div className={css.linhaCampo}>
        <label className={css.campo} htmlFor="adm"><span>Admitido em</span>
          <span className={css.input}><input id="adm" type="date" value={valor} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setValor(e.target.value)} /></span></label>
        <Botao variante="ghost" className={css.btnSec} disabled={salvando || valor === (l.admissao ?? '')} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar admissão'}</Botao>
      </div>
      {erro && <p className={css.alerta}>{erro}</p>}
    </section>
  );
}

/** Faixa de resumo: poucos números, um por bloco. Mesma peça em todas as abas e no histórico. */
function Resumo({ itens }: { itens: { k: string; v: ReactNode; s?: string; tom?: 'ok' | 'neg' }[] }) {
  return (
    <dl className={css.resumo}>
      {itens.map((x) => (
        <div key={x.k}><dt>{x.k}</dt><dd className={x.tom === 'ok' ? css.resOk : x.tom === 'neg' ? css.resNeg : ''}>{x.v}</dd>{x.s && <small>{x.s}</small>}</div>
      ))}
    </dl>
  );
}

function ResumoAba({ aba, d }: { aba: Aba; d: PessoalCompetencia }) {
  const soma = <T,>(l: T[], f: (x: T) => number) => l.reduce((a, x) => a + f(x), 0);
  if (aba === 'folha') return <Resumo itens={[
    { k: 'Funcionários', v: String(d.clt.length) },
    { k: 'Salários', v: brl(soma(d.clt, (x) => x.salarioCent ?? 0)) },
    { k: 'Extras e intervalo', v: brl(soma(d.clt, (x) => x.proventosCent)) },
    { k: 'Faltas e atrasos', v: brl(-soma(d.clt, (x) => x.descontosCent)), tom: 'neg' },
    { k: 'Líquido (prévia)', v: brl(soma(d.clt, (x) => x.liquidoSalarioCent)) },
  ]} />;
  if (aba === 'beneficios') return <Resumo itens={[
    { k: `Carga de ${mesCurto(d.proxima)}`, v: brl(soma(d.clt, (x) => x.beneficios.cargaCent)) },
    { k: `Acerto de ${mesCurto(d.competencia)}`, v: brl(-soma(d.clt, (x) => x.beneficios.acertoCent)), tom: 'neg' },
    { k: 'Padrão da empresa', v: d.padrao ? resumoBen(d.padrao) : 'não definido', s: d.padrao ? `desde ${mesCurto(d.padrao.vigenteDesde)} · quem não tem valor próprio` : 'defina para os CLT sem valor próprio' },
  ]} />;
  if (aba === 'mei') {
    const pagos = d.mei.filter((x) => x.lanc.pago);
    return <Resumo itens={[
      { k: 'Pessoas', v: String(d.mei.length) },
      { k: 'Bruto (NFs)', v: brl(soma(d.mei, (x) => x.brutoCent)) },
      { k: 'Líquido', v: brl(soma(d.mei, (x) => x.liquidoCent)) },
      { k: 'Pago', v: brl(soma(pagos, (x) => x.lanc.valorPagoCent ?? x.liquidoCent)), s: `${pagos.length} de ${d.mei.length}`, tom: pagos.length ? 'ok' : undefined },
      { k: 'NF pendente', v: String(d.pendencias.nfMei), tom: d.pendencias.nfMei ? 'neg' : undefined },
    ]} />;
  }
  if (aba === 'motoristas') {
    const pagos = d.motoristas.filter((x) => x.pagamento.pago);
    return <Resumo itens={[
      { k: 'Motoristas', v: String(d.motoristas.length) },
      { k: 'Total das NFs', v: brl(soma(d.motoristas, (x) => x.totalCent)) },
      { k: 'Líquido', v: brl(soma(d.motoristas, (x) => x.liquidoCent)) },
      { k: 'Pago', v: brl(soma(pagos, (x) => x.pagamento.valorPagoCent ?? x.liquidoCent)), s: `${pagos.length} de ${d.motoristas.length}`, tom: pagos.length ? 'ok' : undefined },
      { k: 'Semanas sem NF', v: String(d.pendencias.nfMotorista), tom: d.pendencias.nfMotorista ? 'neg' : undefined },
    ]} />;
  }
  if (aba === 'debitos') return <Resumo itens={[
    { k: 'Débitos neste mês', v: String(d.debitos.length) },
    { k: 'Descontado neste mês', v: brl(-soma(d.debitos, (x) => x.parcelaCent)), tom: d.debitos.length ? 'neg' : undefined },
    { k: 'Saldo total dos débitos', v: brl(soma(d.debitos, (x) => x.valorTotalCent)) },
  ]} />;
  return null;
}
