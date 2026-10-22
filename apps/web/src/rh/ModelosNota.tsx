import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CAMPOS_MODELO_NOTA, montarDescricaoNota, formatarCodigoServico } from '@ponto/shared';
import { api } from '../lib/api';
import { mascaraDoc } from '../lib/formato';
import { fmtCnpj, type ListaModelos, type ModeloNota } from '../lib/prestador';
import { Modal } from '../components/Modal';
import p from './Prestadores.module.css';
import css from './ModelosNota.module.css';

type Tipo = 'MEI' | 'MOTORISTA';
interface Form {
  nome: string; padraoTipo: Tipo | null;
  tomadorCnpj: string; tomadorRazao: string; tomadorEndereco: string; tomadorTelefone: string; tomadorEmail: string;
  codigoServico: string; codigoDescricao: string; descricao: string; observacao: string;
}
const TPL_MOTORISTA = 'Nota fiscal referente ao serviço prestado de coleta e entrega sob demanda prestado no mês de {mes} ({dias})';
const TPL_MEI = 'Prestação de serviço de {funcao} referente a {periodo}';
const ROT_TIPO: Record<Tipo, { um: string; muitos: string }> = { MEI: { um: 'MEI', muitos: 'MEI' }, MOTORISTA: { um: 'motorista', muitos: 'motoristas' } };

/** Partes da descrição: texto e {campo} (para mostrar os campos como fichas). */
function Fichas({ texto }: { texto: string }) {
  const partes = texto.split(/(\{\w+\})/g).filter(Boolean);
  return <>{partes.map((x, i) => {
    const c = CAMPOS_MODELO_NOTA.find((f) => `{${f.chave}}` === x);
    return c ? <span key={i} className={css.ficha}>{c.rotulo}</span> : <span key={i}>{x}</span>;
  })}</>;
}

/** Semana de exemplo para a prévia: a segunda-feira da semana passada. */
function semanaExemplo() {
  const d = new Date(Date.now() - 3 * 3600_000);
  d.setUTCDate(d.getUTCDate() - 7 - ((d.getUTCDay() + 6) % 7));
  const ini = d.toISOString().slice(0, 10);
  const mais = (n: number) => { const x = new Date(`${ini}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  return { ini, dias: [mais(1), mais(4)], comp: ini.slice(0, 7) };
}

/**
 * Modelos de nota fiscal: o que o prestador coloca na nota, por operação
 * (tomador, código do serviço, descrição com campos automáticos).
 * Configura uma vez; vale em todos os fechamentos.
 */
export function ModelosNota() {
  const [params, setParams] = useSearchParams();
  const editando = params.get('m');
  const [d, setD] = useState<ListaModelos | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [aplicar, setAplicar] = useState<ModeloNota | 'SEM' | null>(null);

  const carregar = useCallback(async () => {
    try { setD(await api.get<ListaModelos>('/portal/rh/modelos-nota')); setErro(null); }
    catch (e) { setErro((e as Error).message); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);
  const avisar = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 5000); };
  const abrir = (id: string | null) => { const q = new URLSearchParams(params); if (id) q.set('m', id); else q.delete('m'); setParams(q); };

  const modelo = editando && editando !== 'novo' ? d?.modelos.find((m) => m.id === editando) ?? null : null;
  if (d && editando && (editando === 'novo' || modelo)) {
    return <Editor key={editando} d={d} modelo={modelo} onVoltar={() => abrir(null)}
      onSalvo={async (m) => { abrir(null); avisar(m); await carregar(); }} />;
  }

  return (
    <div className={p.pagina}>
      <div className={p.cab}>
        <div>
          <Link to="/rh/prestadores" className={css.voltar}>‹ Notas de prestadores</Link>
          <h2>Modelos de nota</h2>
          <p>O que o prestador coloca na nota, por operação. Configure uma vez; vale para todos os fechamentos.</p>
        </div>
        <div className={p.acoes}><button type="button" className={p.btnPri} onClick={() => abrir('novo')}>+ Novo modelo</button></div>
      </div>
      {erro && <p className={p.erro} role="alert">{erro}</p>}
      {msg && <p className={p.okMsg} role="status">{msg}</p>}
      {!d && !erro && <div className={p.vazio}><p>Carregando…</p></div>}

      {d && d.modelos.length === 0 && (
        <div className={p.vazio}>
          <b>Nenhum modelo ainda</b>
          <p>Crie um modelo por operação (ex.: Motoristas sob demanda). O app passa a mostrar ao prestador tudo o que vai na nota, e a conferência compara a nota enviada com o modelo.</p>
          <button type="button" className={p.btnPri} onClick={() => abrir('novo')}>Criar o primeiro modelo</button>
        </div>
      )}

      {d && d.modelos.length > 0 && (
        <div className={css.grade}>
          {d.modelos.map((m) => (
            <article key={m.id} className={css.card}>
              <div className={css.cardTopo}>
                <h3>{m.nome}</h3>
                {m.padraoTipo && <span className={`${p.tag} ${p['t-in']}`}>padrão dos {ROT_TIPO[m.padraoTipo].muitos}</span>}
              </div>
              <dl className={css.dl}>
                <dt>Tomador</dt><dd>{m.tomadorRazao.split(' ').slice(0, 2).join(' ')} · <span className={p.mono}>{fmtCnpj(m.tomadorCnpj)}</span></dd>
                <dt>Código do serviço</dt><dd className={p.mono}>{m.codigoServico ?? '—'}</dd>
                <dt>Descrição</dt><dd className={css.desc}><Fichas texto={m.descricao} /></dd>
                <dt>Usado por</dt><dd><b>{m.usadoPor} {m.usadoPor === 1 ? 'pessoa' : 'pessoas'}</b>{m.padraoTipo && m.escolhidoPor < m.usadoPor ? <small> · {m.usadoPor - m.escolhidoPor} pelo padrão</small> : null}</dd>
              </dl>
              <div className={p.acoes}>
                <button type="button" className={`${p.btnSec} ${p.pequeno}`} onClick={() => abrir(m.id)}>Editar</button>
                <button type="button" className={`${p.btnSec} ${p.pequeno}`} onClick={() => setAplicar(m)}>Aplicar a pessoas</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {d && d.modelos.length > 0 && d.semModelo.length > 0 && (
        <div className={css.aviso} role="status">
          <span><b>{d.semModelo.length} {d.semModelo.length === 1 ? 'prestador sem modelo' : 'prestadores sem modelo'}:</b> o app mostra só nome, CNPJ e valor, e a conferência não confere código nem descrição.
            {' '}<small>({d.semModelo.slice(0, 4).map((x) => x.nome.split(' ')[0]).join(', ')}{d.semModelo.length > 4 ? '…' : ''})</small></span>
          <button type="button" className={p.btnTxt} onClick={() => setAplicar('SEM')}>Escolher modelo</button>
        </div>
      )}
      {d && <p className={p.hint}>O texto da nota é montado na hora de liberar o valor e fica guardado com ela. Mudou o modelo? As notas que ainda não foram enviadas pegam o texto novo ao liberar de novo.</p>}

      {aplicar && d && <ModalAplicar d={d} modelo={aplicar === 'SEM' ? null : aplicar} onFechar={() => setAplicar(null)}
        onAplicado={async (m) => { setAplicar(null); avisar(m); await carregar(); }} />}
    </div>
  );
}

function Editor({ d, modelo, onVoltar, onSalvo }: { d: ListaModelos; modelo: ModeloNota | null; onVoltar: () => void; onSalvo: (m: string) => Promise<void> }) {
  const inicial: Form = modelo ? {
    nome: modelo.nome, padraoTipo: modelo.padraoTipo, tomadorCnpj: fmtCnpj(modelo.tomadorCnpj), tomadorRazao: modelo.tomadorRazao,
    tomadorEndereco: modelo.tomadorEndereco ?? '', tomadorTelefone: modelo.tomadorTelefone ?? '', tomadorEmail: modelo.tomadorEmail ?? '',
    codigoServico: modelo.codigoServico ?? '', codigoDescricao: modelo.codigoDescricao ?? '', descricao: modelo.descricao, observacao: modelo.observacao ?? '',
  } : {
    nome: '', padraoTipo: d.modelos.some((m) => m.padraoTipo === 'MOTORISTA') ? null : 'MOTORISTA',
    tomadorCnpj: fmtCnpj(d.empresa.cnpj), tomadorRazao: d.empresa.razao, tomadorEndereco: '', tomadorTelefone: '', tomadorEmail: '',
    codigoServico: '', codigoDescricao: '', descricao: TPL_MOTORISTA, observacao: '',
  };
  const [f, setF] = useState<Form>(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [excluir, setExcluir] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const [usoTipo, setUsoTipo] = useState<Tipo>(inicial.padraoTipo ?? (modelo ? (d.pessoas.find((x) => x.modeloNotaId === modelo.id)?.tipo ?? 'MOTORISTA') : 'MOTORISTA'));

  const padraoAtual = d.modelos.find((m) => m.padraoTipo === usoTipo && m.id !== modelo?.id) ?? null;
  const ex = useMemo(() => {
    const s = semanaExemplo();
    const pessoa = d.pessoas.find((x) => x.tipo === usoTipo && (!modelo || x.modeloEfetivoId === modelo.id)) ?? d.pessoas.find((x) => x.tipo === usoTipo);
    return { ...s, nome: pessoa?.nome ?? (usoTipo === 'MOTORISTA' ? 'Carlos Souza' : 'Ana Lima'), mot: usoTipo === 'MOTORISTA' };
  }, [d.pessoas, usoTipo, modelo]);
  const previa = montarDescricaoNota(f.descricao, {
    competencia: ex.comp, periodo: ex.mot ? ex.ini : 'MES', dias: ex.mot ? ex.dias : null, nome: ex.nome,
    funcao: usoTipo === 'MOTORISTA' ? 'Motorista' : 'Operador', valorCent: 122976,
  });
  const codigoOk = !f.codigoServico.trim() || !!formatarCodigoServico(f.codigoServico);
  const cnpjOk = f.tomadorCnpj.replace(/\D/g, '').length === 14;

  function inserir(chave: string) {
    const el = ta.current; const t = `{${chave}}`;
    if (!el) { set('descricao', `${f.descricao}${t}`); return; }
    const a = el.selectionStart ?? f.descricao.length, b = el.selectionEnd ?? a;
    const novo = f.descricao.slice(0, a) + t + f.descricao.slice(b);
    set('descricao', novo);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + t.length, a + t.length); });
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!cnpjOk) { setErro('CNPJ do tomador precisa ter 14 dígitos.'); return; }
    if (!codigoOk) { setErro('Código do serviço no formato 26.01.01.'); return; }
    setSalvando(true); setErro(null);
    const corpo = { ...f, codigoServico: f.codigoServico.trim() || null, padraoTipo: f.padraoTipo };
    try {
      if (modelo) await api.put(`/portal/rh/modelos-nota/${modelo.id}`, corpo);
      else await api.post('/portal/rh/modelos-nota', corpo);
      await onSalvo(`Modelo "${f.nome.trim()}" salvo.`);
    } catch (x) { setErro((x as Error).message); setSalvando(false); }
  }
  async function apagar() {
    if (!modelo) return;
    setSalvando(true);
    try { await api.del(`/portal/rh/modelos-nota/${modelo.id}`); await onSalvo(`Modelo "${modelo.nome}" excluído.`); }
    catch (x) { setErro((x as Error).message); setSalvando(false); }
  }

  return (
    <form className={p.pagina} onSubmit={salvar}>
      <div className={p.cab}>
        <div>
          <button type="button" className={css.voltar} onClick={onVoltar}>‹ Modelos de nota</button>
          <h2>{modelo ? modelo.nome : 'Novo modelo de nota'}</h2>
          <p>Modelo de nota{f.padraoTipo ? ` · padrão dos ${ROT_TIPO[f.padraoTipo].muitos}` : ''}</p>
        </div>
      </div>
      {erro && <p className={p.erro} role="alert">{erro}</p>}

      <div className={css.editor}>
        <section className={css.col}>
          <div className={p.campo}><label htmlFor="m-nome">Nome do modelo</label>
            <input id="m-nome" required maxLength={80} value={f.nome} onChange={(e) => set('nome', e.target.value)} placeholder="Ex.: Motoristas sob demanda" /></div>

          <h4 className={css.secao}>Tomador (para quem a nota é emitida)</h4>
          <div className={p.campos}>
            <div className={p.campo}><label htmlFor="m-cnpj">CNPJ</label>
              <input id="m-cnpj" required inputMode="numeric" value={f.tomadorCnpj} aria-invalid={!!f.tomadorCnpj && !cnpjOk}
                onChange={(e) => set('tomadorCnpj', mascaraDoc(e.target.value))} /></div>
            <div className={p.campo}><label htmlFor="m-tel">Telefone</label>
              <input id="m-tel" inputMode="tel" value={f.tomadorTelefone} onChange={(e) => set('tomadorTelefone', e.target.value)} /></div>
            <div className={`${p.campo} ${p.campoInteiro}`}><label htmlFor="m-raz">Razão social</label>
              <input id="m-raz" required value={f.tomadorRazao} onChange={(e) => set('tomadorRazao', e.target.value)} /></div>
            <div className={`${p.campo} ${p.campoInteiro}`}><label htmlFor="m-end">Endereço</label>
              <textarea id="m-end" rows={2} value={f.tomadorEndereco} onChange={(e) => set('tomadorEndereco', e.target.value)} placeholder="Rua, número, bairro, cidade - UF, CEP" /></div>
            <div className={`${p.campo} ${p.campoInteiro}`}><label htmlFor="m-mail">E-mail</label>
              <input id="m-mail" type="email" value={f.tomadorEmail} onChange={(e) => set('tomadorEmail', e.target.value)} /></div>
          </div>

          <h4 className={css.secao}>Serviço</h4>
          <div className={css.codigo}>
            <div className={p.campo}><label htmlFor="m-cod">Código do serviço</label>
              <input id="m-cod" className={p.mono} value={f.codigoServico} placeholder="26.01.01" aria-invalid={!codigoOk} aria-describedby="m-cod-h"
                onChange={(e) => set('codigoServico', e.target.value)} onBlur={() => { const c = formatarCodigoServico(f.codigoServico); if (c) set('codigoServico', c); }} /></div>
            <div className={p.campo}><label htmlFor="m-codd">Descrição do código</label>
              <input id="m-codd" value={f.codigoDescricao} onChange={(e) => set('codigoDescricao', e.target.value)} placeholder="Serviços de coleta, remessa ou entrega…" /></div>
          </div>
          <p id="m-cod-h" className={p.hint}>{codigoOk ? 'CNAE / código de tributação nacional. A conferência verifica se a nota veio com este código.' : 'Use o formato 26.01.01.'}</p>
        </section>

        <section className={css.col}>
          <h4 className={css.secao}>Descrição da nota</h4>
          <div className={p.campo}>
            <label htmlFor="m-desc" className={css.sr}>Descrição da nota</label>
            <textarea id="m-desc" ref={ta} rows={4} required value={f.descricao} onChange={(e) => set('descricao', e.target.value)} />
          </div>
          <div className={css.chips} role="group" aria-label="Inserir campo automático">
            <small>Toque para inserir:</small>
            {CAMPOS_MODELO_NOTA.map((c) => <button key={c.chave} type="button" className={css.ficha} onClick={() => inserir(c.chave)} title={`Ex.: ${c.exemplo}`}>{c.rotulo}</button>)}
          </div>
          {!modelo && f.descricao === TPL_MOTORISTA && usoTipo === 'MEI' && (
            <button type="button" className={p.btnTxt} onClick={() => set('descricao', TPL_MEI)}>Usar o texto sugerido para MEI</button>
          )}
          <div className={css.previa} aria-live="polite">
            <small>Prévia · {ex.nome} · {ex.mot ? `semana ${ex.ini.slice(8, 10)}/${ex.ini.slice(5, 7)}, trabalhou 2 dias` : 'mês inteiro'}</small>
            <p>{previa || '—'}</p>
          </div>
          <div className={p.campo}><label htmlFor="m-obs">Observação para o prestador (opcional)</label>
            <input id="m-obs" maxLength={400} value={f.observacao} onChange={(e) => set('observacao', e.target.value)} placeholder="Ex.: Emita pelo Emissor Nacional e anexe o PDF aqui no app." /></div>

          <h4 className={css.secao}>Quem usa</h4>
          <div className={css.uso} role="radiogroup" aria-label="Quem usa">
            <label className={`${css.opc} ${f.padraoTipo ? css.opcOn : ''}`}>
              <input type="radio" name="uso" checked={!!f.padraoTipo} onChange={() => set('padraoTipo', usoTipo)} />
              <span><b>Padrão de todos os{' '}
                <select value={usoTipo} aria-label="Tipo" onChange={(e) => { const t = e.target.value as Tipo; setUsoTipo(t); if (f.padraoTipo) set('padraoTipo', t); }}>
                  <option value="MOTORISTA">motoristas</option><option value="MEI">MEI</option>
                </select></b>
                <small>Quem já tem outro modelo escolhido continua com o dele.{f.padraoTipo && padraoAtual ? ` Hoje o padrão é "${padraoAtual.nome}": este passa a ser o padrão no lugar dele.` : ''}</small></span>
            </label>
            <label className={`${css.opc} ${!f.padraoTipo ? css.opcOn : ''}`}>
              <input type="radio" name="uso" checked={!f.padraoTipo} onChange={() => set('padraoTipo', null)} />
              <span><b>Só quem eu escolher</b><small>Depois de salvar, use "Aplicar a pessoas".</small></span>
            </label>
          </div>

          <div className={css.conf}>
            <b>Conferência:</b> a nota enviada precisa ter o mesmo valor, o tomador {cnpjOk ? fmtCnpj(f.tomadorCnpj.replace(/\D/g, '')) : '—'}
            {f.codigoServico.trim() && codigoOk ? `, o código ${formatarCodigoServico(f.codigoServico)}` : ''} e uma descrição igual à pedida (descrição diferente só avisa; o RH decide).
          </div>
        </section>
      </div>

      <div className={css.rodape}>
        {modelo && (excluir
          ? <span className={css.confirma}>Excluir "{modelo.nome}"? {modelo.usadoPor ? `${modelo.usadoPor} ${modelo.usadoPor === 1 ? 'pessoa volta' : 'pessoas voltam'} para o padrão do tipo (ou ficam sem modelo).` : ''}
              <button type="button" className={`${p.btnSec} ${p.pequeno} ${p.btnPerigo}`} disabled={salvando} onClick={apagar}>Excluir modelo</button>
              <button type="button" className={p.btnTxt} onClick={() => setExcluir(false)}>Manter</button></span>
          : <button type="button" className={`${p.btnTxt} ${p.btnPerigo}`} onClick={() => setExcluir(true)}>Excluir…</button>)}
        <span style={{ flex: 1 }} />
        <button type="button" className={p.btnSec} onClick={onVoltar}>Cancelar</button>
        <button type="submit" className={p.btnPri} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar modelo'}</button>
      </div>
    </form>
  );
}

function ModalAplicar({ d, modelo, onFechar, onAplicado }: { d: ListaModelos; modelo: ModeloNota | null; onFechar: () => void; onAplicado: (m: string) => Promise<void> }) {
  const [escolhido, setEscolhido] = useState<string>(modelo?.id ?? d.modelos[0]?.id ?? '');
  const [sel, setSel] = useState<Set<string>>(() => new Set(modelo ? d.pessoas.filter((x) => x.modeloNotaId === modelo.id).map((x) => x.id) : d.semModelo.map((x) => x.id)));
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const nomeModelo = (id: string | null) => d.modelos.find((m) => m.id === id)?.nome ?? 'sem modelo';
  const lista = d.pessoas.filter((x) => !busca.trim() || x.nome.toLowerCase().includes(busca.trim().toLowerCase()));
  const mudam = d.pessoas.filter((x) => sel.has(x.id) && x.modeloNotaId !== escolhido);
  // Desmarcou quem tinha escolhido este modelo: volta para o padrão do tipo.
  const saem = d.pessoas.filter((x) => !sel.has(x.id) && x.modeloNotaId === escolhido);
  const total = mudam.length + saem.length;

  async function aplicar() {
    if (!total) { onFechar(); return; }
    setSalvando(true); setErro(null);
    try {
      if (mudam.length) await api.post('/portal/rh/modelos-nota/aplicar', { modeloId: escolhido, prestadorIds: mudam.map((x) => x.id) });
      if (saem.length) await api.post('/portal/rh/modelos-nota/aplicar', { modeloId: null, prestadorIds: saem.map((x) => x.id) });
      await onAplicado(`"${nomeModelo(escolhido)}": ${mudam.length ? `${mudam.length} ${mudam.length === 1 ? 'pessoa entrou' : 'pessoas entraram'}` : ''}${mudam.length && saem.length ? ', ' : ''}${saem.length ? `${saem.length} ${saem.length === 1 ? 'voltou' : 'voltaram'} para o padrão` : ''}. Vale a partir da próxima liberação.`);
    } catch (x) { setErro((x as Error).message); setSalvando(false); }
  }

  return (
    <Modal titulo="Aplicar modelo a pessoas" onFechar={onFechar}>
      <div className={css.modal}>
        <div className={p.campo}><label htmlFor="ap-m">Modelo</label>
          <select id="ap-m" value={escolhido} onChange={(e) => setEscolhido(e.target.value)}>
            {d.modelos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select></div>
        <input type="search" className={css.busca} placeholder="Buscar pessoa" aria-label="Buscar pessoa" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <ul className={css.pessoas}>
          {lista.map((x) => (
            <li key={x.id}>
              <label>
                <input type="checkbox" className={p.chk} checked={sel.has(x.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(x.id)) n.delete(x.id); else n.add(x.id); return n; })} />
                <span><b>{x.nome}</b><small>{x.tipo === 'MEI' ? 'MEI' : 'Motorista'} · hoje: {x.modeloEfetivoId ? `${nomeModelo(x.modeloEfetivoId)}${x.modeloNotaId ? '' : ' (padrão)'}` : 'sem modelo'}</small></span>
              </label>
            </li>
          ))}
          {lista.length === 0 && <li className={p.hint}>Ninguém com esse nome.</li>}
        </ul>
        {erro && <p className={p.erro} role="alert">{erro}</p>}
        <p className={p.hint}>As notas já liberadas e ainda não enviadas pegam o modelo novo quando você liberar de novo.</p>
        <div className={css.rodape}>
          <span style={{ flex: 1 }} />
          <button type="button" className={p.btnSec} onClick={onFechar}>Cancelar</button>
          <button type="button" className={p.btnPri} disabled={salvando || !escolhido || !total} onClick={aplicar}>
            {total ? `Salvar (${total} ${total === 1 ? 'mudança' : 'mudanças'})` : 'Nada a mudar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
