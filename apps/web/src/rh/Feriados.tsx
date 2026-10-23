import { useCallback, useEffect, useMemo, useState } from 'react';
import { feriadoValePara } from '@ponto/shared';
import { api } from '../lib/api';
import { Modal } from '../components/Modal';
import { SeletorCidade, rotuloCidade, type Cidade } from '../components/SeletorCidade';
import css from './Feriados.module.css';

type Tipo = 'nacional' | 'estadual' | 'municipal';
interface FeriadoReg {
  id: string; data: string; nome: string; tipo: Tipo; uf: string | null; municipio: number | null; municipioNome: string | null;
  semRegiao: boolean; atinge: number; atingeFuncionarios: number;
}
interface Pessoa { tipo: 'FUNCIONARIO' | 'PRESTADOR'; id: string; nome: string; proprio: boolean; uf: string | null; municipio: number | null; municipioNome: string | null }
interface Regioes {
  empresa: { uf: string | null; municipioIbge: number | null; municipioNome?: string | null } | null;
  semCidadePropria: { funcionarios: number; prestadores: number }; semLocal: number; total: number;
  cidades: { municipio: number; nome: string; uf: string; funcionarios: number; prestadores: number }[];
  feriados: FeriadoReg[]; pessoas: Pessoa[];
}

const anoAtual = () => new Date().getFullYear();
const fmtDia = (iso: string) => { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; };
const diaSemana = (iso: string) => ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(`${iso}T12:00:00-0300`).getUTCDay()];
const pl = (n: number, um: string, muitos: string) => `${n} ${n === 1 ? um : muitos}`;

function Abrangencia({ f }: { f: Pick<FeriadoReg, 'tipo' | 'uf' | 'municipioNome' | 'semRegiao'> }) {
  if (f.semRegiao) return <span className={`${css.tag} ${css.tSem}`} title="Cadastrado antes das regiões: vale para todos até você definir">sem região · vale p/ todos</span>;
  if (f.tipo === 'estadual') return <span className={`${css.tag} ${css.tEst}`}>Estadual · {f.uf}</span>;
  if (f.tipo === 'municipal') return <span className={`${css.tag} ${css.tMun}`}>Municipal · {f.municipioNome}-{f.uf}</span>;
  return <span className={`${css.tag} ${css.tNac}`}>Nacional</span>;
}

/**
 * Feriados por região: nacional vale para todos; estadual só para quem
 * trabalha no estado; municipal só para quem trabalha na cidade. Quem não tem
 * cidade própria usa a cidade da empresa.
 */
export function Feriados() {
  const [ano, setAno] = useState(anoAtual());
  const [d, setD] = useState<Regioes | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [editando, setEditando] = useState<FeriadoReg | 'NOVO' | null>(null);
  const [trocarCidade, setTrocarCidade] = useState(false);
  const [soSemRegiao, setSoSemRegiao] = useState(false);

  const carregar = useCallback(async () => {
    try { setD(await api.get<Regioes>(`/tratamento/feriados/regioes?ano=${ano}`)); setErro(null); }
    catch (e) { setErro((e as Error).message); }
  }, [ano]);
  useEffect(() => { void carregar(); }, [carregar]);
  const avisar = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 6000); };

  async function remover(f: FeriadoReg) {
    if (!confirm(`Remover o feriado "${f.nome}" (${fmtDia(f.data)})?`)) return;
    try { await api.del(`/tratamento/feriados/${f.id}`); avisar(`"${f.nome}" removido.`); await carregar(); }
    catch (e) { setErro((e as Error).message); }
  }

  const semRegiao = d?.feriados.filter((f) => f.semRegiao) ?? [];
  const lista = (d?.feriados ?? []).filter((f) => !soSemRegiao || f.semRegiao);
  const emp = d?.empresa;
  const emUso = (d?.cidades ?? []).map((c) => ({ municipio: c.municipio, nome: c.nome, uf: c.uf, pessoas: c.funcionarios + c.prestadores }));

  return (
    <div className={css.pagina}>
      <div className={css.head}>
        <div>
          <h2>Feriados</h2>
          <p>Dia de feriado não conta como dia de trabalho, e quem trabalha nele recebe como feriado. Cada feriado vale só para quem trabalha na região dele.</p>
        </div>
        <button type="button" className={css.btnPri} onClick={() => setEditando('NOVO')} disabled={!d}>+ Novo feriado</button>
      </div>

      {erro && <p className={css.erro} role="alert">{erro}</p>}
      {msg && <p className={css.ok} role="status">{msg}</p>}

      {d && (
        <div className={css.empresa}>
          {trocarCidade ? (
            <CidadeEmpresa atual={emp?.municipioIbge ? { municipio: emp.municipioIbge, municipioNome: emp.municipioNome ?? '', uf: emp.uf ?? '' } : null} emUso={emUso}
              onCancelar={() => setTrocarCidade(false)}
              onSalvo={async (c) => { setTrocarCidade(false); avisar(c ? `Cidade da empresa: ${rotuloCidade(c)}.` : 'Cidade da empresa removida.'); await carregar(); }} onErro={setErro} />
          ) : (
            <>
              <span className={css.empTxt}>
                <b>Cidade da empresa:</b> {emp?.municipioIbge ? <>{emp.municipioNome} · {emp.uf}</> : <em className={css.falta}>não definida</em>}
                <small>
                  {emp?.municipioIbge
                    ? ` — vale para ${[d.semCidadePropria.funcionarios ? pl(d.semCidadePropria.funcionarios, 'funcionário', 'funcionários') : '', d.semCidadePropria.prestadores ? pl(d.semCidadePropria.prestadores, 'prestador', 'prestadores') : ''].filter(Boolean).join(' e ') || 'ninguém (todos têm cidade própria)'} sem cidade própria`
                    : ' — sem ela, quem não tem cidade própria só recebe os feriados nacionais.'}
                </small>
              </span>
              <button type="button" className={css.lk} onClick={() => setTrocarCidade(true)}>{emp?.municipioIbge ? 'Trocar' : 'Definir cidade'}</button>
            </>
          )}
        </div>
      )}

      {semRegiao.length > 0 && (
        <div className={css.faixa} role="status">
          <span><b>{pl(semRegiao.length, 'feriado antigo sem região', 'feriados antigos sem região')}:</b> {semRegiao.length === 1 ? 'foi cadastrado' : 'foram cadastrados'} como estadual/municipal antes desta mudança e {semRegiao.length === 1 ? 'vale' : 'valem'} para todo mundo. Defina a região de cada um.</span>
          <button type="button" className={css.lk} onClick={() => setSoSemRegiao((v) => !v)}>{soSemRegiao ? 'Ver todos' : 'Revisar'}</button>
        </div>
      )}

      <div className={css.anoBar}>
        <button type="button" onClick={() => setAno((a) => a - 1)} aria-label="Ano anterior">‹</button>
        <span>{ano}</span>
        <button type="button" onClick={() => setAno((a) => a + 1)} aria-label="Próximo ano">›</button>
      </div>

      <div className={css.table}>
        {d && lista.length === 0 && <div className={css.vazio}>Nenhum feriado cadastrado em {ano}.</div>}
        {d && lista.length > 0 && (
          <table>
            <thead><tr><th>Data</th><th>Feriado</th><th>Abrangência</th><th>Atinge</th><th aria-label="Ações" /></tr></thead>
            <tbody>
              {lista.map((f) => (
                <tr key={f.id} className={f.semRegiao ? css.linhaSem : ''}>
                  <td className={css.mono}>{fmtDia(f.data)} · {diaSemana(f.data)}</td>
                  <td className={css.nome}>{f.nome}</td>
                  <td><Abrangencia f={f} /></td>
                  <td>{f.atinge === d.total ? 'todos' : `${f.atinge} de ${d.total} pessoas`}</td>
                  <td className={css.acoes}>
                    <button type="button" className={css.lk} onClick={() => setEditando(f)}>{f.semRegiao ? 'Definir região' : 'Editar'}</button>
                    <button type="button" className={css.del} onClick={() => remover(f)}>remover</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {d && <p className={css.hint}>A cidade de cada pessoa fica no cadastro do funcionário e do prestador. Em <b>Funcionários</b>, marque várias pessoas e use "Cidade de trabalho" para definir de uma vez. Feriado num mês já fechado só vale depois de reabrir o mês.</p>}

      {editando && d && (
        <EditorFeriado f={editando === 'NOVO' ? null : editando} d={d} emUso={emUso} onFechar={() => setEditando(null)}
          onSalvo={async (m) => { setEditando(null); avisar(m); await carregar(); }} />
      )}
    </div>
  );
}

function CidadeEmpresa({ atual, emUso, onCancelar, onSalvo, onErro }: {
  atual: Cidade | null; emUso: { municipio: number; nome: string; uf: string; pessoas?: number }[];
  onCancelar: () => void; onSalvo: (c: Cidade | null) => Promise<void>; onErro: (m: string | null) => void;
}) {
  const [c, setC] = useState<Cidade | null>(atual);
  const [salvando, setSalvando] = useState(false);
  async function salvar() {
    setSalvando(true); onErro(null);
    try { await api.put('/tratamento/feriados/local-empresa', { municipio: c?.municipio ?? null, municipioNome: c?.municipioNome ?? null }); await onSalvo(c); }
    catch (e) { onErro((e as Error).message); setSalvando(false); }
  }
  return (
    <div className={css.cidadeEdit}>
      <b>Cidade da empresa</b>
      <SeletorCidade valor={c} onChange={setC} emUso={emUso} id="cid-emp" />
      <button type="button" className={css.btnPri} disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar'}</button>
      <button type="button" className={css.lk} onClick={onCancelar}>cancelar</button>
    </div>
  );
}

function EditorFeriado({ f, d, emUso, onFechar, onSalvo }: {
  f: FeriadoReg | null; d: Regioes; emUso: { municipio: number; nome: string; uf: string; pessoas?: number }[];
  onFechar: () => void; onSalvo: (m: string) => Promise<void>;
}) {
  const [data, setData] = useState(f?.data ?? '');
  const [nome, setNome] = useState(f?.nome ?? '');
  const [tipo, setTipo] = useState<Tipo>(f?.tipo ?? 'nacional');
  const [uf, setUf] = useState<string | null>(f?.uf ?? d.empresa?.uf ?? emUso[0]?.uf ?? null);
  const [cidade, setCidade] = useState<Cidade | null>(f?.municipio ? { municipio: f.municipio, municipioNome: f.municipioNome ?? '', uf: f.uf ?? '' } : null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [verQuem, setVerQuem] = useState(false);

  // Quem o feriado atinge, ao vivo (mesma regra da apuração).
  const reg = { tipo, uf: tipo === 'estadual' ? uf : tipo === 'municipal' ? cidade?.uf ?? null : null, municipioIbge: tipo === 'municipal' ? cidade?.municipio ?? null : null };
  const completo = tipo === 'nacional' || (tipo === 'estadual' && !!uf) || (tipo === 'municipal' && !!cidade);
  const atinge = useMemo(() => d.pessoas.filter((p) => feriadoValePara(reg, p.municipio ? { uf: p.uf, municipioIbge: p.municipio } : null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d.pessoas, tipo, uf, cidade]);
  const fora = d.pessoas.filter((p) => !atinge.includes(p));
  const foraPorCidade = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of fora) { const k = p.municipio ? `${p.municipioNome}-${p.uf}` : 'sem cidade'; m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [fora]);
  const fAtinge = atinge.filter((p) => p.tipo === 'FUNCIONARIO').length;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!f && !/^\d{4}-\d{2}-\d{2}$/.test(data)) { setErro('Informe a data.'); return; }
    if (!nome.trim()) { setErro('Informe o nome do feriado.'); return; }
    if (!completo) { setErro(tipo === 'estadual' ? 'Escolha o estado.' : 'Escolha a cidade.'); return; }
    setSalvando(true);
    const corpo = { nome: nome.trim(), tipo, uf: reg.uf, municipio: reg.municipioIbge, municipioNome: tipo === 'municipal' ? cidade?.municipioNome ?? null : null };
    try {
      if (f) await api.patch(`/tratamento/feriados/${f.id}`, corpo);
      else await api.post('/tratamento/feriados', { ...corpo, data });
      await onSalvo(`${nome.trim()} ${f ? 'atualizado' : 'cadastrado'}: atinge ${atinge.length === d.total ? 'todos' : `${atinge.length} de ${d.total} pessoas`}.`);
    } catch (x) { setErro((x as Error).message); setSalvando(false); }
  }

  return (
    <Modal titulo={f ? (f.semRegiao ? `Definir região · ${f.nome}` : `Editar · ${f.nome}`) : 'Novo feriado'} onFechar={onFechar}>
      <form className={css.editor} onSubmit={salvar}>
        <div className={css.duo}>
          <div className={css.campo}><label htmlFor="f-data">Data</label>
            <input id="f-data" type="date" value={data} onChange={(e) => setData(e.target.value)} disabled={!!f} /></div>
          <div className={css.campo}><label htmlFor="f-nome">Nome</label>
            <input id="f-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Independência da Bahia" maxLength={120} /></div>
        </div>
        <fieldset className={css.grupo}>
          <legend>Abrangência</legend>
          <div className={css.tres}>
            {([['nacional', 'Nacional', 'todo mundo'], ['estadual', 'Estadual', 'um estado'], ['municipal', 'Municipal', 'uma cidade']] as [Tipo, string, string][]).map(([v, t, s]) => (
              <label key={v} className={`${css.opc} ${tipo === v ? css.opcOn : ''}`}>
                <input type="radio" name="abr" checked={tipo === v} onChange={() => setTipo(v)} />
                <span><b>{t}</b><small>{s}</small></span>
              </label>
            ))}
          </div>
        </fieldset>
        {tipo === 'estadual' && <div className={css.campo}><label htmlFor="f-uf">Estado</label><SeletorCidade apenasUf ufValor={uf} onUf={setUf} valor={null} onChange={() => undefined} id="f-uf" /></div>}
        {tipo === 'municipal' && (
          <div className={css.campo}><label htmlFor="f-cid">Cidade</label>
            <SeletorCidade valor={cidade} onChange={setCidade} emUso={emUso} id="f-cid" />
            {emUso.length > 0 && <small className={css.dica}>Cidades em uso: {emUso.slice(0, 4).map((c) => `${c.nome} (${c.pessoas})`).join(', ')}{emUso.length > 4 ? '…' : ''}</small>}
          </div>
        )}

        {completo && (
          <div className={css.atinge} aria-live="polite">
            <b>{atinge.length === d.total ? `Atinge todos (${d.total})` : `Atinge ${atinge.length} de ${d.total} pessoas`}</b>
            {atinge.length > 0 && atinge.length < d.total && <> ({pl(fAtinge, 'funcionário', 'funcionários')}{atinge.length - fAtinge ? ` e ${pl(atinge.length - fAtinge, 'prestador', 'prestadores')}` : ''})</>}
            {atinge.length > 0 && <> · <button type="button" className={css.lk} onClick={() => setVerQuem((v) => !v)}>{verQuem ? 'esconder' : 'ver quem'}</button></>}
            {foraPorCidade.length > 0 && <small>Não atinge: {foraPorCidade.map(([k, n]) => `${n} em ${k}`).join(', ')}.</small>}
            {tipo !== 'nacional' && d.semLocal > 0 && <small>{pl(d.semLocal, 'pessoa está', 'pessoas estão')} sem cidade (nem a própria nem a da empresa): {d.semLocal === 1 ? 'só recebe' : 'só recebem'} feriado nacional.</small>}
            {verQuem && <ul className={css.quem}>{atinge.slice(0, 60).map((p) => <li key={p.id}>{p.nome} <small>{p.tipo === 'PRESTADOR' ? 'prestador' : ''} {p.municipio ? rotuloCidade(p) : ''}{p.proprio ? '' : ' (da empresa)'}</small></li>)}{atinge.length > 60 && <li>… e mais {atinge.length - 60}</li>}</ul>}
          </div>
        )}

        {erro && <p className={css.erro} role="alert">{erro}</p>}
        <div className={css.rodape}>
          <button type="button" className={css.btnSec} onClick={onFechar}>Cancelar</button>
          <button type="submit" className={css.btnPri} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar feriado'}</button>
        </div>
      </form>
    </Modal>
  );
}
