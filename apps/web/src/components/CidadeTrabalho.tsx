import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { SeletorCidade, type Cidade } from './SeletorCidade';
import css from './CidadeTrabalho.module.css';

interface Regioes { empresa: { uf: string | null; municipioIbge: number | null; municipioNome?: string | null } | null; cidades: { municipio: number; nome: string; uf: string; funcionarios: number; prestadores: number }[] }
let cache: Promise<Regioes> | null = null;

/**
 * Cidade de trabalho de um funcionário ou prestador: define os feriados
 * estaduais e municipais que valem para ele. Vazio = a cidade da empresa.
 */
export function CidadeTrabalho({ tipo, id, atual, onSalvo, disabled }: {
  tipo: 'EMPREGADO' | 'PRESTADOR'; id: string;
  atual: { uf: string | null; municipio: number; municipioNome: string | null } | null | undefined;
  onSalvo?: (m: string) => void; disabled?: boolean;
}) {
  const [r, setR] = useState<Regioes | null>(null);
  const [editando, setEditando] = useState(false);
  const [usarEmpresa, setUsarEmpresa] = useState(!atual);
  const [cidade, setCidade] = useState<Cidade | null>(atual ? { municipio: atual.municipio, municipioNome: atual.municipioNome ?? '', uf: atual.uf ?? '' } : null);
  const [salvo, setSalvo] = useState(atual ?? null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    cache ??= api.get<Regioes>(`/tratamento/feriados/regioes?ano=${new Date().getFullYear()}`);
    cache.then(setR).catch(() => { cache = null; });
  }, []);
  const emp = r?.empresa?.municipioIbge ? `${r.empresa.municipioNome}-${r.empresa.uf}` : null;

  async function salvar() {
    if (!usarEmpresa && !cidade) { setErro('Escolha a cidade.'); return; }
    setSalvando(true); setErro(null);
    try {
      await api.post('/tratamento/feriados/local-pessoas', {
        [tipo === 'EMPREGADO' ? 'empregadoIds' : 'prestadorIds']: [id],
        municipio: usarEmpresa ? null : cidade!.municipio, municipioNome: usarEmpresa ? null : cidade!.municipioNome,
      });
      cache = null;
      const novo = usarEmpresa ? null : { uf: cidade!.uf, municipio: cidade!.municipio, municipioNome: cidade!.municipioNome };
      setSalvo(novo); setEditando(false);
      onSalvo?.(usarEmpresa ? 'Usa a cidade da empresa para os feriados.' : `Cidade de trabalho: ${cidade!.municipioNome}-${cidade!.uf}.`);
    } catch (e) { setErro((e as Error).message); } finally { setSalvando(false); }
  }

  return (
    <div className={css.bloco}>
      <div className={css.topo}>
        <span><b>Cidade de trabalho</b><small>define os feriados estaduais e municipais</small></span>
        {!editando && <span className={css.valor}>📍 {salvo ? `${salvo.municipioNome}-${salvo.uf}` : emp ? <>{emp} <em>(da empresa)</em></> : <em>sem cidade · só feriado nacional</em>}</span>}
        {!editando && !disabled && <button type="button" className={css.lk} onClick={() => setEditando(true)}>Trocar</button>}
      </div>
      {editando && (
        <div className={css.form}>
          <label className={css.opc}><input type="radio" checked={usarEmpresa} onChange={() => setUsarEmpresa(true)} /> Cidade da empresa{emp ? ` (${emp})` : ''}</label>
          <label className={css.opc}><input type="radio" checked={!usarEmpresa} onChange={() => setUsarEmpresa(false)} /> Outra cidade</label>
          {!usarEmpresa && <SeletorCidade valor={cidade} onChange={setCidade} id={`cid-${id}`}
            emUso={(r?.cidades ?? []).map((c) => ({ municipio: c.municipio, nome: c.nome, uf: c.uf, pessoas: c.funcionarios + c.prestadores }))} />}
          {erro && <p className={css.erro}>{erro}</p>}
          <div className={css.acoes}>
            <button type="button" className={css.lk} onClick={() => { setEditando(false); setErro(null); }}>cancelar</button>
            <button type="button" className={css.btn} disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar cidade'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
