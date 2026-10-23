import { useEffect, useMemo, useState } from 'react';
import { ESTADOS, ufDoMunicipio } from '@ponto/shared';
import css from './SeletorCidade.module.css';

export interface Cidade { municipio: number; municipioNome: string; uf: string }
type Base = Record<string, [number, string][]>;
let base: Promise<Base> | null = null;
/** Lista de municípios do IBGE (140 KB): só baixa quando alguém abre a escolha de cidade. */
const carregarBase = () => (base ??= import('@ponto/shared/municipios').then((m) => m.MUNICIPIOS));

/**
 * Estado + cidade (lista do IBGE, sem digitação livre). As cidades que a
 * empresa já usa aparecem primeiro. `apenasUf` = escolher só o estado.
 */
export function SeletorCidade({ valor, onChange, emUso = [], apenasUf, ufValor, onUf, id, rotuloVazio, disabled }: {
  valor: Cidade | null; onChange: (c: Cidade | null) => void;
  /** Cidades já usadas (aparecem no topo). */
  emUso?: { municipio: number; nome: string; uf: string; pessoas?: number }[];
  apenasUf?: boolean; ufValor?: string | null; onUf?: (uf: string | null) => void;
  id?: string; rotuloVazio?: string; disabled?: boolean;
}) {
  const [uf, setUf] = useState<string>(apenasUf ? ufValor ?? '' : valor?.uf ?? ufDoMunicipio(valor?.municipio ?? null) ?? emUso[0]?.uf ?? '');
  const [lista, setLista] = useState<[number, string][] | null>(null);
  useEffect(() => { if (apenasUf) setUf(ufValor ?? ''); }, [apenasUf, ufValor]);
  useEffect(() => {
    if (apenasUf || !uf) { setLista(null); return; }
    let vivo = true;
    void carregarBase().then((b) => { if (vivo) setLista(b[uf] ?? []); });
    return () => { vivo = false; };
  }, [uf, apenasUf]);
  const usoDaUf = useMemo(() => emUso.filter((c) => c.uf === uf), [emUso, uf]);

  return (
    <div className={`${css.seletor} ${apenasUf ? css.so : ''}`}>
      <select id={id ? `${id}-uf` : undefined} aria-label="Estado" value={uf} disabled={disabled}
        onChange={(e) => {
          const novo = e.target.value;
          setUf(novo);
          if (apenasUf) onUf?.(novo || null);
          else if (valor && valor.uf !== novo) onChange(null);
        }}>
        <option value="">{apenasUf ? 'Estado…' : 'UF'}</option>
        {ESTADOS.map((e) => <option key={e.uf} value={e.uf}>{apenasUf ? `${e.uf} — ${e.nome}` : e.uf}</option>)}
      </select>
      {!apenasUf && (
        <select id={id} aria-label="Cidade" value={valor?.municipio ?? ''} disabled={disabled || !uf || !lista}
          onChange={(e) => {
            const cod = Number(e.target.value);
            if (!cod) { onChange(null); return; }
            const nome = lista?.find(([c]) => c === cod)?.[1] ?? usoDaUf.find((c) => c.municipio === cod)?.nome ?? '';
            onChange({ municipio: cod, municipioNome: nome, uf });
          }}>
          <option value="">{!uf ? 'Escolha o estado' : !lista ? 'Carregando cidades…' : rotuloVazio ?? 'Cidade…'}</option>
          {usoDaUf.length > 0 && (
            <optgroup label="Em uso na empresa">
              {usoDaUf.map((c) => <option key={`u${c.municipio}`} value={c.municipio}>{c.nome}{c.pessoas != null ? ` (${c.pessoas})` : ''}</option>)}
            </optgroup>
          )}
          {lista && (
            <optgroup label={`Todas de ${uf}`}>
              {lista.filter(([c]) => !usoDaUf.some((u) => u.municipio === c)).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </optgroup>
          )}
        </select>
      )}
    </div>
  );
}

/** "Salvador-BA" */
export const rotuloCidade = (c: { municipioNome?: string | null; nome?: string | null; uf?: string | null } | null | undefined) =>
  c ? `${c.municipioNome ?? c.nome ?? ''}${c.uf ? `-${c.uf}` : ''}` : '';
