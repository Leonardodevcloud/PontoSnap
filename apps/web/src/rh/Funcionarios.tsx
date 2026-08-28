import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { soDigitos } from '../lib/download';
import type { Empregado, Horario } from '../tipos';
import { Botao } from '../components/Botao';
import { Campo } from '../components/Campo';
import { Modal } from '../components/Modal';
import css from './Funcionarios.module.css';

const fmtCpf = (c: string) => c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');

interface ConfigRegra {
  extra?: { extraDiaUtilPct: number; extraDomingoFeriadoPct: number; extraLimiteDiarioMin: number } | null;
  tolerancia?: { toleranciaDiariaMin: number; toleranciaPorMarcacaoMin: number } | null;
  noturno?: { noturnoAdicionalPct: number; noturnoReduzida: boolean; noturnoInicioMin: number; noturnoFimMin: number } | null;
  jornada?: { jornadaSemanalMin: number; interjornadaMinimaMin: number; intervaloMaior6hMin: number } | null;
  banco?: { bancoModo: 'HERDA' | 'ATIVO' | 'INATIVO'; bancoTipoAcordo: 'INDIVIDUAL' | 'COLETIVO' | null; bancoPrazoMeses: number | null; formaCalculo: 'BANCO_HORAS' | 'INTRA_MES' } | null;
  destinacao?: { destinacaoFaltas: 'DESCONTA' | 'BANCO' | 'ABONA'; destinacaoAtrasos: 'DESCONTA' | 'BANCO' | 'TOLERA' } | null;
}
interface PerfilResumo { id: string; nome: string; padrao: boolean; config?: ConfigRegra; usadoPor?: number; }

const iniciais = (nome: string) => nome.trim().split(/\s+/).slice(0, 2).map((n) => n[0]?.toUpperCase() ?? '').join('');

export function Funcionarios() {
  const [lista, setLista] = useState<Empregado[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [addAberto, setAddAberto] = useState(false);
  const [importarAberto, setImportarAberto] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [pinPara, setPinPara] = useState<Empregado | null>(null);
  const [escalaPara, setEscalaPara] = useState<Empregado | null>(null);
  const [perfilPara, setPerfilPara] = useState<Empregado | null>(null);
  const [regrasDe, setRegrasDe] = useState<PerfilResumo | null | undefined>(undefined);
  const [perfis, setPerfis] = useState<PerfilResumo[]>([]);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<'TODOS' | 'MONTADAS' | 'PADRAO' | 'INATIVOS'>('TODOS');
  const [salarioPara, setSalarioPara] = useState<Empregado | null>(null);
  const [dataInicioPara, setDataInicioPara] = useState<Empregado | null>(null);
  const [escala12Para, setEscala12Para] = useState<Empregado | null>(null);
  const [acessoPara, setAcessoPara] = useState<Empregado | null>(null);

  async function carregar() {
    try { setLista(await api.get<Empregado[]>('/empregados')); }
    catch (e) { setErro((e as Error).message); }
  }
  useEffect(() => { void carregar(); }, []);
  useEffect(() => {
    api.get<PerfilResumo[]>('/perfis-regra').then(setPerfis).catch(() => {});
  }, [perfilPara]);

  async function alternarAtivo(e: Empregado) {
    setMenu(null);
    await api.patch(`/empregados/${e.id}/ativo`, { ativo: !e.ativo }).catch(() => {});
  }

  const ativos = lista?.filter((e) => e.ativo).length ?? 0;

  const temPerfil = (e: Empregado) => !!e.perfilRegraId;

  const visiveis = lista?.filter((e) => {
    const q = busca.trim().toLowerCase();
    if (q && !`${e.nome} ${e.cpf} ${e.matricula ?? ''}`.toLowerCase().includes(q)) return false;
    if (filtro === 'INATIVOS') return !e.ativo;
    if (!e.ativo) return false;
    if (filtro === 'MONTADAS') return temPerfil(e);
    if (filtro === 'PADRAO') return !temPerfil(e);
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
        {([['TODOS', 'Todos'], ['MONTADAS', 'Com perfil'], ['PADRAO', 'Sem perfil (CLT)'], ['INATIVOS', 'Inativos']] as const).map(([k, rot]) => (
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
                    <button onClick={() => { setPerfilPara(e); setMenu(null); }}>Perfil de regra</button>
                    <button onClick={() => { setSalarioPara(e); setMenu(null); }}>Definir salário</button>
                    <button onClick={() => { setDataInicioPara(e); setMenu(null); }}>Início do ponto</button>
                    <button onClick={() => { setEscala12Para(e); setMenu(null); }}>Gerar escala 12x36</button>
                    <button onClick={() => { void alternarAtivo(e).then(carregar); }}>{e.ativo ? 'Inativar' : 'Reativar'}</button>
                  </div>
                )}
              </span>
            </div>

            <div className={css.perfilLinha}>
              {(() => {
                const p = e.perfilRegraId ? perfis.find((x) => x.id === e.perfilRegraId) : undefined;
                const padrao = perfis.find((x) => x.padrao);
                if (p) return <button type="button" className={css.perfilBadge} onClick={() => setRegrasDe(p)} title="Ver as regras deste perfil">⚙ {p.nome}</button>;
                if (padrao) return <button type="button" className={`${css.perfilBadge} ${css.perfilHerda}`} onClick={() => setRegrasDe(padrao)} title="Ver as regras deste perfil">⚙ {padrao.nome} <span className={css.herdaTxt}>(padrão da empresa)</span></button>;
                return <button type="button" className={`${css.perfilBadge} ${css.perfilHerda}`} onClick={() => setRegrasDe(null)} title="Ver as regras aplicadas">CLT padrão</button>;
              })()}
              <button className={css.editarRegras} onClick={(ev) => { ev.stopPropagation(); setPerfilPara(e); }}>trocar perfil</button>
            </div>
          </div>
        ))}
      </div>

      {addAberto && <ModalAdicionar onFechar={() => setAddAberto(false)} onCriado={() => { setAddAberto(false); void carregar(); }} />}
      {importarAberto && <ModalImportar onFechar={() => setImportarAberto(false)} onImportado={() => void carregar()} />}
      {pinPara && <ModalPin empregado={pinPara} onFechar={() => setPinPara(null)} onSalvo={() => { setPinPara(null); void carregar(); }} />}
      {escalaPara && <ModalEscala empregado={escalaPara} onFechar={() => setEscalaPara(null)} onSalvo={() => { setEscalaPara(null); void carregar(); }} />}
      {perfilPara && <ModalPerfil empregado={perfilPara} perfis={perfis} onFechar={() => setPerfilPara(null)} onSalvo={() => { setPerfilPara(null); void carregar(); }} />}
      {regrasDe !== undefined && <ModalRegras perfil={regrasDe} onFechar={() => setRegrasDe(undefined)} />}
      {salarioPara && <ModalSalario empregado={salarioPara} onFechar={() => setSalarioPara(null)} onSalvo={() => { setSalarioPara(null); void carregar(); }} />}
      {dataInicioPara && <ModalDataInicio empregado={dataInicioPara} onFechar={() => setDataInicioPara(null)} onSalvo={() => { setDataInicioPara(null); void carregar(); }} />}
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
  const [dataInicio, setDataInicio] = useState('');
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
        dataInicioPonto: dataInicio || undefined,
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
      <Campo rotulo="Começa a bater ponto em (opcional)" type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
      <p className={css.aviso}>Se informado, a apuração ignora tudo antes dessa data. Use na migração de sistema ou em quem foi admitido no meio do mês.</p>
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
  const [modo, setModo] = useState<'corrigir' | 'mudar'>('corrigir');
  const [dataInicio, setDataInicio] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    api.get<Horario[]>('/tratamento/horarios')
      .then((l) => { setHorarios(l); if (l[0]) setSel(l[0].id); })
      .catch((e) => setErro((e as Error).message));
  }, []);

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
          <label className={css.selWrap}>
            <span className={css.selLb}>Escala</span>
            <select className={css.select} value={sel} onChange={(e) => setSel(e.target.value)}>
              {horarios.map((h) => <option key={h.id} value={h.id}>{h.codigo}</option>)}
            </select>
          </label>
          <div className={css.modoEscala}>
            <label className={css.radioLinha}>
              <input type="radio" checked={modo === 'corrigir'} onChange={() => setModo('corrigir')} />
              <span><strong>Corrigir cadastro</strong> — a escala estava errada. Vale para toda a apuração.</span>
            </label>
            <label className={css.radioLinha}>
              <input type="radio" checked={modo === 'mudar'} onChange={() => setModo('mudar')} />
              <span><strong>Mudar a partir de uma data</strong> — o funcionário trocou de escala. O passado é preservado.</span>
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
      {erro && <p className={css.erroModal}>{erro}</p>}
      {horarios.length > 0 && (
        <Botao variante="coral" onClick={salvar} disabled={enviando || !sel || (modo === 'mudar' && !dataInicio)}>
          {enviando ? 'Salvando…' : modo === 'mudar' ? 'Mudar escala' : 'Vincular escala'}
        </Botao>
      )}
    </Modal>
  );
}

function ModalPerfil({ empregado, perfis, onFechar, onSalvo }: {
  empregado: Empregado; perfis: PerfilResumo[]; onFechar: () => void; onSalvo: () => void;
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
      {perfis.length === 0 && (
        <p className={css.aviso}>Você ainda não criou perfis. Vá em <strong>Perfis de regra</strong> e crie o primeiro.</p>
      )}
      {erro && <p className={css.erroModal}>{erro}</p>}
      <Botao variante="coral" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar perfil'}</Botao>
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
    const acordo = b.bancoTipoAcordo === 'COLETIVO' ? 'Acordo coletivo' : 'Acordo individual';
    return val(`${acordo} · ${b.bancoPrazoMeses}m`);
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
