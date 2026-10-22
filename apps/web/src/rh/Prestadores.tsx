import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { salvarBlob } from '../lib/download';
import { mascaraDoc } from '../lib/formato';
import {
  brl, dataBr, dataIsoBr, diaMes, fmtTel, haQuanto, ROTULO_SITUACAO, TOM_SITUACAO,
  type ConviteGerado, type LinhaRh, type ListaModelos, type PainelRh, type Situacao, type UnidadeRh,
} from '../lib/prestador';
import { Caricatura, hash, useAvatares } from '../components/Avatar';
import { Modal } from '../components/Modal';
import { ModalPessoa } from '../components/ModalPessoa';
import { Icone } from '../components/Icone';
import { FecharPessoa } from './FecharPessoa';
import css from './Prestadores.module.css';

const mesHoje = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7);
const somarMes = (m: string, n: number) => { const d = new Date(`${m}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
const proxDiaUtil = (base: string, dias: number) => {
  const d = new Date(`${base}T12:00:00Z`);
  let n = 0;
  while (n < dias) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n++; }
  return d.toISOString().slice(0, 10);
};

type Filtro = 'TODOS' | 'FALTA' | 'CONFERIR' | 'RECUSADA' | 'APROVADA' | 'CONTESTOU' | 'SEM_ACESSO';
const FILTROS: { id: Filtro; rotulo: string }[] = [
  { id: 'TODOS', rotulo: 'Todos' }, { id: 'FALTA', rotulo: 'Falta nota' }, { id: 'CONFERIR', rotulo: 'Para conferir' },
  { id: 'RECUSADA', rotulo: 'Recusadas' }, { id: 'APROVADA', rotulo: 'Aprovadas' }, { id: 'CONTESTOU', rotulo: 'Contestaram valor' },
  { id: 'SEM_ACESSO', rotulo: 'Sem acesso' },
];
const passaFiltro = (l: LinhaRh, f: Filtro) => {
  const s = l.unidades.map((u) => u.situacao);
  switch (f) {
    case 'TODOS': return true;
    case 'FALTA': return s.includes('FALTA');
    case 'CONFERIR': return s.includes('CONFERIR');
    case 'RECUSADA': return s.includes('RECUSADA');
    case 'APROVADA': return s.length > 0 && s.every((x) => x === 'APROVADA' || x === 'RH');
    case 'CONTESTOU': return s.includes('CONTESTOU');
    case 'SEM_ACESSO': return l.acesso.status !== 'ATIVO';
  }
};

type Ordem = 'NOME' | 'VALOR' | 'SITUACAO' | 'EMPRESA';
const ORDENS: { id: Ordem; rotulo: string }[] = [
  { id: 'NOME', rotulo: 'Nome A–Z' }, { id: 'VALOR', rotulo: 'Maior valor' }, { id: 'SITUACAO', rotulo: 'Situação da nota' }, { id: 'EMPRESA', rotulo: 'Empresa' },
];
// Situação: o que pede ação primeiro.
const PESO_SIT: Record<Situacao, number> = { CONFERIR: 0, CONTESTOU: 1, RECUSADA: 2, FALTA: 3, NAO_LIBERADO: 4, RH: 5, APROVADA: 6 };
const lerOrdem = (): Ordem => { try { const o = localStorage.getItem('pontosnap.prestadores.ordem'); return (ORDENS.some((x) => x.id === o) ? o : 'NOME') as Ordem; } catch { return 'NOME'; } };
const semAcento = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Rosto do prestador: a foto que ele mandou no app ou, sem foto, a caricatura. */
export function Rosto({ id, semente, tamanho = 34 }: { id: string; semente: number | null; tamanho?: number }) {
  const { dados } = useAvatares();
  const foto = dados?.prestadores[id]?.foto ?? null;
  return <span style={{ width: tamanho, height: tamanho, borderRadius: '50%', overflow: 'hidden', display: 'inline-block', flexShrink: 0 }}>
    {foto ? <img src={foto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <Caricatura semente={dados?.prestadores[id]?.semente ?? semente ?? hash(id)} />}
  </span>;
}
export function TagSituacao({ s, atrasada }: { s: Situacao; atrasada?: boolean }) {
  return <span className={`${css.tag} ${css[`t-${TOM_SITUACAO[s]}`]}`}>{ROTULO_SITUACAO[s]}{atrasada ? ' · atrasada' : ''}</span>;
}
function TagAcesso({ l }: { l: LinhaRh }) {
  const a = l.acesso;
  if (a.status === 'ATIVO') return <span className={`${css.tag} ${a.temPush ? css['t-ok'] : css['t-in']}`} title={a.temPush ? 'Notificações ligadas' : 'Sem notificação no celular'}>{a.temPush ? 'ativo' : 'ativo · sem push'}</span>;
  if (a.status === 'CONVIDADO') return <span className={`${css.tag} ${css['t-av']}`}>convidado · até {dataIsoBr(a.conviteExpiraEm)}</span>;
  if (a.status === 'BLOQUEADO') return <span className={`${css.tag} ${css['t-er']}`}>bloqueado</span>;
  return <span className={`${css.tag} ${css['t-cz']}`}>{a.status === 'CONVITE_VENCIDO' ? 'convite venceu' : 'sem acesso'}</span>;
}

/**
 * Notas de prestadores: o RH libera o valor do mês (MEI) ou da semana
 * (motorista), acompanha quem mandou, confere, lembra, paga e dá acesso ao app.
 */
export function Prestadores() {
  const [params, setParams] = useSearchParams();
  const navegar = useNavigate();
  const mes = params.get('mes') ?? mesHoje();
  const [d, setD] = useState<PainelRh | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('TODOS');
  const [busca, setBusca] = useState('');
  const [ordem, setOrdemSt] = useState<Ordem>(lerOrdem);
  const setOrdem = (o: Ordem) => { setOrdemSt(o); try { localStorage.setItem('pontosnap.prestadores.ordem', o); } catch { /* sem storage */ } };
  const [fechar, setFechar] = useState<{ id: string; motivo: 'DESLIGAMENTO' | 'ANTECIPADO' } | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [aberto, setAberto] = useState<string | null>(null);
  const [liberar, setLiberar] = useState(params.get('liberar') === '1');
  const [convidar, setConvidar] = useState<string[] | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try { setD(await api.get<PainelRh>(`/portal/rh/painel?comp=${mes}`)); setErro(null); }
    catch (e) { setErro((e as Error).message); }
  }, [mes]);
  useEffect(() => { setD(null); setSel(new Set()); void carregar(); }, [carregar]);
  const avisar = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 5000); };
  const ir = (m: string) => { const p = new URLSearchParams(params); p.set('mes', m); p.delete('liberar'); setParams(p, { replace: true }); };

  const linhas = useMemo(() => {
    // Busca por nome, empresa, função ou CPF/CNPJ (sem acento, sem máscara).
    const b = semAcento(busca.trim());
    const dig = busca.replace(/\D/g, '');
    const achou = (l: LinhaRh) => !b || semAcento(`${l.nome} ${l.empresa ?? ''} ${l.funcao ?? ''}`).includes(b) || (dig.length >= 3 && (l.documento ?? '').includes(dig));
    const nome = (a: LinhaRh, x: LinhaRh) => a.nome.localeCompare(x.nome, 'pt-BR');
    const cmp: Record<Ordem, (a: LinhaRh, x: LinhaRh) => number> = {
      NOME: nome,
      VALOR: (a, x) => x.valorCent - a.valorCent || nome(a, x),
      SITUACAO: (a, x) => PESO_SIT[a.situacao] - PESO_SIT[x.situacao] || nome(a, x),
      EMPRESA: (a, x) => (a.empresa ?? '~').localeCompare(x.empresa ?? '~', 'pt-BR') || nome(a, x),
    };
    return (d?.linhas ?? []).filter((l) => passaFiltro(l, filtro) && achou(l)).sort(cmp[ordem]);
  }, [d, filtro, busca, ordem]);
  const contagem = (f: Filtro) => (d?.linhas ?? []).filter((l) => passaFiltro(l, f)).length;
  const selecionadas = (d?.linhas ?? []).filter((l) => sel.has(l.id));
  const unidadesSel = selecionadas.flatMap((l) => l.unidades);
  const todasMarcadas = linhas.length > 0 && linhas.every((l) => sel.has(l.id));
  const linhaAberta = d?.linhas.find((l) => l.id === aberto) ?? null;

  async function acao<T>(f: () => Promise<T>, ok: (r: T) => string) {
    setOcupado(true); setErro(null);
    try { const r = await f(); avisar(ok(r)); await carregar(); }
    catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  }
  const lembrar = (notaIds?: string[]) => acao(
    () => api.post<{ notas: number; enviados: number; semAcesso: number }>('/portal/rh/lembrar', notaIds ? { notaIds } : { competencia: mes }),
    (r) => r.notas === 0 ? 'Ninguém para lembrar.' : `Lembrete enviado para ${r.enviados}${r.semAcesso ? ` · ${r.semAcesso} sem acesso ao app (o RH sobe a nota)` : ''}.`);
  const pagar = (notaIds: string[]) => acao(() => api.post<{ pagas: number }>('/portal/rh/pagar', { ids: notaIds }), (r) => `${r.pagas} ${r.pagas === 1 ? 'pagamento registrado' : 'pagamentos registrados'}. O prestador vê "pago" no app.`);
  async function zip(ids?: string[]) {
    setOcupado(true); setErro(null);
    try { salvarBlob(await api.baixar(`/portal/rh/zip?comp=${mes}${ids?.length ? `&ids=${ids.join(',')}` : ''}`), `notas_${mes}.zip`); }
    catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  }

  const t = d?.totais;
  const semModelo = (d?.linhas ?? []).filter((l) => !l.modeloNota).length;
  const faltamIds = (d?.linhas ?? []).flatMap((l) => l.unidades).filter((u) => u.nota && (u.situacao === 'FALTA' || u.situacao === 'RECUSADA')).map((u) => u.nota!.id);
  const pendentesLib = d ? (!d.meiLiberado && d.fechado && d.totais.mei > 0) || d.semanas.some((s) => s.encerrada && !s.liberada && s.motoristas > 0) : false;

  return (
    <div className={css.pagina}>
      <div className={css.cab}>
        <div>
          <h2>Notas de prestadores</h2>
          <p>{d ? `${d.rotulo} · ${d.fechado ? `fechado em ${dataIsoBr(d.fechadoEm)}` : 'em aberto'}${d.meiLiberado ? ' e liberado para os prestadores' : ''}` : 'Carregando…'}</p>
        </div>
        <div className={css.acoes}>
          <span className={css.comp}>
            <button type="button" aria-label="Mês anterior" onClick={() => ir(somarMes(mes, -1))}>‹</button>
            <input type="month" aria-label="Competência" value={mes} onChange={(e) => e.target.value && ir(e.target.value)} />
            <button type="button" aria-label="Próximo mês" onClick={() => ir(somarMes(mes, 1))} disabled={mes >= mesHoje()}>›</button>
          </span>
          <button type="button" className={css.btnSec} onClick={() => setConvidar((d?.linhas ?? []).filter((l) => l.acesso.status !== 'ATIVO').map((l) => l.id))} disabled={!d || !t?.semAcesso}>
            Dar acesso em lote
          </button>
          <Link className={css.btnSec} to="/rh/prestadores/modelos">Modelos de nota</Link>
          <Link className={css.btnSec} to="/rh/prestadores/conferir" aria-disabled={!t?.conferir}>Conferir {t?.conferir ?? 0} {t?.conferir === 1 ? 'nota' : 'notas'}</Link>
          <button type="button" className={css.btnPri} onClick={() => setLiberar(true)} disabled={!d}>Liberar valores</button>
        </div>
      </div>
      {erro && <p className={css.erro} role="alert">{erro}</p>}
      {msg && <p className={css.okMsg} role="status">{msg}</p>}

      {d && !d.fechado && d.totais.mei > 0 && (
        <div className={css.faixa}>
          <div><b>{d.rotulo} ainda está aberto</b><small>Feche o mês na Folha e benefícios para liberar o valor de cada MEI. As semanas dos motoristas já podem ser liberadas.</small></div>
          <button type="button" className={css.btnPri} onClick={() => navegar(`/rh/pessoal?mes=${mes}`)}>Ir para o fechamento</button>
        </div>
      )}
      {d && pendentesLib && d.fechado && (
        <div className={css.faixa}>
          <div><b>Tem valor fechado e ainda não liberado</b><small>{!d.meiLiberado && d.totais.mei > 0 ? `${d.totais.mei} MEI` : ''}{!d.meiLiberado && d.semanas.some((s) => s.encerrada && !s.liberada && s.motoristas > 0) ? ' e ' : ''}{d.semanas.filter((s) => s.encerrada && !s.liberada && s.motoristas > 0).length ? `${d.semanas.filter((s) => s.encerrada && !s.liberada && s.motoristas > 0).length} semana(s) de motorista` : ''} esperando a liberação.</small></div>
          <button type="button" className={css.btnPri} onClick={() => setLiberar(true)}>Liberar agora</button>
        </div>
      )}

      {d && d.linhas.length > 0 && semModelo > 0 && (
        <div className={css.avisoModelo} role="status">
          <span><b>{semModelo === d.linhas.length ? 'Nenhum prestador tem modelo de nota' : `${semModelo} ${semModelo === 1 ? 'prestador sem modelo de nota' : 'prestadores sem modelo de nota'}`}:</b> o app mostra só tomador e valor, e a conferência não confere código do serviço nem descrição.</span>
          <Link className={css.btnTxt} to="/rh/prestadores/modelos">{semModelo === d.linhas.length ? 'Criar modelo' : 'Escolher modelo'}</Link>
        </div>
      )}

      {t && (
        <div className={css.kpis}>
          <div className={`${css.kpi} ${css.kpiEsc}`}><small>A pagar a prestadores</small><b>{brl(t.aPagarCent)}</b><span>{t.pessoas} pessoas · {t.mei} MEI · {t.motoristas} motoristas</span></div>
          <div className={css.kpi}><small>Com acesso ao app</small><b>{t.comAcesso} <span>de {t.pessoas}</span></b><span>{t.semAcesso ? `${t.semAcesso} sem acesso${t.convidados ? ` · ${t.convidados} convidados` : ''}` : 'todos com acesso'}</span></div>
          <div className={css.kpi}><small>Notas recebidas</small><b>{t.recebidas} <span>de {t.notas}</span></b>
            <div className={css.barra} aria-hidden="true">
              <i style={{ width: `${t.notas ? (t.aprovadas / t.notas) * 100 : 0}%`, background: 'var(--ok-text)' }} />
              <i style={{ width: `${t.notas ? (t.conferir / t.notas) * 100 : 0}%`, background: 'var(--coral)' }} />
            </div>
            <span>{t.conferir} para conferir</span></div>
          <div className={css.kpi}><small>Faltam enviar</small><b>{t.faltam}</b><span>{t.recusadas ? `${t.recusadas} recusadas · ` : ''}lembrete automático 9h</span></div>
          <div className={css.kpi}><small>Pagos</small><b>{t.pagos}</b><span>{brl(t.pagosCent)}</span></div>
        </div>
      )}

      <div className={css.ferramentas}>
        <label className={css.buscaGrande}>
          <Icone nome="busca" tamanho={18} />
          <input type="search" placeholder="Buscar por nome, empresa ou CPF/CNPJ" aria-label="Buscar prestador" value={busca} onChange={(e) => setBusca(e.target.value)} />
          {busca && <button type="button" onClick={() => setBusca('')} aria-label="Limpar busca">✕</button>}
        </label>
        <label className={css.ordem}>
          <span>Ordem:</span>
          <select value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} aria-label="Ordenar por">
            {ORDENS.map((o) => <option key={o.id} value={o.id}>{o.rotulo}</option>)}
          </select>
        </label>
        {busca && d && <span className={css.achados} role="status">{linhas.length} de {d.linhas.length}</span>}
      </div>
      <div className={css.filtros} role="group" aria-label="Filtrar">
        {FILTROS.map((f) => (
          <button key={f.id} type="button" className={`${css.fl} ${filtro === f.id ? css.flOn : ''}`} aria-pressed={filtro === f.id} onClick={() => setFiltro(f.id)}>
            {f.rotulo}<span>{d ? contagem(f.id) : ''}</span>
          </button>
        ))}
        {faltamIds.length > 0 && <button type="button" className={css.btnSec + ' ' + css.pequeno} disabled={ocupado} onClick={() => lembrar(faltamIds)}>🔔 Lembrar os {faltamIds.length}</button>}
      </div>

      {sel.size > 0 && (
        <div className={css.lote} role="region" aria-label="Ações em lote">
          <b>{sel.size} {sel.size === 1 ? 'selecionado' : 'selecionados'}</b>
          <button type="button" className={css.btnSec} disabled={ocupado} onClick={() => lembrar(unidadesSel.filter((u) => u.nota && (u.situacao === 'FALTA' || u.situacao === 'RECUSADA')).map((u) => u.nota!.id))}>Enviar lembrete</button>
          <button type="button" className={css.btnSec} disabled={ocupado || !unidadesSel.some((u) => u.nota && !u.pago && (u.situacao === 'APROVADA' || u.situacao === 'RH'))}
            onClick={() => pagar(unidadesSel.filter((u) => u.nota && !u.pago && (u.situacao === 'APROVADA' || u.situacao === 'RH')).map((u) => u.nota!.id))}>Marcar como pago</button>
          <button type="button" className={css.btnSec} disabled={ocupado} onClick={() => zip(selecionadas.map((l) => l.id))}>Baixar notas (ZIP)</button>
          <button type="button" className={css.btnSec} disabled={!selecionadas.some((l) => l.acesso.status !== 'ATIVO')} onClick={() => setConvidar(selecionadas.filter((l) => l.acesso.status !== 'ATIVO').map((l) => l.id))}>Dar acesso</button>
          <button type="button" className={css.btnSec} onClick={() => setSel(new Set())}>Limpar</button>
        </div>
      )}

      {!d && !erro && <div className={css.vazio}><p>Carregando…</p></div>}
      {d && d.linhas.length === 0 && <div className={css.vazio}><b>Nenhum prestador em {d.rotulo}</b><p>Cadastre MEI e motoristas na Folha e benefícios.</p></div>}
      {d && d.linhas.length > 0 && linhas.length === 0 && (
        <div className={css.vazio}><b>Ninguém encontrado</b><p>{busca ? `Nada com "${busca}" neste filtro.` : 'Nenhum prestador neste filtro.'}</p>
          <button type="button" className={css.btnSec} onClick={() => { setBusca(''); setFiltro('TODOS'); }}>Limpar busca e filtro</button></div>
      )}
      {d && linhas.length > 0 && (
        <div className={css.tabela}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }}><input type="checkbox" className={css.chk} aria-label="Selecionar todos" checked={todasMarcadas}
                  onChange={() => setSel(todasMarcadas ? new Set() : new Set(linhas.map((l) => l.id)))} /></th>
                <th>Prestador</th><th>Tipo</th><th className={css.r}>Valor da nota</th><th>Nota</th><th>App</th><th>Pagamento</th><th />
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => <Linha key={l.id} l={l} marcado={sel.has(l.id)} ocupado={ocupado}
                onMarcar={() => setSel((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })}
                onAbrir={() => setAberto(l.id)} onLembrar={(ids) => lembrar(ids)} onConvidar={() => setConvidar([l.id])}
                onConferir={() => navegar('/rh/prestadores/conferir')} />)}
            </tbody>
          </table>
        </div>
      )}
      {d && <p className={css.hint}>Quem não tem acesso continua como hoje: o RH sobe a nota pela Folha e benefícios. Lembrete automático todo dia às 9h para quem ainda não mandou, até 7 dias depois do prazo.</p>}

      {linhaAberta && d && !fechar && (
        <DetalhePrestador key={linhaAberta.id} l={linhaAberta} d={d} mes={mes} ocupado={ocupado} onFechar={() => setAberto(null)}
          onLembrar={(ids) => lembrar(ids)} onPagar={(ids) => pagar(ids)} onConvidar={() => setConvidar([linhaAberta.id])}
          onFecharPessoa={(motivo) => setFechar({ id: linhaAberta.id, motivo })}
          onMudou={async (m) => { avisar(m); await carregar(); }} onErro={setErro} />
      )}
      {fechar && d && (() => {
        const l = d.linhas.find((x) => x.id === fechar.id);
        return l ? <FecharPessoa pessoa={{ id: l.id, nome: l.nome, tipo: l.tipo, empresa: l.empresa, avatarSemente: l.avatarSemente }} mes={mes}
          motivoInicial={fechar.motivo} temApp={l.acesso.status === 'ATIVO'} onFechar={() => setFechar(null)}
          onFechado={async (m) => { setFechar(null); avisar(m); await carregar(); }} /> : null;
      })()}

      {liberar && d && <ModalLiberar d={d} onFechar={() => setLiberar(false)}
        onLiberado={async (m) => { setLiberar(false); avisar(m); await carregar(); }} />}
      {convidar && d && <ModalConvites ids={convidar} linhas={d.linhas} onFechar={() => { setConvidar(null); void carregar(); }} />}
    </div>
  );
}

function Linha({ l, marcado, ocupado, onMarcar, onAbrir, onLembrar, onConvidar, onConferir }: {
  l: LinhaRh; marcado: boolean; ocupado: boolean; onMarcar: () => void; onAbrir: () => void;
  onLembrar: (ids: string[]) => void; onConvidar: () => void; onConferir: () => void;
}) {
  const liberadas = l.unidades.filter((u) => u.nota);
  const falta = liberadas.filter((u) => u.situacao === 'FALTA' || u.situacao === 'RECUSADA').map((u) => u.nota!.id);
  const mot = l.tipo === 'MOTORISTA';
  const ultimaPaga = l.unidades.filter((u) => u.pagoEm).map((u) => u.pagoEm!).sort().pop() ?? null;
  return (
    <tr>
      <td><input type="checkbox" className={css.chk} checked={marcado} onChange={onMarcar} aria-label={`Selecionar ${l.nome}`} /></td>
      <td>
        <button type="button" className={`${css.linhaBtn} ${css.pes}`} onClick={onAbrir}>
          <Rosto id={l.id} semente={l.avatarSemente} />
          <span><b>{l.nome}</b><small>{[l.empresa, l.funcao].filter(Boolean).join(' · ') || '—'}</small></span>
        </button>
      </td>
      <td>{mot ? 'Motorista' : 'MEI'}</td>
      <td className={`${css.r} ${css.mono}`}>{brl(l.valorCent)}{mot && <span className={css.sub}>{l.unidades.length} {l.unidades.length === 1 ? 'semana' : 'semanas'}</span>}</td>
      <td>
        {l.fechadoIndividual && <span className={`${css.tag} ${css['t-nv']}`} title={l.fechadoIndividual.motivo === 'DESLIGAMENTO' ? `Desligamento · último dia ${dataBr(l.fechadoIndividual.ultimoDia ?? '')}` : 'Pago antes do fechamento do mês'}>
          {l.fechadoIndividual.motivo === 'DESLIGAMENTO' ? 'desligado' : 'fechado'} {dataIsoBr(l.fechadoIndividual.em)}</span>}{' '}
        <TagSituacao s={l.situacao} atrasada={l.atrasada} />
        {mot && l.unidades.length > 0 && (
          <span className={css.semanas} aria-label={l.unidades.map((u) => `${u.rotulo}: ${ROTULO_SITUACAO[u.situacao]}`).join('; ')}>
            {l.unidades.map((u) => <i key={u.periodo} className={css[TOM_SITUACAO[u.situacao] === 'cz' ? '' : TOM_SITUACAO[u.situacao]]} title={`${u.rotulo}: ${ROTULO_SITUACAO[u.situacao]}`} />)}
          </span>
        )}
        {liberadas.length > 0 && l.acesso.status === 'ATIVO' && (l.situacao === 'FALTA' || l.situacao === 'RECUSADA') && (
          <span className={css.sub}>{l.vistoEm ? `viu ${haQuanto(l.vistoEm)}` : 'não abriu'}</span>
        )}
      </td>
      <td><TagAcesso l={l} /></td>
      <td className={css.mono}>{l.pago ? <span className={`${css.tag} ${css['t-ok']}`}>pago {dataIsoBr(ultimaPaga)}</span> : l.pagoCent ? <span className={css.sub}>{brl(l.pagoCent)} pago</span> : '—'}</td>
      <td className={css.r}>
        {l.situacao === 'CONFERIR' ? <button type="button" className={css.btnTxt} onClick={onConferir}>Conferir</button>
          : l.situacao === 'CONTESTOU' ? <button type="button" className={css.btnTxt} onClick={onAbrir}>Responder</button>
            : l.acesso.status !== 'ATIVO' && l.acesso.status !== 'CONVIDADO' ? <button type="button" className={css.btnTxt} onClick={onConvidar}>Convidar</button>
              : falta.length > 0 && l.acesso.status === 'ATIVO' ? <button type="button" className={css.btnTxt} disabled={ocupado} onClick={() => onLembrar(falta)}>Lembrar</button>
                : <button type="button" className={css.btnTxt} onClick={onAbrir}>Ver</button>}
      </td>
    </tr>
  );
}

/**
 * Modal da pessoa (largo, com foto): notas do mês (ou semanas), contestação,
 * pagamento, acesso ao app, contato e o fechamento individual.
 */
function DetalhePrestador({ l, d, mes, ocupado, onFechar, onLembrar, onPagar, onConvidar, onFecharPessoa, onMudou, onErro }: {
  l: LinhaRh; d: PainelRh; mes: string; ocupado: boolean; onFechar: () => void; onLembrar: (ids: string[]) => void; onPagar: (ids: string[]) => void; onConvidar: () => void;
  onFecharPessoa: (motivo: 'DESLIGAMENTO' | 'ANTECIPADO') => void;
  onMudou: (m: string) => Promise<void>; onErro: (m: string | null) => void;
}) {
  const navegar = useNavigate();
  const [aba, setAba] = useState<'mes' | 'acesso' | 'dados'>('mes');
  const [confirmarReabrir, setConfirmarReabrir] = useState(false);
  const fi = l.fechadoIndividual;
  const pagoAlgo = l.unidades.some((u) => u.pago);
  const doc = l.documento ? mascaraDoc(l.documento) : null;
  const [resp, setResp] = useState('');
  const [contato, setContato] = useState({ telefone: l.telefone ?? '', email: l.email ?? '', documento: mascaraDoc(l.documento ?? ''), tomadorNome: l.tomadorNome ?? '', tomadorCnpj: mascaraDoc(l.tomadorCnpj ?? '') });
  const [salvando, setSalvando] = useState(false);
  const [modelos, setModelos] = useState<ListaModelos['modelos'] | null>(null);
  useEffect(() => {
    if (aba !== 'dados' || modelos) return;
    api.get<ListaModelos>('/portal/rh/modelos-nota').then((r) => setModelos(r.modelos)).catch(() => setModelos([]));
  }, [aba, modelos]);
  const padraoTipo = modelos?.find((m) => m.padraoTipo === l.tipo) ?? null;
  useEffect(() => { setContato({ telefone: l.telefone ?? '', email: l.email ?? '', documento: mascaraDoc(l.documento ?? ''), tomadorNome: l.tomadorNome ?? '', tomadorCnpj: mascaraDoc(l.tomadorCnpj ?? '') }); }, [l.id]);

  async function chamar(f: () => Promise<unknown>, m: string) {
    setSalvando(true); onErro(null);
    try { await f(); await onMudou(m); } catch (e) { onErro((e as Error).message); } finally { setSalvando(false); }
  }
  async function abrirArquivo(u: UnidadeRh) {
    if (!u.nf.arquivo) return;
    try {
      const b = await api.baixar(`/pessoal/nf/${u.nf.arquivo.id}`);
      const url = URL.createObjectURL(new Blob([b], { type: u.nf.arquivo.mime }));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { onErro((e as Error).message); }
  }

  const rodape = (
    <>
      {!d.fechado && !fi && <button type="button" className={`${css.btnTxt} ${css.btnPerigo}`} onClick={() => onFecharPessoa('DESLIGAMENTO')}>Desligar…</button>}
      {!d.fechado && fi && !pagoAlgo && (confirmarReabrir
        ? <span className={css.confirma}>Reabrir volta a calcular ao vivo{fi.motivo === 'DESLIGAMENTO' ? ' e desfaz o desligamento' : ''}.
            <button type="button" className={`${css.btnSec} ${css.pequeno}`} disabled={salvando}
              onClick={() => chamar(() => api.del(`/portal/rh/fechar-pessoa/${fi.id}`), `${l.nome} reaberto.`)}>Confirmar</button>
            <button type="button" className={css.btnTxt} onClick={() => setConfirmarReabrir(false)}>Cancelar</button></span>
        : <button type="button" className={css.btnTxt} onClick={() => setConfirmarReabrir(true)}>Reabrir pessoa</button>)}
      <span style={{ flex: 1 }} />
      <button type="button" className={css.btnSec} onClick={() => navegar(`/rh/pessoal?mes=${mes}&aba=prestadores&abrir=${l.tipo}:${l.id}`)}>
        {d.fechado || fi ? 'Abrir na Folha' : 'Lançar extras e faltas'}
      </button>
      {!d.fechado && !fi && <button type="button" className={css.btnPri} onClick={() => onFecharPessoa('ANTECIPADO')}>Fechar só esta pessoa</button>}
    </>
  );

  return (
    <ModalPessoa aberto onFechar={onFechar} foto={<Rosto id={l.id} semente={l.avatarSemente} tamanho={104} />}
      titulo={l.nome}
      meta={[l.tipo === 'MEI' ? 'MEI' : 'Motorista', l.empresa, l.funcao, doc].filter(Boolean).join(' · ')}
      chips={<>
        <span className={`${css.tag} ${css['t-cz']}`}>{d.rotulo.toLowerCase()} · {d.fechado ? 'fechado' : 'em aberto'}</span>
        {fi && <span className={`${css.tag} ${css['t-nv']}`}>{fi.motivo === 'DESLIGAMENTO' ? `desligado · último dia ${dataBr(fi.ultimoDia ?? '')}` : 'fechado antes do mês'} · {dataIsoBr(fi.em)}</span>}
        <TagAcesso l={l} />
      </>}
      abas={[{ id: 'mes', rotulo: l.tipo === 'MEI' ? 'Este mês' : 'Semanas do mês' }, { id: 'acesso', rotulo: 'Acesso ao app' }, { id: 'dados', rotulo: 'Dados e contato' }]}
      aba={aba} onAba={(x) => setAba(x as typeof aba)} rodape={rodape}>
    {aba === 'mes' && (
    <div className={css.mGrade}>
      <div className={css.bloco}>
        <h4>{l.tipo === 'MEI' ? `Nota de ${mes.slice(5)}/${mes.slice(0, 4)}` : 'Semanas'}</h4>
        {l.unidades.length === 0 && <p className={css.hint}>Nenhuma semana trabalhada neste mês.</p>}
        {l.unidades.map((u) => {
          const n = u.nota;
          return (
            <div key={u.periodo} className={css.unid}>
              <div className={css.unidTopo}><b>{u.rotulo}</b><TagSituacao s={u.situacao} atrasada={u.atrasada} /></div>
              <div className={css.lin}><span>Valor</span><span className={css.mono}>{brl(u.valorCent)}{n && n.versao > 1 ? ` · versão ${n.versao}` : ''}</span></div>
              {n?.prazo && <div className={css.lin}><span>Prazo</span><span>{dataBr(n.prazo)}</span></div>}
              {n && <div className={css.lin}><span>Liberado</span><span>{dataIsoBr(n.liberadoEm)}{n.vistoEm ? ` · viu ${haQuanto(n.vistoEm)}` : ' · não abriu'}</span></div>}
              {u.nf.numero && <div className={css.lin}><span>NF</span><span className={css.mono}>{u.nf.numero}{n?.nf.data ? ` · ${dataBr(n.nf.data)}` : ''}</span></div>}
              {n?.motivoRecusa && u.situacao === 'RECUSADA' && <div className={css.citacao}>Recusada: {n.motivoRecusa}</div>}
              {n?.confirmacao === 'CONTESTOU' && (
                <>
                  <div className={css.citacao}><b>Contestou o valor:</b> {n.contestacao}</div>
                  {n.resposta ? <div className={css.lin}><span>Resposta do RH</span><span>{n.resposta}</span></div> : (
                    <div className={css.campo}>
                      <label htmlFor={`resp-${n.id}`}>Responder</label>
                      <textarea id={`resp-${n.id}`} value={resp} onChange={(e) => setResp(e.target.value)} placeholder="Ex.: conferimos o ponto e foram 6h. Se precisar corrigir, reabra o mês e libere de novo." />
                      <button type="button" className={`${css.btnPri} ${css.pequeno}`} disabled={salvando || resp.trim().length < 2}
                        onClick={() => chamar(() => api.post(`/portal/rh/notas/${n.id}/responder`, { resposta: resp }), `Resposta enviada para ${l.nome}.`)}>Enviar resposta</button>
                    </div>
                  )}
                </>
              )}
              {n?.confirmacao === 'CONFERE' && <div className={css.lin}><span>Valor</span><span className={css.mono}>confirmado pelo prestador</span></div>}
              <div className={css.acoes}>
                {u.nf.arquivo && <button type="button" className={`${css.btnSec} ${css.pequeno}`} onClick={() => abrirArquivo(u)}>Abrir nota</button>}
                {u.situacao === 'CONFERIR' && <button type="button" className={`${css.btnPri} ${css.pequeno}`} onClick={() => navegar('/rh/prestadores/conferir')}>Conferir</button>}
                {n && (u.situacao === 'FALTA' || u.situacao === 'RECUSADA') && l.acesso.status === 'ATIVO' && <button type="button" className={`${css.btnSec} ${css.pequeno}`} disabled={ocupado} onClick={() => onLembrar([n.id])}>Lembrar</button>}
                {n && !u.pago && (u.situacao === 'APROVADA' || u.situacao === 'RH') && <button type="button" className={`${css.btnSec} ${css.pequeno}`} disabled={ocupado} onClick={() => onPagar([n.id])}>Marcar pago ({brl(n.valorCent)})</button>}
                {u.pago && <span className={`${css.tag} ${css['t-ok']}`}>pago {dataIsoBr(u.pagoEm)}{u.valorPagoCent != null ? ` · ${brl(u.valorPagoCent)}` : ''}</span>}
              </div>
            </div>
          );
        })}
      </div>
      <ResumoPessoa l={l} d={d} />
    </div>
    )}

    {aba === 'acesso' && (
      <div className={css.bloco}>
        <h4>Acesso ao app</h4>
        <div className={css.lin}><span>Situação</span><TagAcesso l={l} /></div>
        <div className={css.acoes}>
          {l.acesso.status !== 'ATIVO' && <button type="button" className={`${css.btnPri} ${css.pequeno}`} onClick={onConvidar}>{l.acesso.status === 'CONVIDADO' ? 'Gerar novo convite' : 'Convidar'}</button>}
          {l.acesso.status === 'ATIVO' && <button type="button" className={`${css.btnTxt} ${css.btnPerigo}`} disabled={salvando}
            onClick={() => chamar(() => api.post(`/portal/rh/prestadores/${l.id}/acesso`, { ativo: false }), `Acesso de ${l.nome} cortado.`)}>Cortar acesso</button>}
          {l.acesso.status === 'BLOQUEADO' && <button type="button" className={`${css.btnSec} ${css.pequeno}`} disabled={salvando}
            onClick={() => chamar(() => api.post(`/portal/rh/prestadores/${l.id}/acesso`, { ativo: true }), `Acesso de ${l.nome} devolvido.`)}>Devolver acesso</button>}
        </div>
        <p className={css.hint}>{l.acesso.status === 'ATIVO' ? 'Entra com o e-mail cadastrado em Dados e contato.' : 'Sem acesso, o RH sobe a nota pela Folha e benefícios.'}</p>
      </div>
    )}

    {aba === 'dados' && (
      <form className={css.bloco} onSubmit={(e) => {
        e.preventDefault();
        void chamar(() => api.patch(`/portal/rh/prestadores/${l.id}/contato`, {
          telefone: contato.telefone || null, email: contato.email || null, documento: contato.documento || null,
          tomadorNome: contato.tomadorNome || null, tomadorCnpj: contato.tomadorCnpj || null,
        }), 'Dados salvos.');
      }}>
        <h4>Modelo de nota</h4>
        {modelos === null ? <p className={css.hint}>Carregando…</p> : modelos.length === 0 ? (
          <p className={css.hint}>Nenhum modelo criado. <Link to="/rh/prestadores/modelos">Criar modelo de nota</Link> (tomador, código do serviço e descrição prontos no app).</p>
        ) : (
          <div className={css.campo}>
            <label htmlFor="c-mod">O que vai na nota</label>
            <select id="c-mod" value={l.modeloNotaId ?? ''} disabled={salvando}
              onChange={(e) => void chamar(() => api.post('/portal/rh/modelos-nota/aplicar', { modeloId: e.target.value || null, prestadorIds: [l.id] }), 'Modelo de nota atualizado. Vale a partir da próxima liberação.')}>
              <option value="">{padraoTipo ? `Padrão dos ${l.tipo === 'MEI' ? 'MEI' : 'motoristas'} (${padraoTipo.nome})` : 'Sem modelo'}</option>
              {modelos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
            <small className={css.hint}>{l.modeloNota ? 'Com modelo, tomador, código e descrição vêm dele (os campos de tomador abaixo não valem).' : 'Sem modelo, o app mostra o tomador abaixo e uma descrição simples.'} <Link to="/rh/prestadores/modelos">Ver modelos</Link></small>
          </div>
        )}
        <h4>Contato e nota</h4>
        <div className={css.campos}>
          <div className={css.campo}><label htmlFor="c-doc">CPF/CNPJ</label><input id="c-doc" value={contato.documento} onChange={(e) => setContato({ ...contato, documento: mascaraDoc(e.target.value) })} /></div>
          <div className={css.campo}><label htmlFor="c-tel">Celular (WhatsApp)</label><input id="c-tel" inputMode="tel" value={contato.telefone} onChange={(e) => setContato({ ...contato, telefone: e.target.value })} /></div>
          <div className={`${css.campo} ${css.campoInteiro}`}><label htmlFor="c-email">E-mail (usuário de login)</label><input id="c-email" type="email" value={contato.email} onChange={(e) => setContato({ ...contato, email: e.target.value })} /></div>
          <div className={css.campo}><label htmlFor="c-tom">Tomador da nota</label><input id="c-tom" value={contato.tomadorNome} onChange={(e) => setContato({ ...contato, tomadorNome: e.target.value })} placeholder="Vazio = razão social da empresa" /></div>
          <div className={css.campo}><label htmlFor="c-tomc">CNPJ do tomador</label><input id="c-tomc" value={contato.tomadorCnpj} onChange={(e) => setContato({ ...contato, tomadorCnpj: mascaraDoc(e.target.value) })} placeholder="Vazio = CNPJ da empresa" /></div>
        </div>
        <div className={css.acoes}><button type="submit" className={`${css.btnSec} ${css.pequeno}`} disabled={salvando}>Salvar dados</button></div>
      </form>
    )}
    </ModalPessoa>
  );
}

/** Lado direito do "Este mês": valor, fechamento individual e o caminho da nota. */
function ResumoPessoa({ l, d }: { l: LinhaRh; d: PainelRh }) {
  const fi = l.fechadoIndividual;
  const temNota = l.unidades.some((u) => u.nota);
  const enviada = l.unidades.some((u) => ['CONFERIR', 'APROVADA', 'RH'].includes(u.situacao));
  const aprovada = l.unidades.length > 0 && l.unidades.every((u) => u.situacao === 'APROVADA' || u.situacao === 'RH');
  const passo = l.pago ? 4 : aprovada ? 3 : enviada ? 2 : temNota ? 1 : 0;
  const etapa = (n: number, titulo: string, sub: string) => (
    <div className={`${css.tli} ${passo >= n ? css.tliFeito : passo + 1 === n ? css.tliAgora : ''}`}>
      <i aria-hidden="true">{passo >= n ? '✓' : n}</i><div><b>{titulo}</b><small>{sub}</small></div>
    </div>
  );
  return (
    <div className={css.bloco}>
      <h4>{d.rotulo}</h4>
      <div className={css.lin}><span>{l.tipo === 'MEI' ? 'Valor da nota' : 'Total das semanas'}</span><span className={css.mono}><b>{brl(l.valorCent)}</b></span></div>
      {l.pagoCent > 0 && <div className={css.lin}><span>Pago</span><span className={css.mono}>{brl(l.pagoCent)}</span></div>}
      {fi && <p className={css.infoFech}>{fi.motivo === 'DESLIGAMENTO'
        ? `Desligamento: valores congelados até ${dataBr(fi.ultimoDia ?? '')}${fi.proporcional ? ' (contrato proporcional)' : ''}${fi.debitosFuturosCent ? `, com ${brl(fi.debitosFuturosCent)} de parcelas futuras de débito` : ''}. Fechado por ${fi.por ?? 'RH'} em ${dataIsoBr(fi.em)}.`
        : `Fechado antes do mês por ${fi.por ?? 'RH'} em ${dataIsoBr(fi.em)}. Continua ativo nos próximos meses.`}</p>}
      {!fi && !d.fechado && <p className={css.hint}>O mês está aberto: o valor final sai no fechamento, ou agora, se você fechar só esta pessoa.</p>}
      <h4 style={{ marginTop: 6 }}>Caminho da nota</h4>
      <div className={css.tl}>
        {etapa(1, 'Valor fechado e liberado', d.fechado || fi ? 'pronto para emitir' : 'no fechamento do mês ou individual')}
        {etapa(2, 'Prestador envia a nota', l.acesso.status === 'ATIVO' ? 'pelo app (leitura automática do PDF)' : 'sem app: o RH anexa')}
        {etapa(3, 'RH confere e aprova', 'em Conferir notas')}
        {etapa(4, 'Pagamento', l.pago ? 'pago' : 'marcar como pago depois do Pix')}
      </div>
    </div>
  );
}

/** Fechar e liberar: MEI (mês fechado) ou semana do motorista, com prazo, aviso e confirmação do valor. */
function ModalLiberar({ d, onFechar, onLiberado }: { d: PainelRh; onFechar: () => void; onLiberado: (m: string) => Promise<void> }) {
  const semanasLib = d.semanas.filter((s) => s.motoristas > 0);
  const [tipo, setTipo] = useState<'MEI' | 'MOTORISTA'>(d.fechado && d.totais.mei > 0 ? 'MEI' : 'MOTORISTA');
  const [semanas, setSemanas] = useState<Set<string>>(new Set(semanasLib.filter((s) => s.encerrada && !s.liberada).map((s) => s.inicio)));
  const [prazo, setPrazo] = useState(proxDiaUtil(d.hoje, tipo === 'MEI' ? 3 : 2));
  const [avisar, setAvisar] = useState(true);
  const [confirmar, setConfirmar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const mei = d.linhas.filter((l) => l.tipo === 'MEI');
  const mot = d.linhas.filter((l) => l.tipo === 'MOTORISTA');
  const alvo = tipo === 'MEI' ? mei : mot.filter((l) => l.unidades.some((u) => semanas.has(u.periodo)));
  const valor = tipo === 'MEI' ? mei.reduce((a, l) => a + l.valorCent, 0)
    : mot.reduce((a, l) => a + l.unidades.filter((u) => semanas.has(u.periodo)).reduce((b, u) => b + u.valorCent, 0), 0);
  const comApp = alvo.filter((l) => l.acesso.status === 'ATIVO').length;
  const ex = alvo[0];
  const exValor = ex ? (tipo === 'MEI' ? ex.valorCent : ex.unidades.filter((u) => semanas.has(u.periodo)).reduce((a, u) => a + u.valorCent, 0)) : 0;

  async function liberar() {
    setEnviando(true); setErro(null);
    try {
      const r = await api.post<{ liberadas: number; alteradas: number; mantidas: number; notificados: number; semAcesso: number }>('/portal/rh/liberar', {
        competencia: d.competencia, tipo, semanas: tipo === 'MOTORISTA' ? [...semanas] : undefined, prazo: prazo || null, pedirConfirmacao: confirmar, avisar,
      });
      await onLiberado(`Liberado: ${r.liberadas} ${r.liberadas === 1 ? 'nota nova' : 'notas novas'}${r.alteradas ? `, ${r.alteradas} com valor corrigido` : ''}${r.mantidas ? `, ${r.mantidas} sem mudança` : ''}. ${r.notificados} ${r.notificados === 1 ? 'aviso' : 'avisos'} no celular.`);
    } catch (e) { setErro((e as Error).message); setEnviando(false); }
  }

  return (
    <Modal titulo={`Liberar ${d.rotulo.split('/')[0]!.toLowerCase()} para os prestadores`} onFechar={onFechar}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p className={css.hint}>Depois de liberado, cada prestador vê no app o resumo dele e o valor exato da nota. O valor é o retrato do fechamento: se precisar corrigir, reabra o mês, corrija e libere de novo — ele recebe aviso de que o valor mudou.</p>
        <div className={css.seg} role="group" aria-label="O que liberar">
          <button type="button" aria-pressed={tipo === 'MEI'} onClick={() => { setTipo('MEI'); setPrazo(proxDiaUtil(d.hoje, 3)); }}>MEI · mês</button>
          <button type="button" aria-pressed={tipo === 'MOTORISTA'} onClick={() => { setTipo('MOTORISTA'); setPrazo(proxDiaUtil(d.hoje, 2)); }}>Motoristas · semana</button>
        </div>
        {tipo === 'MEI' && d.meiLiberado && <p className={css.hint}><b>Já liberado.</b> Liberar de novo atualiza prazo e confirmação; só quem teve o valor alterado (mês reaberto e corrigido) recebe aviso.</p>}
        {tipo === 'MEI' && !d.fechado && <p className={css.erro}>Feche {d.rotulo} na Folha e benefícios antes de liberar os MEI.</p>}
        {tipo === 'MOTORISTA' && (
          <div className={css.semList}>
            {semanasLib.length === 0 && <p className={css.hint}>Nenhuma semana com motorista neste mês.</p>}
            {semanasLib.map((s) => (
              <label key={s.inicio} className={css.opc}>
                <input type="checkbox" checked={semanas.has(s.inicio)} onChange={() => setSemanas((x) => { const n = new Set(x); if (n.has(s.inicio)) n.delete(s.inicio); else n.add(s.inicio); return n; })} />
                <span><b>Semana {diaMes(s.inicio)} a {diaMes(s.fim)}</b><small>{s.motoristas} motoristas · {brl(s.valorCent)}{s.liberada ? ' · já liberada (libera de novo se o valor mudou)' : s.encerrada ? '' : ' · ainda não terminou'}</small></span>
              </label>
            ))}
          </div>
        )}
        <div className={css.resumoF}>
          <div><small>{tipo === 'MEI' ? 'MEI (mensal)' : 'Motoristas'}</small><b>{alvo.length} · {brl(valor)}</b></div>
          <div><small>Com acesso ao app</small><b>{comApp}</b><small>recebem no celular · {alvo.length - comApp} sem acesso (RH sobe a nota)</small></div>
        </div>
        <label className={css.opc}><input type="checkbox" checked={avisar} onChange={(e) => setAvisar(e.target.checked)} />
          <span><b>Avisar no celular agora</b><small>Notificação com o valor de cada um e o botão "Enviar nota".</small></span></label>
        <div className={css.campo} style={{ maxWidth: 260 }}>
          <label htmlFor="lib-prazo">Prazo para enviar a nota</label>
          <input id="lib-prazo" type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
          <small>Lembrete diário às 9h para quem não enviou.</small>
        </div>
        <label className={css.opc}><input type="checkbox" checked={confirmar} onChange={(e) => setConfirmar(e.target.checked)} />
          <span><b>Pedir confirmação do valor antes da nota</b><small>O prestador toca em "Confere" ou "Não confere" (com motivo) antes de emitir.</small></span></label>
        {ex && avisar && (
          <div className={css.previa} aria-label="Prévia da notificação">
            <div><i>P</i><span><b>{tipo === 'MEI' ? `${d.rotulo} fechado` : `Semana fechada`}: {brl(exValor)}</b><small>{prazo ? `Emita sua nota até ${diaMes(prazo)} e envie pelo app.` : 'Emita sua nota e envie pelo app.'}</small></span></div>
          </div>
        )}
        {erro && <p className={css.erro} role="alert">{erro}</p>}
        <div className={css.rodape}>
          <button type="button" className={css.btnSec} onClick={onFechar}>Voltar</button>
          <button type="button" className={css.btnPri} disabled={enviando || alvo.length === 0 || (tipo === 'MEI' && !d.fechado) || (tipo === 'MOTORISTA' && semanas.size === 0)} onClick={liberar}>
            {enviando ? 'Liberando…' : `Liberar para ${alvo.length}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Dar acesso em lote: um link por pessoa; WhatsApp um a um e e-mail para quem tem. */
function ModalConvites({ ids, linhas, onFechar }: { ids: string[]; linhas: LinhaRh[]; onFechar: () => void }) {
  const [gerados, setGerados] = useState<ConviteGerado[] | null>(null);
  const [porEmail, setPorEmail] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [enviando, setEnviando] = useState(false);
  const pessoas = linhas.filter((l) => ids.includes(l.id));
  const comEmail = pessoas.filter((l) => l.email).length;
  const semDoc = pessoas.filter((l) => !l.email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(l.email));

  async function gerar() {
    setEnviando(true); setErro(null);
    try { setGerados(await api.post<ConviteGerado[]>('/portal/rh/convites', { prestadorIds: ids, porEmail })); }
    catch (e) { setErro((e as Error).message); }
    finally { setEnviando(false); }
  }
  const ok = gerados?.filter((g) => !g.erro) ?? [];
  const proximo = ok.find((g) => g.whatsapp && !abertos.has(g.prestadorId));
  const abrir = (g: ConviteGerado) => { window.open(g.whatsapp!, '_blank', 'noopener'); setAbertos((s) => new Set(s).add(g.prestadorId)); };
  const copiar = async (g: ConviteGerado) => { try { await navigator.clipboard.writeText(g.mensagem!); setAbertos((s) => new Set(s).add(g.prestadorId)); } catch { /* sem clipboard */ } };

  return (
    <Modal titulo={`Dar acesso ao app · ${pessoas.length} ${pessoas.length === 1 ? 'prestador' : 'prestadores'}`} onFechar={onFechar}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!gerados ? (
          <>
            <p className={css.hint}>Cada um recebe um link pessoal. O usuário de login é o e-mail cadastrado: ele abre o link, cria a senha e pronto. O link vale 7 dias.</p>
            {semDoc.length > 0 && <p className={css.erro}>{semDoc.length} sem e-mail cadastrado ({semDoc.slice(0, 3).map((l) => l.nome.split(' ')[0]).join(', ')}{semDoc.length > 3 ? '…' : ''}) — o convite deles não sai. Cadastre o e-mail no painel do prestador.</p>}
            <label className={css.opc}><input type="checkbox" checked={porEmail} onChange={(e) => setPorEmail(e.target.checked)} />
              <span><b>Enviar também por e-mail</b><small>O convite chega no e-mail de login ({comEmail} de {pessoas.length} com e-mail).</small></span></label>
            {erro && <p className={css.erro}>{erro}</p>}
            <div className={css.rodape}>
              <button type="button" className={css.btnSec} onClick={onFechar}>Cancelar</button>
              <button type="button" className={css.btnPri} disabled={enviando || pessoas.length === semDoc.length} onClick={gerar}>{enviando ? 'Gerando…' : 'Gerar os links'}</button>
            </div>
          </>
        ) : (
          <>
            {proximo && <div className={css.msgZap}>{proximo.mensagem}</div>}
            <div className={css.convites}>
              {gerados.map((g) => (
                <div key={g.prestadorId} className={`${css.convItem} ${abertos.has(g.prestadorId) ? css.convFeito : ''}`}>
                  <span><b>{g.nome}</b><small>{g.erro ?? `${g.telefone ? `cel. ${fmtTel(g.telefone)}` : 'sem celular'}${g.emailEnviado ? ' · e-mail enviado' : ''}`}</small></span>
                  {!g.erro && (
                    <span className={css.acoes}>
                      <button type="button" className={`${css.btnTxt}`} onClick={() => copiar(g)}>Copiar mensagem</button>
                      {g.whatsapp && <button type="button" className={`${css.btnSec} ${css.pequeno}`} onClick={() => abrir(g)}>WhatsApp</button>}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className={css.rodape}>
              <button type="button" className={css.btnSec} onClick={onFechar}>Fechar</button>
              {proximo && <button type="button" className={css.btnPri} onClick={() => abrir(proximo)}>
                Abrir no WhatsApp ({ok.filter((g) => g.whatsapp).findIndex((g) => g.prestadorId === proximo.prestadorId) + 1} de {ok.filter((g) => g.whatsapp).length})
              </button>}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
