import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { soDigitos } from '../lib/download';
import type { Empregado, Horario, Convencao } from '../tipos';
import { Botao } from '../components/Botao';
import { Campo } from '../components/Campo';
import { Modal } from '../components/Modal';
import css from './Funcionarios.module.css';

const fmtCpf = (c: string) => c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');

type TipoItem = 'EXTRA' | 'TOLERANCIA' | 'NOTURNO' | 'JORNADA' | 'BANCO' | 'DESTINACAO';
interface ItemRegra { id: string; tipo: TipoItem; nome: string; config: Record<string, unknown>; padrao: boolean; }

const PECAS: { tipo: TipoItem; campo: keyof Empregado; lb: string }[] = [
  { tipo: 'EXTRA', campo: 'regraExtraId', lb: 'extra' },
  { tipo: 'TOLERANCIA', campo: 'regraToleranciaId', lb: 'tolerância' },
  { tipo: 'NOTURNO', campo: 'regraNoturnoId', lb: 'noturno' },
  { tipo: 'JORNADA', campo: 'regraJornadaId', lb: 'jornada' },
  { tipo: 'BANCO', campo: 'regraBancoId', lb: 'banco' },
  { tipo: 'DESTINACAO', campo: 'regraDestinacaoId', lb: 'destinação' },
];

/** Valor curto da peça, pra caber no chip. */
function valorPeca(tipo: TipoItem, c: Record<string, unknown>): string {
  const n = (k: string) => Number(c[k]);
  switch (tipo) {
    case 'EXTRA': return `${n('extraDiaUtilPct')}% útil`;
    case 'TOLERANCIA': return `${n('toleranciaDiariaMin')}/${n('toleranciaPorMarcacaoMin')} min`;
    case 'NOTURNO': return `${n('noturnoAdicionalPct')}%`;
    case 'JORNADA': return `${Math.round(n('jornadaSemanalMin') / 60)}h semana`;
    case 'BANCO': return c.bancoModo === 'ATIVO' ? `${c.bancoTipoAcordo === 'COLETIVO' ? 'Coletivo' : 'Individual'} ${n('bancoPrazoMeses')}m`
      : c.bancoModo === 'INATIVO' ? 'sem banco' : 'herda empresa';
    case 'DESTINACAO': return `falta ${String(c.destinacaoFaltas ?? '').toLowerCase()}`;
  }
}

/** O que está VALENDO na peça: escolha do funcionário → padrão do item → CLT. */
function pecaEfetiva(e: Empregado, p: { tipo: TipoItem; campo: keyof Empregado }, itens: ItemRegra[]): { texto: string; propria: boolean } {
  const id = e[p.campo] as string | null | undefined;
  const escolhido = id ? itens.find((i) => i.id === id) : undefined;
  if (escolhido) return { texto: valorPeca(p.tipo, escolhido.config), propria: true };
  const padrao = itens.find((i) => i.tipo === p.tipo && i.padrao);
  if (padrao) return { texto: valorPeca(p.tipo, padrao.config), propria: false };
  return { texto: p.tipo === 'BANCO' ? 'herda empresa' : 'CLT padrão', propria: false };
}

const iniciais = (nome: string) => nome.trim().split(/\s+/).slice(0, 2).map((n) => n[0]?.toUpperCase() ?? '').join('');

export function Funcionarios() {
  const [lista, setLista] = useState<Empregado[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [addAberto, setAddAberto] = useState(false);
  const [importarAberto, setImportarAberto] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [pinPara, setPinPara] = useState<Empregado | null>(null);
  const [escalaPara, setEscalaPara] = useState<Empregado | null>(null);
  const [convencaoPara, setConvencaoPara] = useState<Empregado | null>(null);
  const [convDocPara, setConvDocPara] = useState<Empregado | null>(null);
  const [convMap, setConvMap] = useState<Record<string, string>>({});
  const [itens, setItens] = useState<ItemRegra[]>([]);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<'TODOS' | 'MONTADAS' | 'PADRAO' | 'INATIVOS'>('TODOS');
  const [salarioPara, setSalarioPara] = useState<Empregado | null>(null);
  const [escala12Para, setEscala12Para] = useState<Empregado | null>(null);
  const [acessoPara, setAcessoPara] = useState<Empregado | null>(null);

  async function carregar() {
    try { setLista(await api.get<Empregado[]>('/empregados')); }
    catch (e) { setErro((e as Error).message); }
  }
  useEffect(() => { void carregar(); }, []);
  useEffect(() => {
    api.get<{ id: string; nome: string }[]>('/convencoes').then((cs) => setConvMap(Object.fromEntries(cs.map((c) => [c.id, c.nome])))).catch(() => {});
    api.get<ItemRegra[]>('/regra-itens').then(setItens).catch(() => {});
  }, [convencaoPara, convDocPara]);

  async function alternarAtivo(e: Empregado) {
    setMenu(null);
    await api.patch(`/empregados/${e.id}/ativo`, { ativo: !e.ativo }).catch(() => {});
  }

  const ativos = lista?.filter((e) => e.ativo).length ?? 0;

  const temAlgumaPeca = (e: Empregado) =>
    PECAS.some((p) => !!e[p.campo]) || !!e.convencaoId;

  const visiveis = lista?.filter((e) => {
    const q = busca.trim().toLowerCase();
    if (q && !`${e.nome} ${e.cpf} ${e.matricula ?? ''}`.toLowerCase().includes(q)) return false;
    if (filtro === 'INATIVOS') return !e.ativo;
    if (!e.ativo) return false;
    if (filtro === 'MONTADAS') return temAlgumaPeca(e);
    if (filtro === 'PADRAO') return !temAlgumaPeca(e);
    return true;
  });

  return (
    <div onClick={() => setMenu(null)}>
      <div className={css.head}>
        <div><h2>Funcionários</h2><p>{lista ? `${ativos} ativos · quem bate ponto na Cliente A` : 'carregando…'}</p></div>
        <div className={css.topoAcoes}>
          <Botao variante="ghost" className={css.add} onClick={() => setImportarAberto(true)}>Importar planilha</Botao>
          <Botao variante="coral" className={css.add} onClick={() => setAddAberto(true)}>+ Adicionar funcionário</Botao>
        </div>
      </div>

      {erro && <p className={css.erro}>{erro}</p>}

      <div className={css.filtros}>
        <input className={css.busca} placeholder="Buscar por nome, CPF ou matrícula…" value={busca} onChange={(ev) => setBusca(ev.target.value)} />
        {([['TODOS', 'Todos'], ['MONTADAS', 'Regras montadas'], ['PADRAO', 'Só CLT padrão'], ['INATIVOS', 'Inativos']] as const).map(([k, rot]) => (
          <button key={k} className={`${css.chipF} ${filtro === k ? css.chipFOn : ''}`} onClick={() => setFiltro(k)}>{rot}</button>
        ))}
      </div>

      <div className={css.cards}>
        {visiveis?.length === 0 && <div className={css.vazio}>{lista?.length === 0 ? 'Ninguém cadastrado ainda. Adiciona o primeiro funcionário.' : 'Nenhum funcionário com esse filtro.'}</div>}
        {visiveis?.map((e) => (
          <div key={e.id} className={css.card}>
            <div className={css.linha1}>
              <span className={css.avatar}>{iniciais(e.nome)}</span>
              <span className={css.quem}>
                <span className={css.nomeC}>{e.nome}</span>
                <span className={css.metaC}>mat. {e.matricula ?? '—'} · {fmtCpf(e.cpf)} · {e.horarioContratualId ? 'horário vinculado' : 'sem horário'}</span>
              </span>
              <span className={`${css.status} ${e.ativo ? css.ativo : css.inativo}`}><span className={css.sdot} />{e.ativo ? 'Ativo' : 'Inativo'}</span>
              <span className={css.pinC}>{e.temPin ? 'PIN ✓' : 'sem PIN'}</span>
              <span className={css.kebabWrap} onClick={(ev) => { ev.stopPropagation(); setMenu(menu === e.id ? null : e.id); }}>
                <button className={css.kebab} aria-label="Ações">⋯</button>
                {menu === e.id && (
                  <div className={css.menu} onClick={(ev) => ev.stopPropagation()}>
                    <button onClick={() => { setPinPara(e); setMenu(null); }}>Definir PIN</button>
                    <button onClick={() => { setAcessoPara(e); setMenu(null); }}>{e.emailAcesso ? 'Resetar senha do app' : 'Criar acesso ao app'}</button>
                    <button onClick={() => { setEscalaPara(e); setMenu(null); }}>Definir escala</button>
                    <button onClick={() => { setConvencaoPara(e); setMenu(null); }}>Definir regra</button>
                    <button onClick={() => { setConvDocPara(e); setMenu(null); }}>Definir convenção</button>
                    <button onClick={() => { setSalarioPara(e); setMenu(null); }}>Definir salário</button>
                    <button onClick={() => { setEscala12Para(e); setMenu(null); }}>Gerar escala 12x36</button>
                    <button onClick={() => { void alternarAtivo(e).then(carregar); }}>{e.ativo ? 'Inativar' : 'Reativar'}</button>
                  </div>
                )}
              </span>
            </div>

            <div className={css.pecas}>
              {e.convencaoId
                ? <span className={css.conv}>📄 {convMap[e.convencaoId] ?? 'Convenção'}</span>
                : <span className={`${css.conv} ${css.semConv}`}>sem convenção</span>}
              {PECAS.map((p) => {
                const v = pecaEfetiva(e, p, itens);
                return (
                  <span key={p.tipo} className={`${css.peca} ${v.propria ? '' : css.pecaCLT}`}>
                    <span className={css.pLb}>{p.lb}</span><span className={css.pVal}>{v.texto}</span>
                  </span>
                );
              })}
              <button className={css.editarRegras} onClick={(ev) => { ev.stopPropagation(); setConvencaoPara(e); }}>editar regras</button>
            </div>
          </div>
        ))}
      </div>

      {addAberto && <ModalAdicionar onFechar={() => setAddAberto(false)} onCriado={() => { setAddAberto(false); void carregar(); }} />}
      {importarAberto && <ModalImportar onFechar={() => setImportarAberto(false)} onImportado={() => void carregar()} />}
      {pinPara && <ModalPin empregado={pinPara} onFechar={() => setPinPara(null)} onSalvo={() => { setPinPara(null); void carregar(); }} />}
      {escalaPara && <ModalEscala empregado={escalaPara} onFechar={() => setEscalaPara(null)} onSalvo={() => { setEscalaPara(null); void carregar(); }} />}
      {convencaoPara && <ModalConvencao empregado={convencaoPara} onFechar={() => setConvencaoPara(null)} onSalvo={() => { setConvencaoPara(null); void carregar(); }} />}
      {convDocPara && <ModalConvencaoDoc empregado={convDocPara} onFechar={() => setConvDocPara(null)} onSalvo={() => { setConvDocPara(null); void carregar(); }} />}
      {salarioPara && <ModalSalario empregado={salarioPara} onFechar={() => setSalarioPara(null)} onSalvo={() => { setSalarioPara(null); void carregar(); }} />}
      {escala12Para && <ModalEscala12x36 empregado={escala12Para} onFechar={() => setEscala12Para(null)} onSalvo={() => setEscala12Para(null)} />}
      {acessoPara && <ModalAcesso empregado={acessoPara} onFechar={() => setAcessoPara(null)} onSalvo={() => { setAcessoPara(null); void carregar(); }} />}
    </div>
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

function ModalAdicionar({ onFechar, onCriado }: { onFechar: () => void; onCriado: () => void }) {
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [matricula, setMatricula] = useState('');
  const [pin, setPin] = useState('');
  const [salario, setSalario] = useState('');
  const [email, setEmail] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [acessoCriado, setAcessoCriado] = useState<{ email: string; senhaProvisoria: string } | null>(null);

  async function salvar() {
    setErro(null); setEnviando(true);
    try {
      const sal = salario ? Number(salario.replace(',', '.')) : undefined;
      const r = await api.post<{ acesso?: { email: string; senhaProvisoria: string } }>('/empregados', {
        nome: nome.trim(), cpf: soDigitos(cpf),
        matricula: matricula.trim() || undefined,
        pin: pin.trim() || undefined,
        salarioMensal: sal,
        email: email.trim() || undefined,
      });
      if (r.acesso) { setAcessoCriado(r.acesso); return; }
      onCriado();
    } catch (e) { setErro((e as Error).message); setEnviando(false); }
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
    <Modal titulo="Adicionar funcionário" onFechar={onFechar}>
      <Campo rotulo="Nome completo" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Maria Silva" />
      <Campo rotulo="CPF" inputMode="numeric" value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" />
      <Campo rotulo="Matrícula (opcional)" value={matricula} onChange={(e) => setMatricula(e.target.value)} placeholder="001" />
      <Campo rotulo="PIN do quiosque (opcional)" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="4 a 8 dígitos" />
      <Campo rotulo="Salário mensal (opcional)" inputMode="decimal" value={salario} onChange={(e) => setSalario(e.target.value)} placeholder="Ex.: 2200.00" />
      <Campo rotulo="E-mail para acesso ao app (opcional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="maria@empresa.com.br" />
      <p className={css.aviso}>Com e-mail, ele recebe login no app. Sem e-mail, bate ponto só no quiosque (matrícula + PIN).</p>
      {erro && <p className={css.erro}>{erro}</p>}
      <Botao variante="coral" onClick={salvar} disabled={enviando || !nome || cpf.length < 11}>
        {enviando ? 'Salvando…' : 'Adicionar'}
      </Botao>
    </Modal>
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

  useEffect(() => {
    api.get<Horario[]>('/tratamento/horarios')
      .then((l) => { setHorarios(l); if (l[0]) setSel(l[0].id); })
      .catch((e) => setErro((e as Error).message));
  }, []);

  async function salvar() {
    setErro(null); setEnviando(true);
    try {
      await api.patch(`/empregados/${empregado.id}/horario`, { horarioContratualId: sel });
      onSalvo();
    } catch (e) { setErro((e as Error).message); setEnviando(false); }
  }

  return (
    <Modal titulo={`Escala de ${empregado.nome.split(' ')[0]}`} onFechar={onFechar}>
      {horarios.length === 0 ? (
        <p className={css.aviso}>Nenhuma escala cadastrada ainda. Crie uma em <strong>Escalas</strong> primeiro.</p>
      ) : (
        <label className={css.selWrap}>
          <span className={css.selLb}>Escala</span>
          <select className={css.select} value={sel} onChange={(e) => setSel(e.target.value)}>
            {horarios.map((h) => <option key={h.id} value={h.id}>{h.codigo}</option>)}
          </select>
        </label>
      )}
      {erro && <p className={css.erroModal}>{erro}</p>}
      {horarios.length > 0 && (
        <Botao variante="coral" onClick={salvar} disabled={enviando || !sel}>{enviando ? 'Salvando…' : 'Vincular escala'}</Botao>
      )}
    </Modal>
  );
}

function ModalConvencao({ empregado, onFechar, onSalvo }: { empregado: Empregado; onFechar: () => void; onSalvo: () => void }) {
  type Tipo = 'EXTRA' | 'TOLERANCIA' | 'NOTURNO' | 'JORNADA' | 'BANCO' | 'DESTINACAO';
  const TIPOS: { tipo: Tipo; campo: keyof Empregado; rotulo: string }[] = [
    { tipo: 'EXTRA', campo: 'regraExtraId', rotulo: 'Hora extra' },
    { tipo: 'TOLERANCIA', campo: 'regraToleranciaId', rotulo: 'Tolerância' },
    { tipo: 'NOTURNO', campo: 'regraNoturnoId', rotulo: 'Adicional noturno' },
    { tipo: 'JORNADA', campo: 'regraJornadaId', rotulo: 'Jornada' },
    { tipo: 'BANCO', campo: 'regraBancoId', rotulo: 'Banco de horas' },
    { tipo: 'DESTINACAO', campo: 'regraDestinacaoId', rotulo: 'Destinação' },
  ];
  const [opcoes, setOpcoes] = useState<Record<string, { id: string; nome: string }[]>>({});
  const [sel, setSel] = useState<Record<string, string>>(() => {
    const s: Record<string, string> = {};
    for (const t of TIPOS) s[t.tipo] = (empregado[t.campo] as string) ?? '';
    return s;
  });
  const [convs, setConvs] = useState<{ id: string; nome: string }[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api.get<{ id: string; tipo: Tipo; nome: string }[]>('/regra-itens').then((itens) => {
      const por: Record<string, { id: string; nome: string }[]> = {};
      for (const i of itens) (por[i.tipo] ??= []).push({ id: i.id, nome: i.nome });
      setOpcoes(por);
    }).catch((e) => setErro((e as Error).message));
    api.get<{ id: string; nome: string }[]>('/convencoes').then(setConvs).catch(() => {});
  }, []);

  async function salvar() {
    setErro(null); setEnviando(true);
    try {
      await api.patch(`/empregados/${empregado.id}/regras`, {
        regraExtraId: sel.EXTRA || null, regraToleranciaId: sel.TOLERANCIA || null, regraNoturnoId: sel.NOTURNO || null,
        regraJornadaId: sel.JORNADA || null, regraBancoId: sel.BANCO || null, regraDestinacaoId: sel.DESTINACAO || null,
      });
      onSalvo();
    } catch (e) { setErro((e as Error).message); setEnviando(false); }
  }

  async function aplicarConvencao(convId: string) {
    if (!convId) return;
    setErro(null); setEnviando(true);
    try {
      await api.post(`/empregados/${empregado.id}/aplicar-convencao`, { convencaoId: convId });
      onSalvo();
    } catch (e) { setErro((e as Error).message); setEnviando(false); }
  }

  return (
    <Modal titulo={`Regras de ${empregado.nome.split(' ')[0]}`} onFechar={onFechar}>
      {convs.length > 0 && (
        <label className={css.selWrap}>
          <span className={css.selLb}>Atalho: aplicar as peças de uma convenção</span>
          <select className={css.select} defaultValue="" onChange={(e) => aplicarConvencao(e.target.value)}>
            <option value="">— escolher convenção —</option>
            {convs.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </label>
      )}
      {TIPOS.map((t) => (
        <label key={t.tipo} className={css.selWrap}>
          <span className={css.selLb}>{t.rotulo}</span>
          <select className={css.select} value={sel[t.tipo]} onChange={(e) => setSel((s) => ({ ...s, [t.tipo]: e.target.value }))}>
            <option value="">Padrão CLT</option>
            {(opcoes[t.tipo] ?? []).map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
          </select>
        </label>
      ))}
      {erro && <p className={css.erroModal}>{erro}</p>}
      <Botao variante="coral" onClick={salvar} disabled={enviando}>{enviando ? 'Salvando…' : 'Salvar regras'}</Botao>
    </Modal>
  );
}

function ModalConvencaoDoc({ empregado, onFechar, onSalvo }: { empregado: Empregado; onFechar: () => void; onSalvo: () => void }) {
  const [convs, setConvs] = useState<Convencao[]>([]);
  const [sel, setSel] = useState(empregado.convencaoId ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api.get<Convencao[]>('/convencoes')
      .then(setConvs)
      .catch((e) => setErro((e as Error).message));
  }, []);

  async function salvar() {
    setErro(null); setEnviando(true);
    try {
      await api.patch(`/empregados/${empregado.id}/convencao`, { convencaoId: sel || null });
      onSalvo();
    } catch (e) { setErro((e as Error).message); setEnviando(false); }
  }

  return (
    <Modal titulo={`Convenção de ${empregado.nome.split(' ')[0]}`} onFechar={onFechar}>
      <label className={css.selWrap}>
        <span className={css.selLb}>Convenção (documento CCT/ACT)</span>
        <select className={css.select} value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="">Nenhuma</option>
          {convs.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.uf ? ` · ${c.uf}` : ''}</option>)}
        </select>
      </label>
      {convs.length === 0 && <p className={css.aviso}>Nenhuma convenção cadastrada. Crie em <strong>Convenções</strong> primeiro.</p>}
      {erro && <p className={css.erroModal}>{erro}</p>}
      <Botao variante="coral" onClick={salvar} disabled={enviando}>{enviando ? 'Salvando…' : 'Vincular convenção'}</Botao>
    </Modal>
  );
}

function ModalSalario({ empregado, onFechar, onSalvo }: { empregado: Empregado; onFechar: () => void; onSalvo: () => void }) {
  const [salario, setSalario] = useState(empregado.salarioMensal ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function salvar() {
    setErro(null); setEnviando(true);
    try {
      await api.patch(`/empregados/${empregado.id}/salario`, { salarioMensal: Number(String(salario).replace(',', '.')) });
      onSalvo();
    } catch (e) { setErro((e as Error).message); setEnviando(false); }
  }

  return (
    <Modal titulo={`Salário de ${empregado.nome.split(' ')[0]}`} onFechar={onFechar}>
      <Campo rotulo="Salário mensal" inputMode="decimal" value={String(salario)} onChange={(e) => setSalario(e.target.value)} placeholder="Ex.: 2200.00" />
      <p className={css.aviso}>Usado para calcular extras, adicional noturno e descontos em R$ (divisor 220h).</p>
      {erro && <p className={css.erroModal}>{erro}</p>}
      <Botao variante="coral" onClick={salvar} disabled={enviando || !salario}>{enviando ? 'Salvando…' : 'Salvar salário'}</Botao>
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
        <input className={css.select} type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
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
