import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { brl, diaMes } from '../lib/prestador';
import { alternarDia, corpoDias, datasIniciais, diasPrevistos, listaDatas, quantidade } from '../lib/diasMotorista';
import type { PessoalCompetencia, PessoalLinhaMot, PessoalSemanaMot } from '../tipos';
import { Modal } from '../components/Modal';
import { DiasChips } from './DiasChips';
import { Rosto } from './Prestadores';
import css from './Prestadores.module.css';
import a from './AjustarSemana.module.css';

type Linha = { m: PessoalLinhaMot; s: PessoalSemanaMot; travada: string | null };

/**
 * Ajustar os dias de UMA semana, para todos os motoristas dela, sem sair de
 * Prestadores. Cada um já vem com os dias previstos marcados; desmarque o dia
 * que ele não rodou. Salvar grava só quem mudou.
 */
export function AjustarSemana({ mes, inicio, fim, foco, onFechar, onSalvo }: {
  mes: string; inicio: string; fim: string; foco?: string | null; onFechar: () => void; onSalvo: (msg: string) => Promise<void>;
}) {
  const [comp, setComp] = useState<PessoalCompetencia | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ed, setEd] = useState<Record<string, string[] | null>>({});
  const [salvando, setSalvando] = useState(false);
  const [sair, setSair] = useState(false);
  const focoRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    api.get<PessoalCompetencia>(`/pessoal/competencia?comp=${mes}`).then(setComp).catch((e) => setErro((e as Error).message));
  }, [mes]);

  const linhas: Linha[] = useMemo(() => (comp?.motoristas ?? []).flatMap((m) => {
    const s = m.semanas.find((x) => x.inicio === inicio);
    if (!s || (s.dias === 0 && s.diasAuto === 0 && !s.diasDatas?.length)) return [];
    const travada = comp!.fechado ? 'mês fechado' : m.fechadoIndividual ? 'fechado sozinho' : s.pago ? 'semana já paga' : null;
    return [{ m, s, travada }];
  }).sort((x, y) => x.m.nome.localeCompare(y.m.nome, 'pt-BR')), [comp, inicio]);

  useEffect(() => {
    if (!comp) return;
    setEd(Object.fromEntries(linhas.map(({ m, s }) => [m.id, datasIniciais(s, m.baseDias)])));
    setTimeout(() => focoRef.current?.scrollIntoView({ block: 'center' }), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comp]);

  const mudancas = linhas.flatMap(({ m, s, travada }) => {
    if (travada || !(m.id in ed)) return [];
    const corpo = corpoDias(s, m.baseDias, ed[m.id]!, s.dias);
    return corpo ? [{ m, s, corpo }] : [];
  });

  async function salvar() {
    setSalvando(true); setErro(null);
    try {
      for (const { m, s, corpo } of mudancas) {
        await api.put('/pessoal/lancamento', { pessoaTipo: 'MOTORISTA', pessoaId: m.id, competencia: mes, periodo: s.inicio, ...corpo });
      }
      await onSalvo(`Dias da semana ${diaMes(inicio)} a ${diaMes(fim)} salvos (${mudancas.length} ${mudancas.length === 1 ? 'motorista' : 'motoristas'}).`);
    } catch (e) { setErro((e as Error).message); setSalvando(false); }
  }
  const fechar = () => { if (mudancas.length && !salvando) setSair(true); else onFechar(); };

  return (
    <Modal titulo={`Ajustar dias · semana ${diaMes(inicio)} a ${diaMes(fim)}`} onFechar={fechar}>
      <div className={a.corpo}>
        <p className={css.hint}>Cada motorista já vem com os dias previstos do contrato marcados (seg–sáb ou seg–sex, sem feriado). Desmarque o dia que ele não rodou; marque se rodou a mais. A nota sai com as datas marcadas.</p>
        {!comp && !erro && <p className={css.hint}>Carregando…</p>}
        {comp && linhas.length === 0 && <p className={css.hint}>Nenhum motorista nesta semana.</p>}
        {linhas.map(({ m, s, travada }) => {
          const datas = ed[m.id] ?? null;
          const n = quantidade(datas, s.dias);
          const valor = Math.round((m.valorCent / Math.max(1, m.diasMes)) * n) + s.adicionalCent - s.debitoAplicadoCent;
          const prev = diasPrevistos(s, m.baseDias);
          const mudou = !travada && !!corpoDias(s, m.baseDias, datas, s.dias);
          return (
            <div key={m.id} ref={m.id === foco ? focoRef : undefined} className={`${a.linha} ${m.id === foco ? a.foco : ''} ${mudou ? a.mudou : ''}`}>
              <div className={a.quem}>
                <Rosto id={m.id} semente={null} tamanho={32} />
                <span><b>{m.nome}</b><small>{[m.empresa, m.baseDias === 'SEG_SAB' ? 'seg–sáb' : 'seg–sex', `previsto ${s.diasAuto}`].filter(Boolean).join(' · ')}</small></span>
              </div>
              <DiasChips dias={s.diasPossiveis ?? []} marcadas={datas} previstos={prev} disabled={!!travada || salvando}
                rotulo={`Dias que ${m.nome} rodou`} onMarcar={(dia) => setEd((x) => ({ ...x, [m.id]: alternarDia(x[m.id] ?? null, dia) }))} />
              <div className={a.total}>
                <b>{n} {n === 1 ? 'dia' : 'dias'}</b>
                <small>{brl(valor)}</small>
              </div>
              <small className={a.nota}>
                {travada ? `Não dá para mudar: ${travada}.`
                  : datas === null ? `Quantidade ajustada à mão (${s.dias}), sem datas. Marque os dias para a nota sair com as datas.`
                  : datas.length ? `Na nota: ${listaDatas(datas)}` : 'Não rodou nesta semana (sai da semana).'}
              </small>
            </div>
          );
        })}
        {erro && <p className={css.erro} role="alert">{erro}</p>}
        {sair && (
          <p className={a.sair} role="alert">
            <b>{mudancas.length} {mudancas.length === 1 ? 'alteração não salva' : 'alterações não salvas'}.</b>
            <button type="button" className={`${css.btnPri} ${css.pequeno}`} onClick={salvar} disabled={salvando}>Salvar</button>
            <button type="button" className={css.btnTxt} onClick={onFechar}>Sair sem salvar</button>
          </p>
        )}
        <div className={css.rodape}>
          <button type="button" className={css.btnSec} onClick={fechar}>Voltar</button>
          <button type="button" className={css.btnPri} disabled={salvando || mudancas.length === 0} onClick={salvar}>
            {salvando ? 'Salvando…' : mudancas.length ? `Salvar ${mudancas.length} ${mudancas.length === 1 ? 'alteração' : 'alterações'}` : 'Nada alterado'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
