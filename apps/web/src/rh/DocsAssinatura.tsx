import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { arquivoParaBase64 } from '../lib/download';
import { useAuth } from '../lib/auth';
import { Avatar } from '../components/Avatar';
import { Modal } from '../components/Modal';
import { ModalPessoa } from '../components/ModalPessoa';
import { Icone } from '../components/Icone';
import cssP from './Prestadores.module.css';
import css from './DocsAssinatura.module.css';

// ───────────────────────── tipos (espelham a API /assinaturas) ─────────────────────────

export type StatusDoc = 'RASCUNHO' | 'ENVIADO' | 'VISUALIZADO' | 'ASSINADO' | 'RECUSADO' | 'CANCELADO' | 'ERRO';
export type TipoDoc = 'ESPELHO' | 'CONTRACHEQUE';
export interface DocAss {
  id: string; tipo: TipoDoc; status: StatusDoc; arquivoNome: string; arquivoBytes: number;
  canal: string | null; sandbox: boolean | null; lembrete: string | null; prazo: string | null;
  enviadoEm: string | null; enviadoPor: string | null; visualizadoEm: string | null; assinadoEm: string | null;
  recusadoEm: string | null; motivoRecusa: string | null; erro: string | null; temAssinado: boolean; criadoEm: string;
}
type Canal = 'EMAIL' | 'WHATSAPP' | 'APP';
interface Linha {
  empregadoId: string; nome: string; matricula: string | null; email: string | null; telefone: string | null; temApp: boolean;
  canal: Canal; espelho: DocAss | null; contracheque: DocAss | null; pronto: boolean;
}
interface Painel {
  competencia: string; rotulo: string; espelhoPronto: boolean; fechadoEm: string | null;
  integracao: { conectado: boolean; sandbox: boolean; mostrarApp: boolean }; uploadsPendentes: number;
  totais: { pessoas: number; prontos: number; faltaContracheque: number; enviados: number; visualizados: number; assinados: number; recusados: number; erros: number; semEmail: number };
  linhas: Linha[];
}
interface Upload { id: string; arquivoNome: string; arquivoBytes: number; empregadoId: string | null; como: string | null }
interface RespEnvio { enviados: number; pulados: number; erros: { nome: string; tipo: TipoDoc; erro: string }[] }

type Filtro = 'TODOS' | 'PRONTOS' | 'FALTA' | 'AGUARDANDO' | 'ASSINADOS' | 'PROBLEMA';

// ───────────────────────── utilidades ─────────────────────────

const mesHoje = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7);
const somarMes = (m: string, n: number) => { const d = new Date(`${m}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mesCurto = (c: string) => `${MESES[Number(c.slice(5, 7)) - 1]}/${c.slice(2, 4)}`;
export const diaHora = (iso: string | null) => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bahia' }).replace(',', '') : '';
export const dia = (iso: string | null) => iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Bahia' }) : '';
const tam = (b: number) => b >= 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
const fmtFone = (e164: string | null) => { const d = (e164 ?? '').replace(/\D/g, '').replace(/^55/, ''); return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : e164 ?? ''; };
const NOME_TIPO: Record<TipoDoc, string> = { ESPELHO: 'Espelho de ponto', CONTRACHEQUE: 'Contracheque' };
const NOME_CANAL: Record<string, string> = { EMAIL: 'por e-mail', WHATSAPP: 'pelo WhatsApp', APP: 'pelo app' };
const NOME_LEMBRETE: Record<string, string> = { DAILY: 'lembrete diário', WEEKLY: 'lembrete semanal' };

const PENDENTE = (s?: StatusDoc) => s === 'ENVIADO' || s === 'VISUALIZADO';
const ATIVO = (d: DocAss | null): d is DocAss => !!d && d.status !== 'CANCELADO';
const REENVIAVEL = (s?: StatusDoc) => !s || s === 'RASCUNHO' || s === 'ERRO' || s === 'CANCELADO' || s === 'RECUSADO';

/** O que sai se mandar agora (o mesmo critério da API). */
export function docsAEnviar(l: Linha, espelhoPronto: boolean) {
  const espelho = espelhoPronto && REENVIAVEL(l.espelho?.status);
  const cc = !!l.contracheque && ['RASCUNHO', 'ERRO', 'RECUSADO'].includes(l.contracheque.status);
  return { espelho, cc, total: Number(espelho) + Number(cc) };
}

/** Situação da pessoa no mês (uma etiqueta só). */
function situacao(l: Linha, p: Painel): { rot: string; tom: 'ok' | 'av' | 'er' | 'in' | 'cz'; sub?: string } {
  const docs = [l.espelho, l.contracheque].filter(ATIVO);
  if (docs.some((d) => d.status === 'RECUSADO')) return { rot: 'recusado', tom: 'er', sub: docs.find((d) => d.status === 'RECUSADO')!.motivoRecusa ?? undefined };
  if (docs.some((d) => d.status === 'ERRO')) return { rot: 'erro no envio', tom: 'er' };
  const env = docs.filter((d) => d.status === 'ENVIADO' || d.status === 'VISUALIZADO' || d.status === 'ASSINADO');
  if (env.length) {
    const ass = env.filter((d) => d.status === 'ASSINADO');
    const ultimo = env.map((d) => d.enviadoEm ?? '').sort().pop() ?? null;
    if (ass.length === env.length) return { rot: `assinado · ${ass.length} de ${env.length}`, tom: 'ok', sub: diaHora(ass.map((d) => d.assinadoEm ?? '').sort().pop() ?? null) };
    const lem = env.find((d) => d.lembrete)?.lembrete;
    const sub = `enviado ${dia(ultimo)}${lem ? ` · ${NOME_LEMBRETE[lem]}` : ''}`;
    if (env.some((d) => d.status === 'VISUALIZADO')) return { rot: `visualizou · ${ass.length} de ${env.length}`, tom: 'in', sub };
    return { rot: `enviado · ${ass.length} de ${env.length}`, tom: 'av', sub };
  }
  if (l.pronto) return { rot: 'pronto para enviar', tom: 'cz' };
  if (!ATIVO(l.contracheque)) return { rot: 'falta contracheque', tom: 'av' };
  if (!p.espelhoPronto) return { rot: 'espelho não fechado', tom: 'cz', sub: 'dá para mandar só o contracheque' };
  return { rot: 'pronto para enviar', tom: 'cz' };
}

const filtrar: Record<Filtro, (l: Linha) => boolean> = {
  TODOS: () => true,
  PRONTOS: (l) => l.pronto,
  FALTA: (l) => !ATIVO(l.contracheque),
  AGUARDANDO: (l) => [l.espelho, l.contracheque].some((d) => PENDENTE(d?.status)),
  ASSINADOS: (l) => { const a = [l.espelho, l.contracheque].filter(ATIVO).filter((d) => d.status !== 'RASCUNHO'); return a.length > 0 && a.every((d) => d.status === 'ASSINADO'); },
  PROBLEMA: (l) => [l.espelho, l.contracheque].some((d) => d?.status === 'RECUSADO' || d?.status === 'ERRO'),
};

/** Abre o PDF numa aba nova (pré-abre a janela para o navegador não bloquear). */
export async function abrirPdf(caminho: string) {
  const w = window.open('', '_blank');
  try {
    const blob = await api.baixar(caminho);
    const url = URL.createObjectURL(blob);
    if (w) w.location.href = url; else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) { w?.close(); throw e; }
}

// ───────────────────────── tela ─────────────────────────

/**
 * Assinaturas do mês: espelho de ponto (gerado quando a Folha fecha) e
 * contracheque (PDF da contabilidade) de cada funcionário, enviados para
 * assinar pela Autentique e acompanhados até a assinatura.
 */
export function DocsAssinatura() {
  const [params, setParams] = useSearchParams();
  const { sessao } = useAuth();
  const admin = sessao?.perfil === 'ADMIN_CLIENTE';
  const mes = params.get('mes') ?? mesHoje();
  const [d, setD] = useState<Painel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('TODOS');
  const [busca, setBusca] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [aberto, setAberto] = useState<string | null>(null);
  const [lote, setLote] = useState(false);
  const [enviar, setEnviar] = useState<string[] | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const arqInd = useRef<HTMLInputElement>(null);
  const [subindoPara, setSubindoPara] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try { setD(await api.get<Painel>(`/assinaturas?comp=${mes}`)); setErro(null); }
    catch (e) { setErro((e as Error).message); }
  }, [mes]);
  useEffect(() => { setD(null); setSel(new Set()); void carregar(); }, [carregar]);
  const avisar = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 6000); };
  const ir = (m: string) => { const p = new URLSearchParams(params); p.set('mes', m); setParams(p, { replace: true }); };

  const linhas = useMemo(() => {
    const b = semAcento(busca.trim());
    return (d?.linhas ?? []).filter((l) => filtrar[filtro](l) && (!b || semAcento(`${l.nome} ${l.matricula ?? ''} ${l.email ?? ''}`).includes(b)));
  }, [d, filtro, busca]);
  const contagem = useMemo(() => {
    const c = {} as Record<Filtro, number>;
    for (const f of Object.keys(filtrar) as Filtro[]) c[f] = (d?.linhas ?? []).filter(filtrar[f]).length;
    return c;
  }, [d]);

  const enviaveis = useMemo(() => new Set((d?.linhas ?? []).filter((l) => docsAEnviar(l, d!.espelhoPronto).total > 0).map((l) => l.empregadoId)), [d]);
  const selVisiveis = linhas.filter((l) => enviaveis.has(l.empregadoId));
  const todosMarcados = selVisiveis.length > 0 && selVisiveis.every((l) => sel.has(l.empregadoId));
  const marcar = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const marcarTodos = () => setSel((s) => { const n = new Set(s); if (todosMarcados) selVisiveis.forEach((l) => n.delete(l.empregadoId)); else selVisiveis.forEach((l) => n.add(l.empregadoId)); return n; });
  const prontos = (d?.linhas ?? []).filter((l) => l.pronto).map((l) => l.empregadoId);

  async function atualizarStatus() {
    setAtualizando(true);
    try { const r = await api.post<{ atualizados: number }>('/assinaturas/sincronizar', {}); await carregar(); avisar(r.atualizados ? `${r.atualizados} ${r.atualizados === 1 ? 'documento atualizado' : 'documentos atualizados'}.` : 'Tudo em dia com a Autentique.'); }
    catch (e) { setErro((e as Error).message); }
    finally { setAtualizando(false); }
  }

  async function lembrar(ids: string[]) {
    try { const r = await api.post<{ lembrados: number }>('/assinaturas/lembrar', { ids }); avisar(r.lembrados ? `Lembrete reenviado (${r.lembrados}).` : 'Nada pendente para lembrar.'); }
    catch (e) { setErro((e as Error).message); }
  }

  function subirUm(empId: string) { setSubindoPara(empId); arqInd.current?.click(); }
  async function aoEscolherUm(f: File | undefined) {
    const emp = subindoPara; setSubindoPara(null);
    if (arqInd.current) arqInd.current.value = '';
    if (!f || !emp) return;
    try {
      await api.post('/assinaturas/contracheque', { competencia: mes, empregadoId: emp, arquivoNome: f.name, arquivoBase64: await arquivoParaBase64(f) });
      await carregar(); avisar(`Contracheque de ${d?.linhas.find((l) => l.empregadoId === emp)?.nome.split(' ')[0] ?? ''} salvo.`);
    } catch (e) { setErro((e as Error).message); }
  }

  const t = d?.totais;
  const pend = (d?.linhas ?? []).flatMap((l) => [l.espelho, l.contracheque]).filter((x) => PENDENTE(x?.status)).length;
  const detalhe = d?.linhas.find((l) => l.empregadoId === aberto) ?? null;

  return (
    <div className={cssP.pagina}>
      <div className={cssP.cab}>
        <div>
          <h2>Assinaturas</h2>
          <p>{d ? `${d.rotulo} · espelho de ponto e contracheque · via Autentique${d.integracao.sandbox && d.integracao.conectado ? ' (modo de teste)' : ''}` : 'Carregando…'}</p>
        </div>
        <div className={cssP.acoes}>
          <span className={cssP.comp}>
            <button type="button" aria-label="Mês anterior" onClick={() => ir(somarMes(mes, -1))}>‹</button>
            <input type="month" aria-label="Competência" value={mes} onChange={(e) => e.target.value && ir(e.target.value)} />
            <button type="button" aria-label="Próximo mês" onClick={() => ir(somarMes(mes, 1))} disabled={mes >= mesHoje()}>›</button>
          </span>
          {d?.integracao.conectado && <button type="button" className={cssP.btnSec} onClick={atualizarStatus} disabled={atualizando}>{atualizando ? 'Atualizando…' : 'Atualizar status'}</button>}
          <button type="button" className={cssP.btnSec} onClick={() => setLote(true)} disabled={!d}><Icone nome="documento" tamanho={16} /> Subir contracheques</button>
          <button type="button" className={cssP.btnPri} disabled={!d?.integracao.conectado || prontos.length === 0} onClick={() => setEnviar(prontos)}>
            Enviar para assinar{prontos.length ? ` (${prontos.length})` : ''}
          </button>
        </div>
      </div>

      {erro && <p className={cssP.erro} role="alert">{erro}</p>}
      {msg && <p className={cssP.okMsg} role="status">{msg}</p>}

      {d && !d.integracao.conectado && (
        <div className={cssP.faixa}>
          <div><b>A Autentique ainda não está conectada</b><small>Dá para subir os contracheques agora; o envio para assinar libera depois de colar o token da API em Integrações.</small></div>
          {admin ? <Link className={cssP.btnPri} to="/rh/integracoes">Conectar Autentique</Link> : <small>Peça ao administrador da empresa.</small>}
        </div>
      )}
      {d && d.uploadsPendentes > 0 && (
        <div className={css.pendLote}>
          <Icone nome="alerta" tamanho={18} />
          <span><b>{d.uploadsPendentes} {d.uploadsPendentes === 1 ? 'arquivo subido espera' : 'arquivos subidos esperam'} confirmação.</b> Confira de quem é cada um antes de salvar.</span>
          <button type="button" className={cssP.btnSec} onClick={() => setLote(true)}>Conferir</button>
        </div>
      )}

      {t && (
        <div className={css.kpis}>
          <div className={cssP.kpi}><small>Prontos para enviar</small><b>{t.prontos} <span>de {t.pessoas}</span></b><span>{d!.espelhoPronto ? 'espelho + contracheque' : 'o espelho sai quando a Folha fechar'}</span></div>
          <div className={cssP.kpi}><small>Falta contracheque</small><b>{t.faltaContracheque}</b><span>{t.faltaContracheque ? 'suba o PDF da contabilidade' : 'todos subidos'}</span></div>
          <div className={cssP.kpi}>
            <small>Enviados</small><b>{t.enviados}</b>
            {t.enviados > 0 && <div className={cssP.barra} aria-hidden="true"><i style={{ width: `${(t.assinados / t.enviados) * 100}%`, background: 'var(--ok-text)' }} /><i style={{ width: `${(t.visualizados / t.enviados) * 100}%`, background: 'var(--coral)' }} /><i style={{ width: `${(t.recusados / t.enviados) * 100}%`, background: 'var(--erro-text)' }} /></div>}
            <span>{t.assinados} {t.assinados === 1 ? 'assinado' : 'assinados'} · {t.visualizados} {t.visualizados === 1 ? 'visualizou' : 'visualizaram'}{t.recusados ? ` · ${t.recusados} recusado${t.recusados > 1 ? 's' : ''}` : ''}</span>
          </div>
          <div className={cssP.kpi}><small>Sem e-mail</small><b>{t.semEmail}</b><span>{t.semEmail ? 'vão pelo WhatsApp ou pelo app' : 'todos recebem por e-mail'}</span></div>
        </div>
      )}

      <div className={cssP.filtros} role="group" aria-label="Filtrar">
        {([['TODOS', 'Todos'], ['PRONTOS', 'Prontos'], ['FALTA', 'Falta contracheque'], ['AGUARDANDO', 'Aguardando assinatura'], ['ASSINADOS', 'Assinados'], ['PROBLEMA', 'Recusados ou com erro']] as [Filtro, string][]).map(([f, r]) => (
          <button key={f} type="button" className={`${cssP.fl} ${filtro === f ? cssP.flOn : ''}`} aria-pressed={filtro === f} onClick={() => setFiltro(f)}>{r}<span>{contagem[f]}</span></button>
        ))}
        <input className={cssP.busca} type="search" placeholder="Buscar funcionário" aria-label="Buscar funcionário" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      {sel.size > 0 && (
        <div className={cssP.lote} role="region" aria-label="Selecionados">
          <b>{sel.size} {sel.size === 1 ? 'selecionado' : 'selecionados'}</b>
          <span style={{ flex: 1 }} />
          <button type="button" className={cssP.btnSec} onClick={() => setSel(new Set())}>Limpar</button>
          <button type="button" className={`${cssP.btnPri} ${cssP.pequeno}`} disabled={!d?.integracao.conectado} onClick={() => setEnviar([...sel])}>Enviar {sel.size} para assinar</button>
        </div>
      )}

      {!d && !erro && <div className={css.sk} aria-busy="true"><i /><i /><i /><i /></div>}
      {d && d.linhas.length === 0 && (
        <div className={cssP.vazio}><b>Nenhum funcionário neste mês</b><p>Só aparecem funcionários ativos com início do ponto até o fim de {d.rotulo.toLowerCase()}.</p></div>
      )}
      {d && d.linhas.length > 0 && linhas.length === 0 && (
        <div className={cssP.vazio}><b>Ninguém neste filtro</b><p>Troque o filtro ou limpe a busca.</p><button type="button" className={cssP.btnSec} onClick={() => { setFiltro('TODOS'); setBusca(''); }}>Mostrar todos</button></div>
      )}

      {d && linhas.length > 0 && (
        <div className={cssP.tabela}>
          <table>
            <thead><tr>
              <th style={{ width: 36 }}><input type="checkbox" className={cssP.chk} aria-label="Selecionar todos os que podem ser enviados" checked={todosMarcados} onChange={marcarTodos} disabled={selVisiveis.length === 0} /></th>
              <th>Funcionário</th><th>Espelho de ponto</th><th>Contracheque</th><th>Autentique</th><th />
            </tr></thead>
            <tbody>
              {linhas.map((l) => {
                const s = situacao(l, d);
                const pode = enviaveis.has(l.empregadoId);
                const pendentes = [l.espelho, l.contracheque].filter((x): x is DocAss => PENDENTE(x?.status));
                return (
                  <tr key={l.empregadoId}>
                    <td><input type="checkbox" className={cssP.chk} aria-label={`Selecionar ${l.nome}`} checked={sel.has(l.empregadoId)} disabled={!pode} onChange={() => marcar(l.empregadoId)} /></td>
                    <td>
                      <button type="button" className={`${cssP.linhaBtn} ${cssP.pes}`} onClick={() => setAberto(l.empregadoId)}>
                        <Avatar id={l.empregadoId} nome={l.nome} tamanho={34} />
                        <span><b>{l.nome}</b><small>{l.email ?? (l.telefone ? `sem e-mail · ${fmtFone(l.telefone)}` : l.temApp ? 'sem e-mail · só pelo app' : 'sem e-mail, celular nem app')}</small></span>
                      </button>
                    </td>
                    <td><CelulaEspelho l={l} p={d} /></td>
                    <td><CelulaCc l={l} onSubir={() => subirUm(l.empregadoId)} /></td>
                    <td>
                      <span className={css.stat}>
                        <span className={`${cssP.tag} ${cssP[`t-${s.tom}`]}`}>{s.rot}</span>
                        {s.sub && <small title={s.sub}>{s.sub}</small>}
                        <Pontos l={l} />
                      </span>
                    </td>
                    <td className={cssP.r}>
                      {pendentes.length > 0
                        ? <button type="button" className={cssP.btnTxt} onClick={() => lembrar(pendentes.map((x) => x.id))}>Lembrar</button>
                        : <button type="button" className={cssP.btnTxt} onClick={() => setAberto(l.empregadoId)}>Abrir</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {d && <p className={cssP.hint}>Cada arquivo vira um documento na Autentique (até 2 por funcionário). O status atualiza sozinho quando a pessoa visualiza, assina ou recusa{pend ? `; ${pend} ${pend === 1 ? 'documento aguarda' : 'documentos aguardam'} assinatura` : ''}.</p>}

      <input ref={arqInd} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => void aoEscolherUm(e.target.files?.[0])} />

      {lote && d && <ModalLote painel={d} onFechar={() => setLote(false)} onSalvo={async (m) => { setLote(false); await carregar(); avisar(m); }} />}
      {enviar && d && <ModalEnviar painel={d} ids={enviar} onFechar={() => setEnviar(null)} onEnviado={async () => { setSel(new Set()); await carregar(); }} />}
      {detalhe && d && <ModalDetalhe l={detalhe} p={d} onFechar={() => setAberto(null)} recarregar={carregar} avisar={avisar}
        onEnviar={() => { setAberto(null); setEnviar([detalhe.empregadoId]); }} />}
    </div>
  );
}

function CelulaEspelho({ l, p }: { l: Linha; p: Painel }) {
  if (ATIVO(l.espelho)) return <span className={css.doc}><span className={css.ic}>PDF</span><span>Espelho {mesCurto(p.competencia)}<small>gerado {dia(l.espelho.criadoEm)}</small></span></span>;
  if (p.espelhoPronto) return <span className={css.doc}><span className={css.ic}>PDF</span><span>Espelho {mesCurto(p.competencia)}<small>Folha fechada {dia(p.fechadoEm)} · sai no envio</small></span></span>;
  return <span className={css.doc}><span className={`${css.ic} ${css.icOff}`}>PDF</span><span className={css.apagado}>Espelho<small>aguardando o fechamento da Folha</small></span></span>;
}

function CelulaCc({ l, onSubir }: { l: Linha; onSubir: () => void }) {
  if (ATIVO(l.contracheque)) return <span className={css.doc}><span className={css.ic}>PDF</span><span className={css.nomeArq} title={l.contracheque.arquivoNome}>{l.contracheque.arquivoNome}<small>subido {dia(l.contracheque.criadoEm)} · {tam(l.contracheque.arquivoBytes)}</small></span></span>;
  return <span className={css.doc}><span className={`${css.ic} ${css.icOff}`}>PDF</span><button type="button" className={css.up} onClick={onSubir}>Subir PDF</button></span>;
}

function Pontos({ l }: { l: Linha }) {
  const docs = [l.espelho, l.contracheque].filter(ATIVO).filter((x) => x.status !== 'RASCUNHO');
  if (!docs.length) return null;
  const cls = (s: StatusDoc) => s === 'ASSINADO' ? css.pf : s === 'VISUALIZADO' ? css.pv : s === 'RECUSADO' || s === 'ERRO' ? css.pe : css.pa;
  return <span className={css.pontos} aria-hidden="true">{docs.map((x) => <i key={x.id} className={cls(x.status)} />)}</span>;
}

// ───────────────────────── subir em lote ─────────────────────────

const COMO: Record<string, { rot: string; tom: string }> = {
  CPF: { rot: 'CPF', tom: 't-ok' }, NOME: { rot: 'nome', tom: 't-ok' }, CPF_PDF: { rot: 'CPF no PDF', tom: 't-in' }, NOME_PDF: { rot: 'nome no PDF', tom: 't-in' },
};

function ModalLote({ painel, onFechar, onSalvo }: { painel: Painel; onFechar: () => void; onSalvo: (msg: string) => void | Promise<void> }) {
  const [ups, setUps] = useState<Upload[] | null>(null);
  const [escolha, setEscolha] = useState<Record<string, string>>({});
  const [lendo, setLendo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const comp = painel.competencia;

  const carregar = useCallback(async () => {
    const r = await api.get<Upload[]>(`/assinaturas/lote?comp=${comp}`);
    setUps(r);
    setEscolha((e) => { const n = { ...e }; for (const u of r) if (!(u.id in n)) n[u.id] = u.empregadoId ?? ''; return n; });
  }, [comp]);
  useEffect(() => { carregar().catch((e) => setErro((e as Error).message)); }, [carregar]);

  async function subir(arqs: File[]) {
    setErro(null);
    const validos = arqs.filter((f) => /\.(pdf|zip)$/i.test(f.name));
    if (validos.length < arqs.length) setErro('Só PDF ou ZIP. Os outros arquivos foram ignorados.');
    for (const [i, f] of validos.entries()) {
      setLendo(validos.length > 1 ? `Lendo ${i + 1} de ${validos.length}: ${f.name}` : `Lendo ${f.name}…`);
      try {
        if (f.size > 10 * 1048576) throw new Error(`${f.name}: maior que 10 MB.`);
        await api.post('/assinaturas/lote', { competencia: comp, arquivoNome: f.name, arquivoBase64: await arquivoParaBase64(f) });
      } catch (e) { setErro((e as Error).message); }
    }
    setLendo(null);
    await carregar().catch(() => {});
  }

  const lista = ups ?? [];
  const usados = new Map<string, number>();
  for (const u of lista) { const e = escolha[u.id]; if (e) usados.set(e, (usados.get(e) ?? 0) + 1); }
  const repetidos = [...usados.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  const ligados = lista.filter((u) => escolha[u.id]).length;
  const jaTem = lista.filter((u) => { const e = escolha[u.id]; const l = painel.linhas.find((x) => x.empregadoId === e); return l && ATIVO(l.contracheque); }).length;
  const nomeDe = (id: string) => painel.linhas.find((l) => l.empregadoId === id)?.nome ?? '';

  async function salvar() {
    setSalvando(true); setErro(null);
    try {
      const r = await api.post<{ salvos: number; descartados: number }>('/assinaturas/lote/confirmar', { competencia: comp, itens: lista.map((u) => ({ uploadId: u.id, empregadoId: escolha[u.id] || null })) });
      await onSalvo(`${r.salvos} ${r.salvos === 1 ? 'contracheque salvo' : 'contracheques salvos'}${r.descartados ? ` · ${r.descartados} sem funcionário descartado${r.descartados > 1 ? 's' : ''}` : ''}.`);
    } catch (e) { setErro((e as Error).message); setSalvando(false); }
  }
  async function descartar() {
    setSalvando(true);
    try { await api.del(`/assinaturas/lote?comp=${comp}`); await onSalvo('Arquivos descartados.'); }
    catch (e) { setErro((e as Error).message); setSalvando(false); }
  }

  return (
    <ModalPessoa aberto onFechar={onFechar} compacto largura={900}
      titulo={`Subir contracheques · ${painel.rotulo.split('/')[0]!.toLowerCase()}`}
      meta="PDF ou ZIP · até 10 MB por arquivo · nada vai para o funcionário antes de você enviar"
      rodape={<>
        {lista.length > 0 ? <button type="button" className={`${cssP.btnTxt} ${cssP.btnPerigo}`} onClick={descartar} disabled={salvando}>Descartar tudo</button>
          : <button type="button" className={cssP.btnSec} onClick={onFechar}>Fechar</button>}
        <span style={{ flex: 1 }} />
        {erro && <span className={css.erroRod} role="alert">{erro}</span>}
        <button type="button" className={cssP.btnPri} disabled={salvando || !!lendo || ligados === 0 || repetidos.length > 0} onClick={salvar}>
          {salvando ? 'Salvando…' : `Salvar ${ligados} ${ligados === 1 ? 'contracheque' : 'contracheques'}`}
        </button>
      </>}>
      <div className={css.loteCorpo}>
        <button type="button" className={`${css.drop} ${arrastando ? css.dropOn : ''}`} onClick={() => input.current?.click()} disabled={!!lendo}
          onDragOver={(e) => { e.preventDefault(); setArrastando(true); }} onDragLeave={() => setArrastando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastando(false); void subir([...e.dataTransfer.files]); }}>
          <Icone nome="documento" tamanho={26} />
          <b>{lendo ?? 'Arraste os PDFs (ou o ZIP) aqui'}</b>
          <small>{lendo ? 'Procurando CPF e nome em cada arquivo…' : `ou clique para escolher${lista.length ? ` · ${lista.length} ${lista.length === 1 ? 'arquivo lido' : 'arquivos lidos'}` : ''}`}</small>
        </button>
        <input ref={input} type="file" multiple hidden accept="application/pdf,.pdf,application/zip,.zip" onChange={(e) => { void subir([...(e.target.files ?? [])]); e.target.value = ''; }} />

        {ups === null && <div className={css.sk}><i /><i /></div>}
        {lista.length > 0 && (
          <div className={css.matches}>
            <div className={`${css.match} ${css.matchTh}`}><span>Arquivo</span><span /><span>Funcionário</span><span>Como achou</span></div>
            {lista.map((u) => {
              const e = escolha[u.id] ?? '';
              const auto = u.empregadoId && e === u.empregadoId ? COMO[u.como ?? ''] : null;
              return (
                <div key={u.id} className={`${css.match} ${repetidos.includes(e) ? css.matchErro : ''}`}>
                  <span className={css.arq} title={u.arquivoNome}>{u.arquivoNome}<small>{tam(u.arquivoBytes)}</small></span>
                  <span aria-hidden="true">→</span>
                  <span className={css.escolhe}>
                    {e && <Avatar id={e} nome={nomeDe(e)} tamanho={28} />}
                    <select aria-label={`Funcionário de ${u.arquivoNome}`} value={e} onChange={(ev) => setEscolha((s) => ({ ...s, [u.id]: ev.target.value }))}>
                      <option value="">Escolha o funcionário…</option>
                      {painel.linhas.map((l) => <option key={l.empregadoId} value={l.empregadoId}>{l.nome}{l.matricula ? ` · ${l.matricula}` : ''}</option>)}
                    </select>
                  </span>
                  <span>{auto ? <span className={`${cssP.tag} ${cssP[auto.tom]}`}>{auto.rot}</span> : e ? <span className={`${cssP.tag} ${cssP['t-cz']}`}>escolhido</span> : <span className={`${cssP.tag} ${cssP['t-av']}`}>não achou</span>}</span>
                </div>
              );
            })}
          </div>
        )}
        {lista.length > 0 && (
          <p className={css.info}>
            {ligados} de {lista.length} com funcionário{lista.length - ligados > 0 ? ` · ${lista.length - ligados} sem dono ${lista.length - ligados === 1 ? 'vai ser descartado' : 'vão ser descartados'}` : ''}.
            {jaTem > 0 && ` ${jaTem} ${jaTem === 1 ? 'pessoa já tinha' : 'pessoas já tinham'} contracheque no mês: fica o novo (se o antigo já tinha ido para assinar, o envio é cancelado na Autentique).`}
            {repetidos.length > 0 && <b className={css.erroTxt}> {repetidos.map(nomeDe).join(', ')} {repetidos.length === 1 ? 'está' : 'estão'} em mais de um arquivo — escolha um só.</b>}
          </p>
        )}
      </div>
    </ModalPessoa>
  );
}

// ───────────────────────── confirmar envio ─────────────────────────

const daquiDias = (n: number) => new Date(Date.now() - 3 * 3600_000 + n * 86400_000).toISOString().slice(0, 10);

function ModalEnviar({ painel, ids, onFechar, onEnviado }: { painel: Painel; ids: string[]; onFechar: () => void; onEnviado: () => void | Promise<void> }) {
  const mesNome = painel.rotulo.split('/')[0]!.toLowerCase();
  const [canal, setCanal] = useState<'AUTO' | 'APP'>('AUTO');
  const [mensagem, setMensagem] = useState(`Olá! Seguem seu espelho de ponto e seu contracheque de ${mesNome} para assinatura. Qualquer dúvida, fale com o RH.`);
  const [lembrete, setLembrete] = useState<'DAILY' | 'WEEKLY' | ''>('DAILY');
  const [prazo, setPrazo] = useState(daquiDias(7));
  const [enviando, setEnviando] = useState<number | null>(null);
  const [res, setRes] = useState<RespEnvio | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const linhas = painel.linhas.filter((l) => ids.includes(l.empregadoId)).map((l) => ({ l, v: docsAEnviar(l, painel.espelhoPronto) })).filter((x) => x.v.total > 0);
  const docs = linhas.reduce((s, x) => s + x.v.total, 0);
  const soCc = linhas.filter((x) => !x.v.espelho && x.v.cc).length;
  const porCanal = (c: Canal) => linhas.filter((x) => (canal === 'APP' ? 'APP' : x.l.canal) === c).length;
  const semAviso = linhas.filter((x) => (canal === 'APP' || x.l.canal === 'APP') && !x.l.temApp);
  const fora = painel.linhas.length - linhas.length;
  const foraSemCc = painel.linhas.filter((l) => !linhas.some((x) => x.l.empregadoId === l.empregadoId) && !ATIVO(l.contracheque)).length;

  async function confirmar() {
    setEnviando(0); setErro(null);
    // Mostra o avanço (a API manda um a um, respeitando o limite da Autentique).
    const t = setInterval(() => setEnviando((n) => Math.min((n ?? 0) + 1, docs - 1)), 1150);
    try {
      const r = await api.post<RespEnvio>('/assinaturas/enviar', {
        competencia: painel.competencia, empregadoIds: linhas.map((x) => x.l.empregadoId), canal,
        mensagem: mensagem.trim() || null, lembrete: lembrete || null, prazo: prazo || null,
      });
      setRes(r); await onEnviado();
    } catch (e) { setErro((e as Error).message); }
    finally { clearInterval(t); setEnviando(null); }
  }

  if (res) {
    return (
      <Modal titulo={res.erros.length ? 'Envio com pendências' : 'Enviado para assinar'} onFechar={onFechar}>
        <div className={css.resultado}>
          <p className={res.enviados ? cssP.okMsg : cssP.hint}>{res.enviados} {res.enviados === 1 ? 'documento enviado' : 'documentos enviados'} para a Autentique{painel.integracao.sandbox ? ' (modo de teste)' : ''}.</p>
          {res.erros.length > 0 && (
            <>
              <p className={cssP.erro}>{res.erros.length} não {res.erros.length === 1 ? 'foi' : 'foram'}:</p>
              <ul className={css.erros}>{res.erros.map((e, i) => <li key={i}><b>{e.nome}</b> · {NOME_TIPO[e.tipo].toLowerCase()}<small>{e.erro}</small></li>)}</ul>
              <p className={cssP.hint}>Esses ficam marcados com erro. Corrija (e-mail, celular, arquivo) e envie de novo.</p>
            </>
          )}
          <div className={cssP.rodape}><button type="button" className={cssP.btnPri} onClick={onFechar} autoFocus>Pronto</button></div>
        </div>
      </Modal>
    );
  }

  return (
    <ModalPessoa aberto onFechar={() => { if (enviando === null) onFechar(); }} compacto largura={900}
      titulo={`Enviar para assinar · ${linhas.length} ${linhas.length === 1 ? 'funcionário' : 'funcionários'}`}
      meta={`${painel.rotulo} · ${painel.espelhoPronto ? 'espelho de ponto + contracheque' : 'contracheque (o espelho sai quando a Folha fechar)'}`}
      rodape={<>
        <button type="button" className={cssP.btnSec} onClick={onFechar} disabled={enviando !== null}>Cancelar</button>
        <span style={{ flex: 1 }} />
        {erro && <span className={css.erroRod} role="alert">{erro}</span>}
        <button type="button" className={cssP.btnPri} onClick={confirmar} disabled={enviando !== null || docs === 0} data-autofoco>
          {enviando !== null ? `Enviando ${Math.min(enviando + 1, docs)} de ${docs}…` : `Enviar ${docs} ${docs === 1 ? 'documento' : 'documentos'}`}
        </button>
      </>}>
      <div className={css.grade}>
        <div className={css.col}>
          <fieldset className={css.grupo}>
            <legend>Como cada um recebe</legend>
            <label className={cssP.opc}>
              <input type="radio" name="canal" checked={canal === 'AUTO'} onChange={() => setCanal('AUTO')} />
              <span><b>E-mail cadastrado</b><small>{porCanal('EMAIL')} com e-mail.{porCanal('WHATSAPP') ? ` ${porCanal('WHATSAPP')} sem e-mail ${porCanal('WHATSAPP') === 1 ? 'vai' : 'vão'} pelo WhatsApp.` : ''}{porCanal('APP') ? ` ${porCanal('APP')} sem e-mail nem celular: só pelo app.` : ''}</small></span>
            </label>
            <label className={cssP.opc}>
              <input type="radio" name="canal" checked={canal === 'APP'} onChange={() => setCanal('APP')} />
              <span><b>Só no app PontoSnap</b><small>Ninguém recebe e-mail; assinam pelo app, em Documentos.</small></span>
            </label>
          </fieldset>
          <div className={cssP.campo}>
            <label htmlFor="env-msg">Mensagem {canal === 'APP' ? 'no documento' : 'no e-mail'}</label>
            <textarea id="env-msg" value={mensagem} maxLength={1000} onChange={(e) => setMensagem(e.target.value)} />
          </div>
          <div className={cssP.campos}>
            <div className={cssP.campo}>
              <label htmlFor="env-lem">Lembrete</label>
              <select id="env-lem" value={lembrete} onChange={(e) => setLembrete(e.target.value as typeof lembrete)} disabled={canal === 'APP'}>
                <option value="DAILY">Diário</option><option value="WEEKLY">Semanal</option><option value="">Sem lembrete</option>
              </select>
            </div>
            <div className={cssP.campo}>
              <label htmlFor="env-prazo">Prazo para assinar</label>
              <input id="env-prazo" type="date" value={prazo} min={daquiDias(1)} onChange={(e) => setPrazo(e.target.value)} />
            </div>
          </div>
        </div>
        <section className={css.resumo} aria-live="polite">
          <h4>Resumo</h4>
          <div className={cssP.lin}><span>Funcionários</span><span className={cssP.mono}>{linhas.length}</span></div>
          <div className={cssP.lin}><span>Documentos na Autentique</span><span className={cssP.mono}>{docs}</span></div>
          {canal === 'AUTO' && <div className={cssP.lin}><span>E-mail · WhatsApp · app</span><span className={cssP.mono}>{porCanal('EMAIL')} · {porCanal('WHATSAPP')} · {porCanal('APP')}</span></div>}
          <div className={cssP.lin}><span>Fora do envio</span><span className={cssP.mono}>{fora}</span></div>
          {fora > 0 && <p className={css.nota}>Ficaram de fora {fora === 1 ? '1 pessoa' : `${fora} pessoas`}{foraSemCc ? ` (${foraSemCc} sem contracheque)` : ''} ou já enviados. Dá para enviar depois.</p>}
          {soCc > 0 && <p className={css.nota}>{soCc === 1 ? '1 pessoa recebe' : `${soCc} pessoas recebem`} só o contracheque agora{painel.espelhoPronto ? ' (o espelho já foi)' : '; o espelho vai quando a Folha fechar'}.</p>}
          {semAviso.length > 0 && <p className={css.alerta}>{semAviso.map((x) => x.l.nome.split(' ')[0]).slice(0, 4).join(', ')}{semAviso.length > 4 ? ` e mais ${semAviso.length - 4}` : ''}: sem e-mail, celular nem acesso ao app — não {semAviso.length === 1 ? 'vai' : 'vão'} ser {semAviso.length === 1 ? 'avisado' : 'avisados'}. Cadastre um contato em Funcionários.</p>}
          {painel.integracao.sandbox
            ? <p className={css.teste}>Modo de teste ligado em Integrações: os documentos vão com a marca "teste" e não gastam crédito.</p>
            : <p className={css.nota}>Cada documento gasta 1 do seu plano na Autentique.</p>}
        </section>
      </div>
    </ModalPessoa>
  );
}

// ───────────────────────── detalhe ─────────────────────────

function ModalDetalhe({ l, p, onFechar, recarregar, avisar, onEnviar }: {
  l: Linha; p: Painel; onFechar: () => void; recarregar: () => Promise<void>; avisar: (m: string) => void; onEnviar: () => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [cancelar, setCancelar] = useState<DocAss | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const docs = [l.espelho, l.contracheque].filter(ATIVO).filter((x) => x.status !== 'RASCUNHO');
  const ass = docs.filter((x) => x.status === 'ASSINADO').length;
  const pend = [l.espelho, l.contracheque].filter((x): x is DocAss => PENDENTE(x?.status));
  const vai = docsAEnviar(l, p.espelhoPronto);

  async function acao(f: () => Promise<unknown>, ok?: string) {
    setOcupado(true); setErro(null);
    try { await f(); await recarregar(); if (ok) avisar(ok); }
    catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  }
  async function trocar(f: File | undefined) {
    if (input.current) input.current.value = '';
    if (!f) return;
    await acao(async () => api.post('/assinaturas/contracheque', { competencia: p.competencia, empregadoId: l.empregadoId, arquivoNome: f.name, arquivoBase64: await arquivoParaBase64(f) }),
      PENDENTE(l.contracheque?.status) ? 'Contracheque trocado. O envio anterior foi cancelado; envie de novo.' : 'Contracheque salvo.');
  }
  const ver = (d: DocAss, assinado = false) => abrirPdf(`/assinaturas/documentos/${d.id}/arquivo${assinado ? '?assinado=1' : ''}`).catch((e) => setErro((e as Error).message));

  const contato = l.email ?? (l.telefone ? `WhatsApp ${fmtFone(l.telefone)}` : l.temApp ? 'só pelo app' : 'sem contato');
  return (
    <ModalPessoa aberto onFechar={onFechar} largura={920}
      foto={<Avatar id={l.empregadoId} nome={l.nome} tamanho={104} />}
      titulo={l.nome}
      meta={<>{l.matricula ? `Matrícula ${l.matricula} · ` : ''}{contato}</>}
      chips={<>
        <span className={`${cssP.tag} ${cssP['t-cz']}`}>{p.rotulo.toLowerCase()}</span>
        {docs.length > 0 && <span className={`${cssP.tag} ${cssP[ass === docs.length ? 't-ok' : 't-in']}`}>{ass} de {docs.length} {docs.length === 1 ? 'assinado' : 'assinados'}</span>}
        {l.temApp && <span className={`${cssP.tag} ${cssP['t-cz']}`}>usa o app</span>}
      </>}
      rodape={<>
        <span style={{ flex: 1 }} />
        {erro && <span className={css.erroRod} role="alert">{erro}</span>}
        {pend.length > 0 && <button type="button" className={cssP.btnSec} disabled={ocupado} onClick={() => acao(() => api.post('/assinaturas/lembrar', { ids: pend.map((x) => x.id) }), 'Lembrete reenviado.')}>
          Lembrar {pend.length === 1 ? 'do documento' : `dos ${pend.length} documentos`}
        </button>}
        {vai.total > 0 && <button type="button" className={cssP.btnPri} disabled={ocupado || !p.integracao.conectado} onClick={onEnviar} data-autofoco>
          Enviar {vai.total === 1 ? (vai.cc ? 'contracheque' : 'espelho') : 'os 2'} para assinar
        </button>}
      </>}>
      <div className={css.cards}>
        <CartaoDoc tipo="ESPELHO" d={l.espelho} p={p} ocupado={ocupado} onVer={ver}
          vazio={p.espelhoPronto ? `Folha fechada em ${dia(p.fechadoEm)}. O espelho é gerado na hora do envio, com as batidas do mês.` : 'O espelho sai quando a Folha do mês for fechada em Folha e benefícios.'}
          onCancelar={setCancelar} />
        <CartaoDoc tipo="CONTRACHEQUE" d={l.contracheque} p={p} ocupado={ocupado} onVer={ver}
          vazio="Ainda não subiu o contracheque deste mês."
          onCancelar={setCancelar}
          extra={<>
            {(!l.contracheque || l.contracheque.status !== 'ASSINADO') && <button type="button" className={`${cssP.btnSec} ${cssP.pequeno}`} disabled={ocupado} onClick={() => input.current?.click()}>
              {ATIVO(l.contracheque) ? (PENDENTE(l.contracheque.status) ? 'Trocar arquivo' : 'Trocar arquivo') : 'Subir PDF'}
            </button>}
            {l.contracheque?.status === 'RASCUNHO' && <button type="button" className={`${cssP.btnTxt} ${cssP.btnPerigo}`} disabled={ocupado}
              onClick={() => acao(() => api.del(`/assinaturas/contracheque/${l.contracheque!.id}`), 'Contracheque removido.')}>Remover</button>}
          </>} />
      </div>
      {PENDENTE(l.contracheque?.status) && <p className={cssP.hint} style={{ marginTop: 12 }}>Trocar o arquivo de um contracheque já enviado cancela o documento na Autentique (o link antigo deixa de valer) e ele volta para enviar de novo.</p>}
      <input ref={input} type="file" hidden accept="application/pdf,.pdf" onChange={(e) => void trocar(e.target.files?.[0])} />

      {cancelar && (
        <Modal titulo={`Cancelar o envio do ${NOME_TIPO[cancelar.tipo].toLowerCase()}?`} onFechar={() => setCancelar(null)}>
          <div className={css.resultado} data-dialogo>
            <p className={cssP.hint}>O documento é excluído da Autentique e o link que {l.nome.split(' ')[0]} recebeu deixa de funcionar. Depois dá para enviar de novo.</p>
            <div className={cssP.rodape}>
              <button type="button" className={cssP.btnSec} onClick={() => setCancelar(null)} autoFocus>Manter</button>
              <button type="button" className={cssP.btnPri} disabled={ocupado} onClick={async () => { const c = cancelar; setCancelar(null); await acao(() => api.post(`/assinaturas/documentos/${c.id}/cancelar`), 'Envio cancelado.'); }}>Cancelar envio</button>
            </div>
          </div>
        </Modal>
      )}
    </ModalPessoa>
  );
}

function CartaoDoc({ tipo, d, p, vazio, ocupado, onVer, onCancelar, extra }: {
  tipo: TipoDoc; d: DocAss | null; p: Painel; vazio: string; ocupado: boolean;
  onVer: (d: DocAss, assinado?: boolean) => void; onCancelar: (d: DocAss) => void; extra?: React.ReactNode;
}) {
  const ok = ATIVO(d) ? d : null;
  const passos: { f: 'f' | 'a' | 'e' | 'n'; rot: string; sub: string }[] = [];
  if (ok && ok.status !== 'RASCUNHO') {
    passos.push({ f: ok.status === 'ERRO' && !ok.enviadoEm ? 'e' : 'f', rot: ok.status === 'ERRO' && !ok.enviadoEm ? 'Não foi enviado' : 'Enviado',
      sub: ok.status === 'ERRO' && !ok.enviadoEm ? ok.erro ?? '' : `${diaHora(ok.enviadoEm)} · ${NOME_CANAL[ok.canal ?? ''] ?? ''}${ok.sandbox ? ' · teste' : ''}` });
    if (ok.enviadoEm) {
      passos.push(ok.visualizadoEm ? { f: 'f', rot: 'Visualizou', sub: diaHora(ok.visualizadoEm) } : { f: 'n', rot: 'Visualizou', sub: 'ainda não abriu' });
      if (ok.status === 'ASSINADO') passos.push({ f: 'f', rot: 'Assinou', sub: diaHora(ok.assinadoEm) });
      else if (ok.status === 'RECUSADO') passos.push({ f: 'e', rot: 'Recusou', sub: `${diaHora(ok.recusadoEm)}${ok.motivoRecusa ? ` · "${ok.motivoRecusa}"` : ''}` });
      else passos.push({ f: 'a', rot: 'Assinatura', sub: `pendente${ok.lembrete ? ` · ${NOME_LEMBRETE[ok.lembrete]}` : ''}${ok.prazo ? ` até ${dia(ok.prazo)}` : ''}` });
    }
  }
  return (
    <section className={css.card}>
      <h4>{NOME_TIPO[tipo]} · {mesCurto(p.competencia)}</h4>
      {ok && <p className={css.arqLinha}><span className={css.ic}>PDF</span><span className={css.nomeArq}>{ok.arquivoNome}</span><small>{tam(ok.arquivoBytes)}</small></p>}
      {!ok && <p className={cssP.hint}>{vazio}</p>}
      {ok?.status === 'RASCUNHO' && <p className={cssP.hint}>Pronto para enviar.</p>}
      {ok?.status === 'RECUSADO' && <p className={cssP.hint}>{tipo === 'ESPELHO' ? 'Corrija o ponto e envie de novo: o espelho é gerado outra vez com as batidas atualizadas.' : 'Troque o arquivo se precisar e envie de novo.'}</p>}
      {passos.length > 0 && (
        <ol className={css.tl}>
          {passos.map((s, i) => <li key={i} className={css[`tl${s.f}`]}><i aria-hidden="true">{s.f === 'f' ? '✓' : s.f === 'e' ? '!' : i + 1}</i><div><b>{s.rot}</b><small>{s.sub}</small></div></li>)}
        </ol>
      )}
      <div className={css.cardAcoes}>
        {ok && <button type="button" className={`${cssP.btnSec} ${cssP.pequeno}`} onClick={() => onVer(ok)}>Ver PDF</button>}
        {ok?.temAssinado && <button type="button" className={`${cssP.btnPri} ${cssP.pequeno}`} onClick={() => onVer(ok, true)}>Baixar assinado</button>}
        {extra}
        {ok && PENDENTE(ok.status) && <button type="button" className={`${cssP.btnTxt} ${cssP.btnPerigo}`} disabled={ocupado} onClick={() => onCancelar(ok)}>Cancelar envio</button>}
      </div>
    </section>
  );
}
