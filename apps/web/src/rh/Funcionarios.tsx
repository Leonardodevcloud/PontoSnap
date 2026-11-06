import { useEffect, useState, type ReactNode } from 'react';
import { SeletorCidade, type Cidade } from '../components/SeletorCidade';
import { useSearchParams } from 'react-router-dom';
import { RaioX } from './RaioX';
import { acordoEmpresaTxt, NIVEL, temAtencao, type Compensacao, type EmpresaBanco, type RespCompensacao } from '../lib/compensacao';
import { Avatar, useAvatares } from '../components/Avatar';
import { RevisarFotos } from './RevisarFotos';
import { api } from '../lib/api';
import { soDigitos } from '../lib/download';
import { lerReais } from '../lib/formato';
import { normalizarChave } from '../lib/pix';
import type { Empregado, Horario } from '../tipos';
import { Botao } from '../components/Botao';
import { Campo } from '../components/Campo';
import { Modal } from '../components/Modal';
import { ModalPessoa } from '../components/ModalPessoa';
import css from './Funcionarios.module.css';

const fmtCpf = (c: string) => c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');

interface ConfigRegra {
  extra?: { extraDiaUtilPct: number; extraDomingoFeriadoPct: number; extraLimiteDiarioMin: number } | null;
  tolerancia?: { toleranciaDiariaMin: number; toleranciaPorMarcacaoMin: number } | null;
  noturno?: { noturnoAdicionalPct: number; noturnoReduzida: boolean; noturnoInicioMin: number; noturnoFimMin: number } | null;
  jornada?: { jornadaSemanalMin: number; interjornadaMinimaMin: number; intervaloMaior6hMin: number } | null;
  banco?: { bancoModo: 'HERDA' | 'ATIVO' | 'INATIVO'; bancoTipoAcordo: 'INDIVIDUAL' | 'COLETIVO' | null; bancoPrazoMeses: number | null; formaCalculo: 'BANCO_HORAS' | 'INTRA_MES'; negativoMes?: 'DESCONTA' | 'CARREGA' } | null;
  destinacao?: { destinacaoFaltas: 'DESCONTA' | 'BANCO' | 'ABONA'; destinacaoAtrasos: 'DESCONTA' | 'BANCO' | 'TOLERA' } | null;
  contrato?: { tipoJornada: 'FIXO' | 'CONTRATO_HORAS' } | null;
}
interface PerfilResumo { id: string; nome: string; padrao: boolean; config?: ConfigRegra; usadoPor?: number; }

/** Resumo curto da regra de banco de um perfil (lista e troca de perfil). */
function resumoBanco(b: ConfigRegra['banco'], empresa?: EmpresaBanco | null): string {
  if (!b || b.bancoModo === 'HERDA') return empresa ? `igual à empresa (${acordoEmpresaTxt(empresa)})` : 'igual à empresa';
  if (b.bancoModo === 'INATIVO') return 'hora extra sempre paga';
  if (b.formaCalculo === 'INTRA_MES') return `paga a diferença no mês · devendo ${b.negativoMes === 'CARREGA' ? 'passa' : 'desconta'}`;
  return `acumula no banco · ${b.bancoPrazoMeses ?? 6}m`;
}

/** A jornada é contrato de horas? Vem da escala (ou de perfil antigo que ainda marca). */
const ehContratoHoras = (c: ConfigRegra | undefined, escalaFlexivel?: boolean) =>
  !!escalaFlexivel || c?.contrato?.tipoJornada === 'CONTRATO_HORAS';


type Filtro = 'TODOS' | 'ATENCAO' | 'MONTADAS' | 'PADRAO' | 'INATIVOS';
type Acao = 'PIN' | 'ESCALA' | 'PERFIL' | 'RAIO' | 'SALARIO' | 'INICIO' | 'ESCALA12' | 'ACESSO' | 'CIDADE' | 'REGRAS';

/**
 * Funcionários: a lista mostra só o essencial (nome, escala, cidade e no
 * máximo um alerta). Tudo da pessoa fica na ficha, que abre ao clicar.
 */
export function Funcionarios() {
  const [lista, setLista] = useState<Empregado[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [msgOk, setMsgOk] = useState<string | null>(null);
  const [addAberto, setAddAberto] = useState(false);
  const [importarAberto, setImportarAberto] = useState(false);
  const [perfis, setPerfis] = useState<PerfilResumo[]>([]);
  const [busca, setBusca] = useState('');
  const params0 = new URLSearchParams(window.location.search);
  const [filtro, setFiltro] = useState<Filtro>(params0.get('comp') === 'NAO_COMPENSA' ? 'ATENCAO' : 'TODOS');
  const [cidadeFiltro, setCidadeFiltro] = useState('');
  const [comp, setComp] = useState<RespCompensacao | null>(null);
  const [regioes, setRegioes] = useState<RegioesResumo | null>(null);
  // Ficha da pessoa e a ação aberta a partir dela (a ficha some enquanto a ação está aberta).
  const [fichaId, setFichaIdSt] = useState<string | null>(null);
  const [fichaAba, setFichaAba] = useState<AbaFicha>('cadastro');
  const setFichaId = (id: string | null) => { setFichaIdSt(id); if (id) setFichaAba('cadastro'); };
  const [acao, setAcao] = useState<{ tipo: Acao; e: Empregado } | null>(null);
  const [regrasDe, setRegrasDe] = useState<PerfilResumo | null | undefined>(undefined);
  // Seleção (cidade em lote).
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [cidadeLote, setCidadeLote] = useState<Empregado[] | null>(null);

  async function carregar() {
    try { setLista(await api.get<Empregado[]>('/empregados')); }
    catch (e) { setErro((e as Error).message); }
    api.get<RespCompensacao>('/ajuda/compensacao').then(setComp).catch(() => {});
    api.get<RegioesResumo>(`/tratamento/feriados/regioes?ano=${new Date().getFullYear()}`).then(setRegioes).catch(() => {});
    api.get<PerfilResumo[]>('/perfis-regra').then(setPerfis).catch(() => {});
  }
  useEffect(() => { void carregar(); }, []);
  const { dados: avs, trocarDesenho } = useAvatares();
  const [params, setParams] = useSearchParams();
  const revisarAberto = params.get('revisar') === '1';
  // Vindo da Folha ("Editar cadastro"): ?ficha=<id>&aba=cadastro abre a ficha direto.
  useEffect(() => {
    const id = params.get('ficha');
    if (!id || !lista) return;
    if (lista.some((e) => e.id === id)) {
      setFichaIdSt(id);
      const a = params.get('aba') as AbaFicha | null;
      setFichaAba(a && ABAS_FICHA.includes(a) ? a : 'cadastro');
    }
    setParams((p) => { const n = new URLSearchParams(p); n.delete('ficha'); n.delete('aba'); return n; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lista]);
  const abrirRevisar = (v: boolean) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set('revisar', '1'); else n.delete('revisar'); return n; });
  const avisar = (m: string) => { setMsgOk(m); setTimeout(() => setMsgOk(null), 6000); };

  const compDe = (id: string) => comp?.linhas.find((l) => l.empregadoId === id);
  const empresaCidade = regioes?.empresa?.municipioIbge ? { municipioNome: regioes.empresa.municipioNome ?? '', uf: regioes.empresa.uf } : null;
  const cidadeDe = (e: Empregado) => e.trabalhoMunicipio ? e.trabalhoMunicipioNome ?? '' : empresaCidade?.municipioNome ?? '';
  const chaveCidade = (e: Empregado) => String(e.trabalhoMunicipio ?? regioes?.empresa?.municipioIbge ?? 'sem');
  const atencao = (e: Empregado) => { const c = e.ativo ? compDe(e.id) : undefined; return !!c && temAtencao(c); };

  /** O único alerta da linha (o mais importante), ou nada. */
  function alertaDe(e: Empregado): { txt: string; tom: 'er' | 'av' | 'cz' } | null {
    if (!e.ativo) return { txt: 'Inativo', tom: 'cz' };
    if (!e.horarioContratualId) return { txt: 'Sem escala', tom: 'er' };
    if (atencao(e)) return { txt: 'Horas sem compensar', tom: 'er' };
    const a = avs?.empregados[e.id];
    if (a?.status === 'REVISAR') return { txt: 'Foto para revisar', tom: 'av' };
    if (a?.status === 'RECUSADA') return { txt: 'Foto recusada', tom: 'av' };
    return null;
  }

  const visiveis = lista?.filter((e) => {
    const q = busca.trim().toLowerCase();
    if (q && !`${e.nome} ${e.cpf} ${e.matricula ?? ''}`.toLowerCase().includes(q)) return false;
    if (filtro === 'INATIVOS') return !e.ativo;
    if (!e.ativo) return false;
    if (cidadeFiltro && chaveCidade(e) !== cidadeFiltro) return false;
    if (filtro === 'ATENCAO') return atencao(e) || !e.horarioContratualId;
    if (filtro === 'MONTADAS') return !!e.perfilRegraId;
    if (filtro === 'PADRAO') return !e.perfilRegraId;
    return true;
  }).sort((a, b) => Number(!!alertaDe(b) && b.ativo) - Number(!!alertaDe(a) && a.ativo) || a.nome.localeCompare(b.nome, 'pt-BR'));
  const cidadesLista = (() => {
    const m = new Map<string, { rot: string; n: number }>();
    for (const e of lista ?? []) if (e.ativo) { const k = chaveCidade(e); const c = m.get(k) ?? { rot: cidadeDe(e) || 'sem cidade', n: 0 }; c.n++; m.set(k, c); }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  })();
  const ativos = lista?.filter((e) => e.ativo).length ?? 0;
  const nAtencao = (lista ?? []).filter((e) => e.ativo && (atencao(e) || !e.horarioContratualId)).length;
  const nRevisar = avs?.resumo.revisar ?? 0;
  const todosMarcados = !!visiveis?.length && visiveis.every((e) => marcados.has(e.id));
  const ficha = lista?.find((e) => e.id === fichaId) ?? null;
  const abrir = (tipo: Acao, e: Empregado) => setAcao({ tipo, e });
  const fecharAcao = (recarregar?: boolean) => { setAcao(null); if (recarregar) void carregar(); };
  const clientes = [...new Set((lista ?? []).map((e) => e.cliente).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  return (
    <div className={css.pagina}>
      <div className={css.cab}>
        <div><h2>Funcionários</h2><p>{lista ? `${ativos} ${ativos === 1 ? 'ativo' : 'ativos'}` : 'Carregando…'}</p></div>
        <div className={css.cabAcoes}>
          <button type="button" className={css.lkCab} onClick={() => setImportarAberto(true)}>Importar planilha</button>
          <button type="button" className={css.btnCab} onClick={() => setAddAberto(true)}>+ Adicionar</button>
        </div>
      </div>

      {erro && <p className={css.erro}>{erro}</p>}
      {msgOk && <p className={css.okMsg} role="status">{msgOk}</p>}

      {/* Um aviso por vez: o mais importante. */}
      {nAtencao > 0 && filtro !== 'ATENCAO' ? (
        <div className={css.aviso1} role="status">
          <span><b>{nAtencao === 1 ? '1 pessoa precisa de atenção' : `${nAtencao} pessoas precisam de atenção`}</b> · sem escala ou contrato de horas sem compensar</span>
          <button type="button" onClick={() => setFiltro('ATENCAO')}>Ver</button>
        </div>
      ) : nRevisar > 0 ? (
        <div className={css.aviso1} role="status">
          <span><b>{nRevisar === 1 ? '1 foto nova para revisar' : `${nRevisar} fotos novas para revisar`}</b> · enviadas pelo app</span>
          <button type="button" onClick={() => abrirRevisar(true)}>Revisar</button>
        </div>
      ) : null}

      <div className={css.barra}>
        <input className={css.buscaN} aria-label="Buscar funcionário" placeholder="Buscar por nome, CPF ou matrícula" value={busca} onChange={(ev) => setBusca(ev.target.value)} />
        <select className={css.selN} aria-label="Filtrar" value={filtro} onChange={(ev) => setFiltro(ev.target.value as Filtro)}>
          <option value="TODOS">Todos os ativos</option>
          <option value="ATENCAO">Precisam de atenção{nAtencao ? ` (${nAtencao})` : ''}</option>
          <option value="MONTADAS">Com perfil de regra</option>
          <option value="PADRAO">Sem perfil (CLT padrão)</option>
          <option value="INATIVOS">Inativos</option>
        </select>
        {cidadesLista.length > 1 && (
          <select className={css.selN} aria-label="Filtrar por cidade" value={cidadeFiltro} onChange={(ev) => setCidadeFiltro(ev.target.value)}>
            <option value="">Todas as cidades</option>
            {cidadesLista.map(([k, c]) => <option key={k} value={k}>{c.rot} ({c.n})</option>)}
          </select>
        )}
      </div>

      {marcados.size > 0 && (
        <div className={css.lote} role="region" aria-label="Ações em lote">
          <b>{marcados.size} {marcados.size === 1 ? 'selecionado' : 'selecionados'}</b>
          <button type="button" className={css.loteBtn} onClick={() => setCidadeLote((lista ?? []).filter((e) => marcados.has(e.id)))}>Cidade de trabalho…</button>
          <button type="button" className={css.loteLk} onClick={() => setMarcados(new Set())}>Limpar</button>
        </div>
      )}

      <div className={css.listaN}>
        {visiveis && visiveis.length > 0 && (
          <div className={css.listaTopo}>
            <input type="checkbox" className={css.marca} aria-label="Selecionar todos da lista" checked={todosMarcados}
              onChange={() => setMarcados(todosMarcados ? new Set() : new Set(visiveis.map((e) => e.id)))} />
            <span>{visiveis.length} {visiveis.length === 1 ? 'pessoa' : 'pessoas'}</span>
          </div>
        )}
        {visiveis?.length === 0 && <div className={css.vazio}>{lista?.length === 0 ? 'Ninguém cadastrado ainda. Adicione o primeiro funcionário.' : 'Ninguém com esse filtro.'}</div>}
        {visiveis?.map((e) => {
          const al = alertaDe(e);
          const esc = e.escalaCodigo ?? (e.horarioContratualId ? 'Horário vinculado' : 'Sem escala');
          return (
            <div key={e.id} className={`${css.linhaN} ${e.ativo ? '' : css.linhaInativa}`}>
              <input type="checkbox" className={css.marca} aria-label={`Selecionar ${e.nome}`} checked={marcados.has(e.id)}
                onChange={() => setMarcados((m) => { const n = new Set(m); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; })} />
              <button type="button" className={css.linhaBtn} onClick={() => setFichaId(e.id)}>
                <Avatar id={e.id} nome={e.nome} tamanho={36} />
                <span className={css.linhaTxt}>
                  <span className={css.nomeN}>{e.nome}</span>
                  <span className={css.subN}>{[esc, cidadeDe(e)].filter(Boolean).join(' · ')}</span>
                </span>
                {al && <span className={`${css.pillN} ${css[`pill-${al.tom}`]}`}>{al.txt}</span>}
                <span className={css.seta} aria-hidden="true">›</span>
              </button>
            </div>
          );
        })}
      </div>

      {ficha && !acao && regrasDe === undefined && (
        <FichaFuncionario e={ficha} comp={compDe(ficha.id)} perfis={perfis} empresa={comp?.empresa ?? null} foto={avs?.empregados[ficha.id]}
          regioes={regioes} clientes={clientes} onCadastroSalvo={(m) => { avisar(m); void carregar(); }}
          aba={fichaAba} onAba={setFichaAba}
          onFechar={() => setFichaId(null)} onAcao={(t) => abrir(t, ficha)} onRegras={(p) => setRegrasDe(p)}
          onTrocarDesenho={() => void trocarDesenho('CLT', ficha.id)} onRevisarFoto={() => abrirRevisar(true)}
          onAtivo={async () => { await api.patch(`/empregados/${ficha.id}/ativo`, { ativo: !ficha.ativo }).catch(() => {}); avisar(`${ficha.nome} ${ficha.ativo ? 'inativado' : 'reativado'}.`); void carregar(); }} />
      )}

      {addAberto && <ModalAdicionar regioes={regioes} clientes={clientes} onFechar={() => setAddAberto(false)} onCriado={() => { setAddAberto(false); void carregar(); }} />}
      {importarAberto && <ModalImportar onFechar={() => setImportarAberto(false)} onImportado={() => void carregar()} />}
      {acao?.tipo === 'PIN' && <ModalPin empregado={acao.e} onFechar={() => fecharAcao()} onSalvo={() => fecharAcao(true)} />}
      {acao?.tipo === 'ESCALA' && <ModalEscala empregado={acao.e} onFechar={() => fecharAcao()} onSalvo={() => fecharAcao(true)} />}
      {acao?.tipo === 'RAIO' && <RaioX empregadoId={acao.e.id} onFechar={() => fecharAcao()}
        onEscala={() => setAcao({ tipo: 'ESCALA', e: acao.e })} onPerfil={() => setAcao({ tipo: 'PERFIL', e: acao.e })} />}
      {acao?.tipo === 'PERFIL' && <ModalPerfil empresa={comp?.empresa ?? null} empregado={acao.e} perfis={perfis} onFechar={() => fecharAcao()} onSalvo={() => fecharAcao(true)} />}
      {regrasDe !== undefined && <ModalRegras perfil={regrasDe} onFechar={() => setRegrasDe(undefined)} />}
      {acao?.tipo === 'SALARIO' && <ModalSalario empregado={acao.e} onFechar={() => fecharAcao()} onSalvo={() => fecharAcao(true)} />}
      {acao?.tipo === 'INICIO' && <ModalDataInicio empregado={acao.e} onFechar={() => fecharAcao()} onSalvo={() => fecharAcao(true)} />}
      {acao?.tipo === 'ESCALA12' && <ModalEscala12x36 empregado={acao.e} onFechar={() => fecharAcao()} onSalvo={() => fecharAcao()} />}
      {acao?.tipo === 'ACESSO' && <ModalAcesso empregado={acao.e} onFechar={() => fecharAcao()} onSalvo={() => fecharAcao(true)} />}
      {acao?.tipo === 'CIDADE' && <ModalCidade pessoas={[acao.e]} regioes={regioes} onFechar={() => fecharAcao()} onSalvo={(m) => { avisar(m); fecharAcao(true); }} />}
      {cidadeLote && <ModalCidade pessoas={cidadeLote} regioes={regioes} onFechar={() => setCidadeLote(null)}
        onSalvo={(m) => { setCidadeLote(null); setMarcados(new Set()); avisar(m); void carregar(); }} />}
      <RevisarFotos aberto={revisarAberto} onFechar={() => abrirRevisar(false)} emps={lista ?? []} />
    </div>
  );
}

/** Ficha da pessoa: tudo dela em abas; as ações abrem a partir daqui. */
type AbaFicha = 'cadastro' | 'jornada' | 'regras' | 'salario' | 'acesso';
const ABAS_FICHA: AbaFicha[] = ['cadastro', 'jornada', 'regras', 'salario', 'acesso'];
function FichaFuncionario({ e, comp: c, perfis, empresa, foto, regioes, clientes, onCadastroSalvo, aba, onAba, onFechar, onAcao, onRegras, onTrocarDesenho, onRevisarFoto, onAtivo }: {
  aba: AbaFicha; onAba: (a: AbaFicha) => void;
  e: Empregado; comp?: Compensacao; perfis: PerfilResumo[]; empresa: EmpresaBanco | null;
  foto?: { foto?: string | null; status?: string | null; temApp?: boolean; motivo?: string | null };
  regioes: RegioesResumo | null; clientes: string[]; onCadastroSalvo: (m: string) => void;
  onFechar: () => void; onAcao: (t: Acao) => void; onRegras: (p: PerfilResumo | null) => void;
  onTrocarDesenho: () => void; onRevisarFoto: () => void; onAtivo: () => Promise<void>;
}) {
  const [confirmar, setConfirmar] = useState(false);
  const [cad, setCad] = useState({ sujo: false, salvando: false });
  const p = e.perfilRegraId ? perfis.find((x) => x.id === e.perfilRegraId) : undefined;
  const padrao = perfis.find((x) => x.padrao);
  const efetivo = p ?? padrao;
  const at = !!c && temAtencao(c);
  const Linha = ({ k, v, acao, onClick }: { k: string; v: ReactNode; acao?: string; onClick?: () => void }) => (
    <div className={css.fLinha}><span className={css.fK}>{k}</span><span className={css.fV}>{v}</span>{acao && <button type="button" className={css.fLk} onClick={onClick}>{acao}</button>}</div>
  );
  return (
    <ModalPessoa aberto onFechar={onFechar} largura={760}
      foto={<Avatar id={e.id} nome={e.nome} tamanho={84} />}
      titulo={e.nome}
      meta={[e.cargo, e.matricula ? `Mat. ${e.matricula}` : null, fmtCpf(e.cpf), e.dataInicioPonto ? `ponto desde ${e.dataInicioPonto.split('-').reverse().join('/')}` : null].filter(Boolean).join(' · ')}
      chips={<>
        {!e.ativo && <span className={`${css.pillN} ${css['pill-cz']}`}>Inativo</span>}
        {!e.horarioContratualId && <span className={`${css.pillN} ${css['pill-er']}`}>Sem escala</span>}
        {at && <span className={`${css.pillN} ${css['pill-er']}`}>Horas sem compensar</span>}
      </>}
      abas={[{ id: 'cadastro', rotulo: 'Cadastro' }, { id: 'jornada', rotulo: 'Jornada' }, { id: 'regras', rotulo: 'Banco e regras' }, { id: 'salario', rotulo: 'Salário' }, { id: 'acesso', rotulo: 'Acesso e foto' }]}
      aba={aba} onAba={(x) => onAba(x as AbaFicha)}
      rodape={<>
        {confirmar
          ? <span className={css.fConfirma}>{e.ativo ? 'Inativar: some das listas e para de bater ponto.' : 'Reativar este funcionário?'}
              <button type="button" className={css.fLk} onClick={() => { setConfirmar(false); void onAtivo(); }}>Confirmar</button>
              <button type="button" className={css.fLk} onClick={() => setConfirmar(false)}>Cancelar</button></span>
          : <button type="button" className={`${css.fLk} ${e.ativo ? css.fPerigo : ''}`} onClick={() => setConfirmar(true)}>{e.ativo ? 'Inativar…' : 'Reativar'}</button>}
        <span style={{ flex: 1 }} />
        <button type="button" className={css.btnSecN} onClick={onFechar}>Fechar</button>
        {aba === 'cadastro' && <button type="submit" form="form-cadastro" className={css.btnPriN} disabled={!cad.sujo || cad.salvando}>{cad.salvando ? 'Salvando…' : 'Salvar cadastro'}</button>}
      </>}>
      {/* Fica montada (escondida) para não perder o que foi digitado ao trocar de aba. */}
      <AbaCadastro e={e} regioes={regioes} clientes={clientes} oculto={aba !== 'cadastro'} onEstado={setCad} onSalvo={onCadastroSalvo} onAba={(x) => onAba(x)} />
      {aba === 'jornada' && (
        <div className={css.fGrupo}>
          <Linha k="Escala" v={e.escalaCodigo ?? (e.horarioContratualId ? 'Horário vinculado' : <span className={css.fAlerta}>Sem escala: o ponto não é calculado</span>)} acao={e.horarioContratualId ? 'Trocar' : 'Definir'} onClick={() => onAcao('ESCALA')} />
          <Linha k="Tipo de jornada" v={c?.jornada === 'CONTRATO_HORAS' ? 'Contrato de horas' : c?.jornada === '12X36' ? '12x36' : ehContratoHoras(efetivo?.config, e.escalaFlexivel) ? 'Contrato de horas' : 'Horário fixo'} />
          <Linha k="Início do ponto" v={e.dataInicioPonto ? e.dataInicioPonto.split('-').reverse().join('/') : 'Desde o cadastro'} acao="Alterar" onClick={() => onAcao('INICIO')} />
          {c?.jornada === '12X36' && <Linha k="Escala 12x36" v="Dias de trabalho alternados" acao="Gerar dias" onClick={() => onAcao('ESCALA12')} />}
          {c?.jornada !== '12X36' && <p className={css.fNota}>Escala 12x36? <button type="button" className={css.fLk} onClick={() => onAcao('ESCALA12')}>Gerar os dias da escala</button></p>}
        </div>
      )}
      {aba === 'regras' && (
        <div className={css.fGrupo}>
          <Linha k="Como as horas contam" v={c ? <span className={at ? css.fAlerta : ''}>{NIVEL[c.nivel].rot[0]!.toUpperCase() + NIVEL[c.nivel].rot.slice(1)} · {c.resumo}</span> : resumoBanco(efetivo?.config?.banco, empresa)} acao="Ver detalhes" onClick={() => onAcao('RAIO')} />
          <Linha k="Perfil de regra" v={p ? p.nome : padrao ? <>{padrao.nome}<span className={css.fMute}> (padrão da empresa)</span></> : 'CLT padrão'} acao="Trocar" onClick={() => onAcao('PERFIL')} />
          <Linha k="Banco de horas" v={resumoBanco(efetivo?.config?.banco, empresa)} acao="Ver regras" onClick={() => onRegras(efetivo ?? null)} />
          {c?.alertas.filter((a) => a.gravidade !== 'info').slice(0, 2).map((a) => <p key={a.codigo} className={css.fAviso}>{a.texto}</p>)}
        </div>
      )}
      {aba === 'salario' && (
        <div className={css.fGrupo}>
          <Linha k="Salário mensal" v={e.salarioMensal ? Number(e.salarioMensal).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'Não informado'} acao={e.salarioMensal ? 'Reajustar' : 'Definir'} onClick={() => onAcao('SALARIO')} />
          <p className={css.fNota}>O salário vale a partir da data que você escolher; os meses anteriores continuam com o valor antigo.</p>
        </div>
      )}
      {aba === 'acesso' && (
        <div className={css.fGrupo}>
          <Linha k="App do funcionário" v={e.emailAcesso ? e.emailAcesso : 'Sem acesso ao app'} acao={e.emailAcesso ? 'Resetar senha' : 'Criar acesso'} onClick={() => onAcao('ACESSO')} />
          <Linha k="PIN do quiosque" v={e.temPin ? 'Definido' : 'Sem PIN'} acao={e.temPin ? 'Trocar' : 'Definir'} onClick={() => onAcao('PIN')} />
          <Linha k="Foto" v={foto?.status === 'REVISAR' ? <span className={css.fAlerta}>Foto nova para revisar</span> : foto?.status === 'RECUSADA' ? 'Recusada · pedindo outra no app' : foto?.foto ? 'Aprovada' : foto?.temApp ? 'Sem foto · pede no próximo acesso' : 'Sem foto'}
            acao={foto?.status === 'REVISAR' ? 'Revisar' : !foto?.foto ? 'Trocar desenho' : undefined} onClick={foto?.status === 'REVISAR' ? onRevisarFoto : onTrocarDesenho} />
        </div>
      )}
    </ModalPessoa>
  );
}

interface ResultadoImport {
  criados: number;
  comAcesso: number;
  totalLinhas: number;
  erros: { linha: number; cpf?: string; motivo: string }[];
}

function ModalImportar({ onFechar, onImportado }: { onFechar: () => void; onImportado: () => void }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImport | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function baixarModelo() {
    try {
      const blob = await api.baixar('/empregados/modelo-importacao');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'modelo_funcionarios.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setErro((e as Error).message); }
  }

  async function enviar() {
    if (!arquivo || enviando) return;
    setErro(null); setEnviando(true);
    try {
      const r = await api.enviarArquivo<ResultadoImport>('/empregados/importar', arquivo);
      setResultado(r);
      if (r.criados > 0) onImportado();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal titulo="Importar funcionários" onFechar={onFechar}>
      {resultado ? (
        <div className={css.importResultado}>
          <div className={css.importResumo}>
            <strong>{resultado.criados}</strong> cadastrado{resultado.criados !== 1 ? 's' : ''}
            {resultado.comAcesso > 0 && <span> · {resultado.comAcesso} com acesso ao app enviado por e-mail</span>}
          </div>
          {resultado.erros.length > 0 ? (
            <>
              <p className={css.importErrosTit}>
                {resultado.erros.length} linha{resultado.erros.length !== 1 ? 's' : ''} não {resultado.erros.length !== 1 ? 'entraram' : 'entrou'}:
              </p>
              <div className={css.importErros}>
                {resultado.erros.map((e, i) => (
                  <div key={i} className={css.importErroLinha}>
                    <span className={css.importErroNum}>Linha {e.linha}</span>
                    {e.cpf && <span className={css.importErroCpf}>{e.cpf}</span>}
                    <span className={css.importErroMotivo}>{e.motivo}</span>
                  </div>
                ))}
              </div>
              <p className={css.importDica}>Corrija essas linhas na planilha e importe de novo — as que já entraram não duplicam.</p>
            </>
          ) : (
            <p className={css.importTudoCerto}>Tudo certo, nenhuma linha com erro.</p>
          )}
          <Botao variante="coral" onClick={onFechar}>Fechar</Botao>
        </div>
      ) : (
        <div className={css.importForm}>
          <p className={css.importIntro}>
            Suba um arquivo <strong>.xlsx</strong> ou <strong>.csv</strong> com os funcionários.
            Não tem o modelo?
            <button type="button" className={css.importLink} onClick={baixarModelo}> Baixar planilha modelo</button>.
          </p>

          <label className={css.importDrop}>
            <input
              type="file" accept=".xlsx,.csv"
              onChange={(e) => { setArquivo(e.target.files?.[0] ?? null); setErro(null); }}
            />
            {arquivo ? (
              <span className={css.importArquivo}>{arquivo.name}</span>
            ) : (
              <span className={css.importPlaceholder}>Clique para escolher o arquivo</span>
            )}
          </label>

          {erro && <p className={css.erro}>{erro}</p>}

          <div className={css.importAcoes}>
            <Botao variante="ghost" onClick={onFechar}>Cancelar</Botao>
            <Botao variante="coral" onClick={enviar} disabled={!arquivo || enviando}>
              {enviando ? 'Importando…' : 'Importar'}
            </Botao>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Campo com rótulo em cima (padrão dos formulários de cadastro). */
function CampoCad({ id, rotulo, opcional, ajuda, erro, children }: { id: string; rotulo: string; opcional?: boolean; ajuda?: ReactNode; erro?: string; children: ReactNode }) {
  return (
    <label className={css.cadCampo} htmlFor={id}>
      <span>{rotulo}{opcional && <i> (opcional)</i>}</span>
      {children}
      {erro ? <small className={css.cadErro}>{erro}</small> : ajuda && <small>{ajuda}</small>}
    </label>
  );
}

const rotuloEmpresa = (r: RegioesResumo | null) => r?.empresa?.municipioIbge ? `${r.empresa.municipioNome}-${r.empresa.uf}` : null;
const emUsoDe = (r: RegioesResumo | null) => (r?.cidades ?? []).map((c) => ({ municipio: c.municipio, nome: c.nome, uf: c.uf, pessoas: c.funcionarios + c.prestadores }));
const erroPix = (v: string) => (v.trim() && !normalizarChave(v) ? 'Não reconheci essa chave Pix.' : '');
const hojeIso = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

/**
 * Aba Cadastro da ficha: dados que valem para todos os meses (nome, matrícula,
 * cargo, admissão, onde trabalha, cliente e chave Pix). CPF não muda: está nas
 * batidas já gravadas. Salário e acesso continuam nas abas deles.
 */
function AbaCadastro({ e, regioes, clientes, oculto, onEstado, onSalvo, onAba }: {
  e: Empregado; regioes: RegioesResumo | null; clientes: string[]; oculto: boolean;
  onEstado: (s: { sujo: boolean; salvando: boolean }) => void; onSalvo: (m: string) => void; onAba: (a: AbaFicha) => void;
}) {
  const inicial = () => ({
    nome: e.nome, matricula: e.matricula ?? '', cargo: e.cargo ?? '', dataAdmissao: e.dataAdmissao ?? '', cliente: e.cliente ?? '', chavePix: e.chavePix ?? '',
    cidade: (e.trabalhoMunicipio ? { municipio: e.trabalhoMunicipio, municipioNome: e.trabalhoMunicipioNome ?? '', uf: e.trabalhoUf ?? '' } : null) as Cidade | null,
  });
  const [f, setF] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { setF(inicial()); setErro(null); }, [e]);
  const base = inicial();
  const sujo = JSON.stringify(f) !== JSON.stringify(base);
  useEffect(() => { onEstado({ sujo, salvando }); }, [sujo, salvando]);
  const emp = rotuloEmpresa(regioes);
  const pixErro = erroPix(f.chavePix);

  async function salvar(ev: React.FormEvent) {
    ev.preventDefault();
    if (f.nome.trim().length < 2) { setErro('Informe o nome completo.'); return; }
    if (pixErro) { setErro(pixErro); return; }
    setSalvando(true); setErro(null);
    try {
      const corpo: Record<string, string | null> = {};
      if (f.nome.trim() !== base.nome) corpo.nome = f.nome.trim();
      for (const k of ['matricula', 'cargo', 'dataAdmissao', 'cliente', 'chavePix'] as const) {
        if (f[k].trim() !== base[k]) corpo[k] = f[k].trim() || null;
      }
      if (Object.keys(corpo).length) await api.patch(`/empregados/${e.id}/cadastro`, corpo);
      if ((f.cidade?.municipio ?? null) !== (base.cidade?.municipio ?? null)) {
        await api.post('/tratamento/feriados/local-pessoas', { empregadoIds: [e.id], municipio: f.cidade?.municipio ?? null, municipioNome: f.cidade?.municipioNome ?? null });
      }
      onSalvo(`Cadastro de ${f.nome.trim()} salvo.`);
    } catch (x) { setErro((x as Error).message); }
    finally { setSalvando(false); }
  }

  return (
    <form id="form-cadastro" className={css.cadGrid} onSubmit={salvar} hidden={oculto} noValidate>
      <div className={css.cadCol}>
        <section className={css.cadCard}>
          <span className={css.cadLb}>Identificação</span>
          <CampoCad id="cad-nome" rotulo="Nome completo">
            <input id="cad-nome" className={css.cadInput} value={f.nome} maxLength={52} onChange={(x) => setF({ ...f, nome: x.target.value })} />
          </CampoCad>
          <div className={css.cadG2}>
            <CampoCad id="cad-cpf" rotulo="CPF"><input id="cad-cpf" className={css.cadInput} value={fmtCpf(e.cpf)} disabled /></CampoCad>
            <CampoCad id="cad-mat" rotulo="Matrícula" opcional>
              <input id="cad-mat" className={css.cadInput} value={f.matricula} maxLength={30} placeholder="Ex.: 014" onChange={(x) => setF({ ...f, matricula: x.target.value })} />
            </CampoCad>
          </div>
          <small className={css.cadNota}>O CPF não muda: ele está nas batidas já gravadas.</small>
        </section>
        <section className={css.cadCard}>
          <span className={css.cadLb}>Contrato</span>
          <div className={css.cadG2}>
            <CampoCad id="cad-cargo" rotulo="Cargo">
              <input id="cad-cargo" className={css.cadInput} value={f.cargo} maxLength={80} placeholder="Auxiliar de logística" onChange={(x) => setF({ ...f, cargo: x.target.value })} />
            </CampoCad>
            <CampoCad id="cad-adm" rotulo="Admitido em">
              <input id="cad-adm" type="date" className={css.cadInput} value={f.dataAdmissao} max={hojeIso()} onChange={(x) => setF({ ...f, dataAdmissao: x.target.value })} />
            </CampoCad>
          </div>
          <small className={css.cadNota}>Data real de entrada, mesmo antes de usar o ponto. Conta a carência da cesta básica.</small>
        </section>
      </div>
      <div className={css.cadCol}>
        <section className={css.cadCard}>
          <span className={css.cadLb}>Onde trabalha</span>
          <div className={css.cadCampo}>
            <span id="cad-cid-rot">Cidade de trabalho</span>
            <SeletorCidade valor={f.cidade} onChange={(c) => setF({ ...f, cidade: c })} emUso={emUsoDe(regioes)} id="cad-cid"
              rotuloVazio={emp ? `Mesma da empresa (${emp})` : 'Mesma da empresa'} />
            <small>Define os feriados estaduais e municipais. Vazio = a cidade da empresa.</small>
          </div>
          <CampoCad id="cad-cli" rotulo="Trabalha para o cliente" opcional ajuda="Aparece na Folha, ao lado do nome.">
            <input id="cad-cli" className={css.cadInput} value={f.cliente} list="cad-cli-lista" maxLength={120} autoComplete="off" placeholder="Ex.: Auto Norte Maceió"
              onChange={(x) => setF({ ...f, cliente: x.target.value })} />
            <datalist id="cad-cli-lista">{clientes.map((c) => <option key={c} value={c} />)}</datalist>
          </CampoCad>
        </section>
        <section className={css.cadCard}>
          <span className={css.cadLb}>Pagamento</span>
          <CampoCad id="cad-pix" rotulo="Chave Pix" opcional erro={pixErro} ajuda="Usada no botão Pix da Folha. CPF, celular, e-mail ou aleatória.">
            <input id="cad-pix" className={css.cadInput} value={f.chavePix} maxLength={120} autoComplete="off" aria-invalid={!!pixErro || undefined}
              onChange={(x) => setF({ ...f, chavePix: x.target.value })} />
          </CampoCad>
        </section>
        <p className={css.cadRodNota}>Salário fica na aba <button type="button" className={css.fLk} onClick={() => onAba('salario')}>Salário</button>, com a data em que passa a valer. E-mail e senha do app em <button type="button" className={css.fLk} onClick={() => onAba('acesso')}>Acesso e foto</button>.</p>
      </div>
      {erro && <p className={`${css.erro} ${css.cadCheio}`} role="alert">{erro}</p>}
    </form>
  );
}

function ModalAdicionar({ regioes, clientes, onFechar, onCriado }: { regioes: RegioesResumo | null; clientes: string[]; onFechar: () => void; onCriado: () => void }) {
  const [f, setF] = useState({ nome: '', cpf: '', matricula: '', cargo: '', salario: '', dataAdmissao: '', dataInicio: '', cliente: '', chavePix: '', email: '', pin: '' });
  const [cidade, setCidade] = useState<Cidade | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [acessoCriado, setAcessoCriado] = useState<{ email: string; senhaProvisoria: string } | null>(null);
  const emp = rotuloEmpresa(regioes);
  const pixErro = erroPix(f.chavePix);
  const campo = (k: keyof typeof f) => ({ value: f[k], onChange: (x: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: x.target.value }) });

  async function salvar(ev: React.FormEvent) {
    ev.preventDefault();
    if (pixErro) { setErro(pixErro); return; }
    setErro(null); setEnviando(true);
    try {
      const sal = f.salario ? lerReais(f.salario) : undefined;
      const r = await api.post<{ id: string; acesso?: { email: string; senhaProvisoria: string } }>('/empregados', {
        nome: f.nome.trim(), cpf: soDigitos(f.cpf),
        matricula: f.matricula.trim() || undefined,
        pin: f.pin.trim() || undefined,
        salarioMensal: sal,
        dataInicioPonto: f.dataInicio || undefined,
        email: f.email.trim() || undefined,
        cargo: f.cargo.trim() || undefined,
        dataAdmissao: f.dataAdmissao || undefined,
        cliente: f.cliente.trim() || undefined,
        chavePix: f.chavePix.trim() || undefined,
      });
      if (cidade) {
        // Cidade de trabalho (feriados). Se falhar, o funcionário já existe: dá pra trocar na ficha.
        await api.post('/tratamento/feriados/local-pessoas', { empregadoIds: [r.id], municipio: cidade.municipio, municipioNome: cidade.municipioNome }).catch(() => {});
      }
      if (r.acesso) { setAcessoCriado(r.acesso); return; }
      onCriado();
    } catch (x) { setErro((x as Error).message); setEnviando(false); }
  }

  if (acessoCriado) {
    return (
      <Modal titulo="Funcionário cadastrado" onFechar={onCriado}>
        <Credencial email={acessoCriado.email} senha={acessoCriado.senhaProvisoria} />
        <Botao variante="lime" onClick={onCriado}>Concluir</Botao>
      </Modal>
    );
  }

  return (
    <ModalPessoa aberto onFechar={onFechar} titulo="Adicionar funcionário" compacto largura={980}
      meta="Só nome e CPF são obrigatórios. O resto dá pra completar depois, na aba Cadastro."
      rodape={<>
        <span style={{ flex: 1 }} />
        <button type="button" className={css.btnSecN} onClick={onFechar}>Cancelar</button>
        <button type="submit" form="form-novo" className={css.btnPriN} disabled={enviando || f.nome.trim().length < 2 || soDigitos(f.cpf).length !== 11}>
          {enviando ? 'Salvando…' : 'Adicionar funcionário'}
        </button>
      </>}>
      <form id="form-novo" className={css.cadGrid} onSubmit={salvar} noValidate>
        <div className={css.cadCol}>
          <section className={css.cadCard}>
            <span className={css.cadLb}>Identificação</span>
            <CampoCad id="n-nome" rotulo="Nome completo"><input id="n-nome" className={css.cadInput} maxLength={52} placeholder="Maria Silva" data-autofoco {...campo('nome')} /></CampoCad>
            <div className={css.cadG2}>
              <CampoCad id="n-cpf" rotulo="CPF"><input id="n-cpf" className={css.cadInput} inputMode="numeric" placeholder="000.000.000-00" {...campo('cpf')} /></CampoCad>
              <CampoCad id="n-mat" rotulo="Matrícula" opcional><input id="n-mat" className={css.cadInput} maxLength={30} placeholder="001" {...campo('matricula')} /></CampoCad>
            </div>
          </section>
          <section className={css.cadCard}>
            <span className={css.cadLb}>Contrato</span>
            <div className={css.cadG2}>
              <CampoCad id="n-cargo" rotulo="Cargo" opcional><input id="n-cargo" className={css.cadInput} maxLength={80} placeholder="Auxiliar de logística" {...campo('cargo')} /></CampoCad>
              <CampoCad id="n-sal" rotulo="Salário mensal" opcional><input id="n-sal" className={css.cadInput} inputMode="decimal" placeholder="Ex.: 2.200,00" {...campo('salario')} /></CampoCad>
              <CampoCad id="n-adm" rotulo="Admitido em" opcional><input id="n-adm" type="date" className={css.cadInput} max={hojeIso()} {...campo('dataAdmissao')} /></CampoCad>
              <CampoCad id="n-ini" rotulo="Início do ponto" opcional><input id="n-ini" type="date" className={css.cadInput} {...campo('dataInicio')} /></CampoCad>
            </div>
            <small className={css.cadNota}>Admissão conta a carência da cesta. Início do ponto: a apuração ignora os dias antes dele.</small>
          </section>
        </div>
        <div className={css.cadCol}>
          <section className={css.cadCard}>
            <span className={css.cadLb}>Onde trabalha</span>
            <div className={css.cadCampo}>
              <span>Cidade de trabalho</span>
              <SeletorCidade valor={cidade} onChange={setCidade} emUso={emUsoDe(regioes)} id="n-cid" rotuloVazio={emp ? `Mesma da empresa (${emp})` : 'Mesma da empresa'} />
              <small>Define os feriados estaduais e municipais.</small>
            </div>
            <CampoCad id="n-cli" rotulo="Trabalha para o cliente" opcional>
              <input id="n-cli" className={css.cadInput} list="n-cli-lista" maxLength={120} autoComplete="off" placeholder="Ex.: Auto Norte Maceió" {...campo('cliente')} />
              <datalist id="n-cli-lista">{clientes.map((c) => <option key={c} value={c} />)}</datalist>
            </CampoCad>
          </section>
          <section className={css.cadCard}>
            <span className={css.cadLb}>Pagamento e acesso</span>
            <CampoCad id="n-pix" rotulo="Chave Pix" opcional erro={pixErro}>
              <input id="n-pix" className={css.cadInput} maxLength={120} autoComplete="off" placeholder="CPF, celular, e-mail ou aleatória" {...campo('chavePix')} />
            </CampoCad>
            <div className={css.cadG2}>
              <CampoCad id="n-mail" rotulo="E-mail do app" opcional><input id="n-mail" type="email" className={css.cadInput} placeholder="maria@empresa.com.br" {...campo('email')} /></CampoCad>
              <CampoCad id="n-pin" rotulo="PIN do quiosque" opcional><input id="n-pin" className={css.cadInput} inputMode="numeric" maxLength={8} placeholder="4 a 8 dígitos" {...campo('pin')} /></CampoCad>
            </div>
            <small className={css.cadNota}>Com e-mail, a senha provisória aparece ao salvar. Sem e-mail, bate ponto só no quiosque.</small>
          </section>
        </div>
        {erro && <p className={`${css.erro} ${css.cadCheio}`} role="alert">{erro}</p>}
      </form>
    </ModalPessoa>
  );
}

function ModalPin({ empregado, onFechar, onSalvo }: { empregado: Empregado; onFechar: () => void; onSalvo: () => void }) {
  const [pin, setPin] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function salvar() {
    setErro(null); setEnviando(true);
    try { await api.patch(`/empregados/${empregado.id}/pin`, { pin: pin.trim() }); onSalvo(); }
    catch (e) { setErro((e as Error).message); setEnviando(false); }
  }

  return (
    <Modal titulo={`PIN de ${empregado.nome.split(' ')[0]}`} onFechar={onFechar}>
      <p className={css.pinInfo}>O PIN é o atalho pra bater ponto no tablet-quiosque. Fica guardado com hash.</p>
      <Campo rotulo="Novo PIN" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="4 a 8 dígitos" />
      {erro && <p className={css.erro}>{erro}</p>}
      <Botao variante="coral" onClick={salvar} disabled={enviando || pin.length < 4}>
        {enviando ? 'Salvando…' : 'Salvar PIN'}
      </Botao>
    </Modal>
  );
}

function ModalEscala({ empregado, onFechar, onSalvo }: { empregado: Empregado; onFechar: () => void; onSalvo: () => void }) {
  const [horarios, setHorarios] = useState<Horario[]>([]);
  const [sel, setSel] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  // Padrão: mudar a partir de uma data (preserva o passado). "Corrigir" reescreve
  // todo o histórico — quem trocou de escala e usava ele via dias antigos virarem extra/falta.
  const [modo, setModo] = useState<'corrigir' | 'mudar'>('mudar');
  const [dataInicio, setDataInicio] = useState(() => new Date().toISOString().slice(0, 10));
  const [historico, setHistorico] = useState<{ codigo: string; dataInicio: string | null; dataFim: string | null; horarioId: string }[]>([]);
  const [confirmaCorrigir, setConfirmaCorrigir] = useState(false);
  const br = (d: string) => d.split('-').reverse().join('/');

  useEffect(() => {
    api.get<Horario[]>('/tratamento/horarios')
      .then((l) => { setHorarios(l); const atual = l.find((h) => h.id === empregado.horarioContratualId) ?? l[0]; if (atual) setSel(atual.id); })
      .catch((e) => setErro((e as Error).message));
    api.get<typeof historico>(`/tratamento/empregados/${empregado.id}/escalas`).then(setHistorico).catch(() => setHistorico([]));
  }, [empregado.id, empregado.horarioContratualId]);

  async function salvar() {
    setErro(null); setEnviando(true);
    try {
      if (modo === 'mudar') {
        await api.post(`/tratamento/empregados/${empregado.id}/mudar-escala`, { horarioContratualId: sel, dataInicio });
      } else {
        await api.patch(`/empregados/${empregado.id}/horario`, { horarioContratualId: sel });
      }
      onSalvo();
    } catch (e) { setErro((e as Error).message); setEnviando(false); }
  }

  return (
    <Modal titulo={`Escala de ${empregado.nome.split(' ')[0]}`} onFechar={onFechar}>
      {horarios.length === 0 ? (
        <p className={css.aviso}>Nenhuma escala cadastrada ainda. Crie uma em <strong>Escalas</strong> primeiro.</p>
      ) : (
        <>
          {historico.length > 0 && (
            <div className={css.histEscala}>
              <span className={css.selLb}>Escalas de {empregado.nome.split(' ')[0]}</span>
              {historico.map((h, i) => (
                <div key={i} className={css.histLinha}>
                  <b>{h.codigo}</b>
                  <span>{h.dataInicio ? `de ${br(h.dataInicio)}` : 'desde o início'}{h.dataFim ? ` até ${br(h.dataFim)}` : ' em diante (atual)'}</span>
                </div>
              ))}
            </div>
          )}
          <label className={css.selWrap}>
            <span className={css.selLb}>Escala</span>
            <select className={css.select} value={sel} onChange={(e) => setSel(e.target.value)}>
              {horarios.map((h) => <option key={h.id} value={h.id}>{h.codigo}</option>)}
            </select>
          </label>
          <div className={css.modoEscala}>
            <label className={css.radioLinha}>
              <input type="radio" checked={modo === 'mudar'} onChange={() => setModo('mudar')} />
              <span><strong>Mudar a partir de uma data</strong> — o funcionário trocou de escala. Os dias antes da data continuam com a escala antiga.</span>
            </label>
            <label className={css.radioLinha}>
              <input type="radio" checked={modo === 'corrigir'} onChange={() => { setModo('corrigir'); setConfirmaCorrigir(false); }} />
              <span><strong>Corrigir cadastro</strong> — a escala sempre esteve errada. <b>Reescreve todo o histórico</b>, inclusive meses já fechados.</span>
            </label>
          </div>
          {modo === 'mudar' && (
            <label className={css.selWrap}>
              <span className={css.selLb}>A nova escala vale a partir de</span>
              <input type="date" className={css.select} value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
            </label>
          )}
        </>
      )}
      {modo === 'corrigir' && horarios.length > 0 && (
        <label className={css.radioLinha}>
          <input type="checkbox" checked={confirmaCorrigir} onChange={(e) => setConfirmaCorrigir(e.target.checked)} />
          <span>Entendi: todos os dias passados passam a ser calculados com esta escala. Se ele <b>mudou</b> de escala (ex.: deixou de trabalhar sábado), use "Mudar a partir de uma data" — senão os dias antigos viram hora extra ou falta.</span>
        </label>
      )}
      {erro && <p className={css.erroModal}>{erro}</p>}
      {horarios.length > 0 && (
        <Botao variante="coral" onClick={salvar} disabled={enviando || !sel || (modo === 'mudar' && !dataInicio) || (modo === 'corrigir' && !confirmaCorrigir)}>
          {enviando ? 'Salvando…' : modo === 'mudar' ? 'Mudar escala' : 'Vincular escala'}
        </Botao>
      )}
    </Modal>
  );
}

function ModalPerfil({ empregado, perfis, empresa, onFechar, onSalvo }: {
  empregado: Empregado; perfis: PerfilResumo[]; empresa: EmpresaBanco | null; onFechar: () => void; onSalvo: () => void;
}) {
  const [sel, setSel] = useState<string>(empregado.perfilRegraId ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const padrao = perfis.find((p) => p.padrao);

  async function salvar() {
    setErro(null); setSalvando(true);
    try {
      await api.patch(`/empregados/${empregado.id}/perfil`, { perfilRegraId: sel || null });
      onSalvo();
    } catch (e) { setErro((e as Error).message); setSalvando(false); }
  }

  return (
    <Modal titulo={`Perfil de ${empregado.nome.split(' ')[0]}`} onFechar={onFechar}>
      <p className={css.aviso}>
        Escolha o perfil de regra deste funcionário. Um clique aplica todas as regras de uma vez.
        Os perfis são criados na tela <strong>Perfis de regra</strong>.
      </p>
      <label className={css.selWrap}>
        <span className={css.selLb}>Perfil de regra</span>
        <select className={css.select} value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="">
            {padrao ? `Sem perfil próprio — usa “${padrao.nome}” (padrão)` : 'Sem perfil — usa CLT padrão'}
          </option>
          {perfis.map((p) => (
            <option key={p.id} value={p.id}>{p.nome}{p.padrao ? ' (padrão)' : ''}</option>
          ))}
        </select>
      </label>
      {perfis.length > 0 && (() => {
        const escolhido = sel ? perfis.find((p) => p.id === sel) : padrao;
        return (
          <p className={css.bancoPrev}>
            <span className={css.bancoPrevLb}>Jornada</span>
            {ehContratoHoras(escolhido?.config, empregado.escalaFlexivel) ? 'contrato de horas' : 'horário fixo'}
            <span className={css.bancoPrevLb} style={{ marginLeft: 10 }}>Banco de horas</span>
            {resumoBanco(escolhido?.config?.banco, empresa)}
          </p>
        );
      })()}
      {perfis.length === 0 && (
        <p className={css.aviso}>Você ainda não criou perfis. Vá em <strong>Perfis de regra</strong> e crie o primeiro.</p>
      )}
      {erro && <p className={css.erroModal}>{erro}</p>}
      <Botao variante="coral" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar perfil'}</Botao>
    </Modal>
  );
}

function ModalSalario({ empregado, onFechar, onSalvo }: { empregado: Empregado; onFechar: () => void; onSalvo: () => void }) {
  type Hist = { vigenteDesde: string; salarioMensal: string };
  const [hist, setHist] = useState<Hist[] | null>(null);
  const [salario, setSalario] = useState('');
  const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const [desde, setDesde] = useState(`${hoje.slice(0, 7)}-01`);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    api.get<Hist[]>(`/empregados/${empregado.id}/salarios`).then(setHist).catch(() => setHist([]));
  }, [empregado.id]);
  const primeiro = hist !== null && hist.length === 0;
  const reais = (v: string | number) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const dataBr = (iso: string) => iso <= '2000-01-01' ? 'o início' : `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const numero = lerReais(salario);

  async function salvar() {
    setErro(null); setEnviando(true);
    try {
      await api.patch(`/empregados/${empregado.id}/salario`, { salarioMensal: numero, ...(primeiro ? {} : { vigenteDesde: desde }) });
      onSalvo();
    } catch (e) { setErro((e as Error).message); setEnviando(false); }
  }

  return (
    <Modal titulo={`Salário de ${empregado.nome.split(' ')[0]}`} onFechar={onFechar}>
      {hist && hist.length > 0 && (
        <div className={css.aviso}>
          {hist.map((h, i) => (
            <div key={h.vigenteDesde}>{i === 0 ? <strong>Atual: </strong> : 'Antes: '}{reais(h.salarioMensal)} desde {dataBr(h.vigenteDesde)}</div>
          ))}
        </div>
      )}
      <Campo rotulo={primeiro ? 'Salário mensal' : 'Novo salário mensal'} inputMode="decimal" value={salario} onChange={(e) => setSalario(e.target.value)} placeholder="Ex.: 2.200,00" />
      {!primeiro && (
        <>
          <Campo rotulo="Vale a partir de" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          <p className={css.aviso}>
            Os dias <strong>antes</strong> dessa data continuam com o salário antigo. Se for no meio do mês, o mês sai <strong>proporcional</strong> (base 30 dias),
            e extras, faltas e valor do dia de cada dia usam o salário daquele dia. Pra mudar a jornada também, use <strong>Mudar escala</strong> com a mesma data.
          </p>
        </>
      )}
      {primeiro && <p className={css.aviso}>Usado para calcular extras, adicional noturno e descontos em R$ (divisor 220h).</p>}
      {erro && <p className={css.erroModal}>{erro}</p>}
      <Botao variante="coral" onClick={salvar} disabled={enviando || !salario || !(numero > 0) || (!primeiro && !desde)}>
        {enviando ? 'Salvando…' : primeiro ? 'Salvar salário' : `Salvar a partir de ${desde ? dataBr(desde) : '…'}`}
      </Botao>
    </Modal>
  );
}

function ModalDataInicio({ empregado, onFechar, onSalvo }: { empregado: Empregado; onFechar: () => void; onSalvo: () => void }) {
  const [data, setData] = useState(empregado.dataInicioPonto ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function salvar(remover = false) {
    setErro(null); setEnviando(true);
    try {
      await api.patch(`/empregados/${empregado.id}/data-inicio-ponto`, { data: remover ? null : (data || null) });
      onSalvo();
    } catch (e) { setErro((e as Error).message); setEnviando(false); }
  }

  return (
    <Modal titulo={`Início do ponto — ${empregado.nome.split(' ')[0]}`} onFechar={onFechar}>
      <Campo rotulo="Começa a bater ponto em" type="date" value={data} onChange={(e) => setData(e.target.value)} />
      <p className={css.aviso}>
        A apuração <strong>ignora tudo antes dessa data</strong> — não gera falta nem cobra jornada.
        Use na migração de sistema (a empresa começou a usar o PontoSnap nessa data) ou para quem foi
        admitido no meio do mês.
      </p>
      {erro && <p className={css.erroModal}>{erro}</p>}
      <Botao variante="coral" onClick={() => salvar(false)} disabled={enviando || !data}>{enviando ? 'Salvando…' : 'Salvar data'}</Botao>
      {empregado.dataInicioPonto && (
        <Botao variante="ghost" onClick={() => salvar(true)} disabled={enviando}>Remover data (apurar desde sempre)</Botao>
      )}
    </Modal>
  );
}

function ModalEscala12x36({ empregado, onFechar, onSalvo }: { empregado: Empregado; onFechar: () => void; onSalvo: () => void }) {
  const [mes, setMes] = useState(new Date().toISOString().slice(0, 7));
  const [dataInicio, setDataInicio] = useState('');
  const [resultado, setResultado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function gerar() {
    setErro(null); setEnviando(true);
    try {
      const [a, m] = mes.split('-').map(Number);
      const ultimo = new Date(a!, m!, 0).getDate();
      const r = await api.post<{ gerados: number }>('/tratamento/escala/gerar-12x36', {
        empregadoId: empregado.id, inicio: `${mes}-01`, fim: `${mes}-${String(ultimo).padStart(2, '0')}`, dataInicio,
      });
      setResultado(`${r.gerados} dias de trabalho gerados na competência.`);
    } catch (e) { setErro((e as Error).message); }
    finally { setEnviando(false); }
  }

  return (
    <Modal titulo={`Escala 12x36 de ${empregado.nome.split(' ')[0]}`} onFechar={onFechar}>
      <p className={css.aviso}>Gera os dias trabalhados alternados (12h de trabalho, 36h de descanso) na competência.</p>
      <label className={css.selWrap}>
        <span className={css.selLb}>Competência</span>
        <input aria-label="Competência" className={css.select} type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
      </label>
      <label className={css.selWrap}>
        <span className={css.selLb}>Primeiro dia de trabalho do ciclo</span>
        <input className={css.select} type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
      </label>
      {resultado && <p className={css.sucesso}>{resultado}</p>}
      {erro && <p className={css.erroModal}>{erro}</p>}
      {resultado
        ? <Botao variante="lime" onClick={onSalvo}>Concluir</Botao>
        : <Botao variante="coral" onClick={gerar} disabled={enviando || !dataInicio}>{enviando ? 'Gerando…' : 'Gerar escala'}</Botao>}
    </Modal>
  );
}

/** Mostra a senha provisória. Ela não é recuperável depois — só resetável. */
function Credencial({ email, senha }: { email: string; senha: string }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    await navigator.clipboard.writeText(`E-mail: ${email}\nSenha provisória: ${senha}`);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }
  return (
    <div className={css.credencial}>
      <p className={css.credAviso}>Anote agora: esta senha <strong>não aparece de novo</strong>. Depois só dá para resetar.</p>
      <div className={css.credLinha}><span>E-mail</span><strong>{email}</strong></div>
      <div className={css.credLinha}><span>Senha provisória</span><strong className={css.credSenha}>{senha}</strong></div>
      <button className={css.credCopiar} onClick={copiar}>{copiado ? 'Copiado!' : 'Copiar credenciais'}</button>
      <p className={css.credNota}>No primeiro acesso o funcionário é obrigado a criar a senha dele.</p>
    </div>
  );
}

function ModalAcesso({ empregado, onFechar, onSalvo }: { empregado: Empregado; onFechar: () => void; onSalvo: () => void }) {
  const jaTem = !!empregado.emailAcesso;
  const [email, setEmail] = useState(empregado.emailAcesso ?? '');
  const [criado, setCriado] = useState<{ email: string; senhaProvisoria: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    setErro(null); setEnviando(true);
    try {
      const r = await api.post<{ email: string; senhaProvisoria: string }>(
        `/empregados/${empregado.id}/acesso`, jaTem ? {} : { email: email.trim() });
      setCriado(r);
    } catch (e) { setErro((e as Error).message); }
    finally { setEnviando(false); }
  }

  return (
    <Modal titulo={jaTem ? `Resetar senha de ${empregado.nome.split(' ')[0]}` : `Criar acesso de ${empregado.nome.split(' ')[0]}`} onFechar={criado ? onSalvo : onFechar}>
      {criado ? (
        <>
          <Credencial email={criado.email} senha={criado.senhaProvisoria} />
          <Botao variante="lime" onClick={onSalvo}>Concluir</Botao>
        </>
      ) : (
        <>
          {jaTem
            ? <p className={css.aviso}>Vai gerar uma nova senha provisória para <strong>{empregado.emailAcesso}</strong>. A senha atual deixa de funcionar.</p>
            : <p className={css.aviso}>O funcionário passa a acessar o app pelo celular. Sem isso, ele bate ponto só no quiosque.</p>}
          {!jaTem && <Campo rotulo="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="maria@empresa.com.br" />}
          {erro && <p className={css.erroModal}>{erro}</p>}
          <Botao variante="coral" onClick={enviar} disabled={enviando || (!jaTem && !email.trim())}>
            {enviando ? 'Gerando…' : jaTem ? 'Resetar senha' : 'Criar acesso'}
          </Botao>
        </>
      )}
    </Modal>
  );
}

// Modal que mostra todas as regras de um perfil de forma legível.
// perfil = objeto → perfil específico · null → "CLT padrão" (tudo segue a lei).
function ModalRegras({ perfil, onFechar }: { perfil: PerfilResumo | null; onFechar: () => void }) {
  const c = perfil?.config ?? {};
  const h = (min: number) => Math.round(min / 60 * 10) / 10;

  // Cada regra: rótulo, descrição, e o valor (custom em coral) ou "Segue a CLT (x)".
  const clt = (txt: string) => ({ custom: false as const, texto: `Segue a CLT (${txt})` });
  const val = (txt: string) => ({ custom: true as const, texto: txt });

  const bancoTxt = () => {
    const b = c.banco;
    if (!b || b.bancoModo === 'HERDA') return clt('como a empresa');
    if (b.bancoModo === 'INATIVO') return val('Não usa banco');
    if (b.formaCalculo === 'INTRA_MES') return val(`Compensa no mês e paga a diferença · devendo ${b.negativoMes === 'CARREGA' ? 'passa pro mês seguinte' : 'desconta na folha'}`);
    const acordo = b.bancoTipoAcordo === 'COLETIVO' ? 'Acordo coletivo' : 'Acordo individual';
    return val(`Acumula · ${acordo} · ${b.bancoPrazoMeses}m`);
  };
  const faltaTxt = () => {
    const f = c.destinacao?.destinacaoFaltas;
    if (!f || f === 'DESCONTA') return clt('descontam');
    return val(f === 'BANCO' ? 'Abatem do banco' : 'Abonadas');
  };

  const regras = [
    { nome: 'Horas extras', desc: 'Adicional em dia útil / domingo e feriado',
      r: c.extra ? val(`${c.extra.extraDiaUtilPct}% / ${c.extra.extraDomingoFeriadoPct}%`) : clt('50% / 100%') },
    { nome: 'Tolerância de atraso', desc: 'Minutos perdoados por dia',
      r: c.tolerancia ? val(`${c.tolerancia.toleranciaDiariaMin} min/dia`) : clt('10 min/dia') },
    { nome: 'Adicional noturno', desc: 'A mais nas horas de madrugada',
      r: c.noturno ? val(`${c.noturno.noturnoAdicionalPct}%`) : clt('20%') },
    { nome: 'Tipo de jornada', desc: 'Como o dia de trabalho é contado',
      r: c.contrato?.tipoJornada === 'CONTRATO_HORAS' ? val('Contrato de horas (marcado no perfil, forma antiga)') : { custom: false as const, texto: 'Definido na escala do funcionário' } },
    { nome: 'Jornada semanal', desc: 'Horas normais antes de virar extra',
      r: c.jornada ? val(`${h(c.jornada.jornadaSemanalMin)}h/semana`) : clt('44h') },
    { nome: 'Banco de horas', desc: 'Como as horas extras são tratadas', r: bancoTxt() },
    { nome: 'Faltas não justificadas', desc: 'O que acontece com a falta', r: faltaTxt() },
  ];

  const titulo = perfil ? `⚙ ${perfil.nome}` : 'CLT padrão';
  const sub = perfil
    ? `Regras aplicadas${perfil.usadoPor != null ? ` · usado por ${perfil.usadoPor}` : ''}`
    : 'Este funcionário segue integralmente a CLT.';

  return (
    <Modal titulo={titulo} onFechar={onFechar}>
      <p className={css.regrasSub}>{sub}</p>
      <div className={css.regrasLista}>
        {regras.map((rg) => (
          <div key={rg.nome} className={css.regraItem}>
            <div>
              <div className={css.regraNome}>{rg.nome}</div>
              <div className={css.regraDesc}>{rg.desc}</div>
            </div>
            <div className={rg.r.custom ? css.regraValCustom : css.regraValClt}>{rg.r.texto}</div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

interface RegioesResumo {
  empresa: { uf: string | null; municipioIbge: number | null; municipioNome?: string | null } | null;
  cidades: { municipio: number; nome: string; uf: string; funcionarios: number; prestadores: number }[];
}

/** Cidade de trabalho de uma ou várias pessoas: define os feriados estaduais e municipais delas. */
function ModalCidade({ pessoas, regioes, onFechar, onSalvo }: {
  pessoas: Empregado[]; regioes: RegioesResumo | null; onFechar: () => void; onSalvo: (m: string) => void;
}) {
  const um = pessoas.length === 1 ? pessoas[0]! : null;
  const [usarEmpresa, setUsarEmpresa] = useState(um ? !um.trabalhoMunicipio : false);
  const [cidade, setCidade] = useState<Cidade | null>(um?.trabalhoMunicipio ? { municipio: um.trabalhoMunicipio, municipioNome: um.trabalhoMunicipioNome ?? '', uf: um.trabalhoUf ?? '' } : null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const emp = regioes?.empresa?.municipioIbge ? `${regioes.empresa.municipioNome}-${regioes.empresa.uf}` : null;
  const emUso = (regioes?.cidades ?? []).map((c) => ({ municipio: c.municipio, nome: c.nome, uf: c.uf, pessoas: c.funcionarios + c.prestadores }));
  async function salvar() {
    if (!usarEmpresa && !cidade) { setErro('Escolha a cidade.'); return; }
    setSalvando(true); setErro(null);
    try {
      await api.post('/tratamento/feriados/local-pessoas', { empregadoIds: pessoas.map((p) => p.id), municipio: usarEmpresa ? null : cidade!.municipio, municipioNome: usarEmpresa ? null : cidade!.municipioNome });
      const quem = um ? um.nome : `${pessoas.length} funcionários`;
      onSalvo(usarEmpresa ? `${quem}: usa a cidade da empresa${emp ? ` (${emp})` : ''}.` : `${quem}: cidade de trabalho ${cidade!.municipioNome}-${cidade!.uf}. Os feriados passam a ser os de lá.`);
    } catch (e) { setErro((e as Error).message); setSalvando(false); }
  }
  return (
    <Modal titulo={um ? `Cidade de trabalho · ${um.nome}` : `Cidade de trabalho · ${pessoas.length} funcionários`} onFechar={onFechar}>
      <div className={css.cidadeForm}>
        <p className={css.cidadeDica}>Define os feriados <b>estaduais e municipais</b> que valem para {um ? 'esta pessoa' : 'estas pessoas'}. Use a cidade onde {um ? 'ela trabalha' : 'trabalham'}, não onde mora{um ? '' : 'm'}.</p>
        <label className={`${css.cidadeOpc} ${usarEmpresa ? css.cidadeOpcOn : ''}`}>
          <input type="radio" name="cid" checked={usarEmpresa} onChange={() => setUsarEmpresa(true)} />
          <span><b>Cidade da empresa</b><small>{emp ? emp : 'ainda não definida (Configurações › Feriados)'} · muda junto se a empresa mudar</small></span>
        </label>
        <label className={`${css.cidadeOpc} ${!usarEmpresa ? css.cidadeOpcOn : ''}`}>
          <input type="radio" name="cid" checked={!usarEmpresa} onChange={() => setUsarEmpresa(false)} />
          <span><b>Outra cidade</b><small>quem trabalha fora da cidade da empresa</small></span>
        </label>
        {!usarEmpresa && <SeletorCidade valor={cidade} onChange={setCidade} emUso={emUso} id="cid-func" />}
        {!um && <ul className={css.cidadeQuem}>{pessoas.slice(0, 8).map((p) => <li key={p.id}>{p.nome}</li>)}{pessoas.length > 8 && <li>… e mais {pessoas.length - 8}</li>}</ul>}
        {erro && <p className={css.erro}>{erro}</p>}
        <div className={css.cidadeRod}>
          <Botao variante="ghost" onClick={onFechar}>Cancelar</Botao>
          <Botao variante="coral" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Botao>
        </div>
      </div>
    </Modal>
  );
}
