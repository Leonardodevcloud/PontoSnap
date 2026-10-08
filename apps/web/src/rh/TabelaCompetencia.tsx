import { useMemo, useState } from 'react';
import { minutosParaHhMm, reaisDeCentavos } from '../lib/formato';
import type { LinhaCompetencia, RelatorioCompetencia } from '../tipos';
import vt from './VisaoTodos.module.css';

/**
 * Tabela "todos os funcionários" de uma competência. Serve às telas Espelhos
 * (modo espelho: jornada + banco + situação) e Apuração CLT (modo apuracao:
 * extras 50/100, noturno, sinais e R$). Ordenação por coluna e filtro vêm
 * de fora, pra cada tela decidir o que mostra.
 */

export type ModoTabela = 'espelho' | 'apuracao';
export type FiltroApuracao = 'todos' | 'extras' | 'faltas' | 'sinais';

const comSinal = (m: number) => `${m > 0 ? '+' : m < 0 ? '−' : ''}${minutosParaHhMm(Math.abs(m))}`;
const hhOuTraco = (m: number) => (m > 0 ? minutosParaHhMm(m) : '—');
const fmtDia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const ROTULO_AFAST: Record<string, string> = {
  FERIAS: 'férias', INSS: 'INSS', MATERNIDADE: 'lic. maternidade', PATERNIDADE: 'lic. paternidade', SUSPENSAO: 'suspensão', OUTRO: 'afastado',
};

/** Pílulas de situação de uma linha: só o que exige olhar do RH. */
export function Situacao({ l, hoje, modo }: { l: LinhaCompetencia; hoje: string; modo: ModoTabela }) {
  const pills: JSX.Element[] = [];
  const s = l.sinais;
  if (s.emAbertoHoje) pills.push(<span key="ab" className={`${vt.pill} ${vt.pillErr}`}>batida em aberto</span>);
  const faltasPassadas = s.faltaDias.filter((d) => d < hoje);
  if (faltasPassadas.length > 0) {
    pills.push(<span key="fa" className={`${vt.pill} ${vt.pillErr}`}>
      {faltasPassadas.length === 1 ? `falta ${fmtDia(faltasPassadas[0]!)}` : `${faltasPassadas.length} faltas`}
    </span>);
  }
  const imparPassado = s.impar - (s.emAbertoHoje ? 1 : 0);
  if (imparPassado > 0) pills.push(<span key="im" className={`${vt.pill} ${vt.pillErr}`} title="Dias com batida em aberto: ficam pendentes (sem falta/atraso) até o ajuste de ponto">faltou bater ×{imparPassado}</span>);
  if (modo === 'apuracao') {
    if (s.intervalo > 0) pills.push(<span key="in" className={`${vt.pill} ${vt.pillWarn}`}>interv. ×{s.intervalo}</span>);
    if (s.interjornada > 0) pills.push(<span key="ij" className={`${vt.pill} ${vt.pillWarn}`}>descanso &lt; 11h ×{s.interjornada}</span>);
    if (l.dsrPerdidoSemanas > 0) pills.push(<span key="dsr" className={`${vt.pill} ${vt.pillMute}`}>DSR perdido ×{l.dsrPerdidoSemanas}</span>);
  } else {
    if (s.intervalo > 0) pills.push(<span key="in" className={`${vt.pill} ${vt.pillWarn}`}>intervalo curto</span>);
  }
  if (l.banco && l.banco.formaCalculo !== 'INTRA_MES') {
    // Vencimento próximo não vem no relatório; o acumulado negativo sim.
    if (l.banco.saldoAcumuladoMin < 0) pills.push(<span key="dev" className={`${vt.pill} ${vt.pillWarn}`}>devendo no banco</span>);
  }
  if (l.destinacao && l.faltaMin > 0 && l.destinacao.falta.destino !== 'BANCO') {
    pills.push(<span key="dest" className={`${vt.pill} ${vt.pillMute}`}>falta → {l.destinacao.falta.destino === 'ABONA' ? 'abonada' : 'desconto'}</span>);
  }
  for (const a of l.afastamentos ?? []) {
    pills.push(<span key={`af${a.dataInicio}`} className={`${vt.pill} ${vt.pillMute}`}>{ROTULO_AFAST[a.tipo] ?? 'afastado'} {fmtDia(a.dataInicio)}–{fmtDia(a.dataFim)}</span>);
  }
  if (l.assinada) pills.push(<span key="as" className={`${vt.pill} ${vt.pillLime}`}>assinado</span>);
  if (pills.length === 0) pills.push(<span key="ok" className={`${vt.pill} ${vt.pillOk}`}>em dia</span>);
  return <>{pills}</>;
}

type Col = { k: string; t: string; n?: boolean; v: (l: LinhaCompetencia) => number | string; cell: (l: LinhaCompetencia) => JSX.Element | string; tot?: (r: RelatorioCompetencia) => string; cls?: (l: LinhaCompetencia) => string };

function colunas(modo: ModoTabela, hoje: string): Col[] {
  const sinal = (m: number) => (m > 0 ? vt.pos : m < 0 ? vt.neg : vt.mute);
  const base: Col[] = [
    { k: 'nome', t: 'Funcionário', v: (l) => l.nome, cell: (l) => (
      <span className={vt.nome}>{l.nome}<small>{l.matricula ? `#${l.matricula} · ` : ''}{l.regime === 'CLT_12x36' ? '12×36' : l.horarioDurMin ? `${Math.round(l.horarioDurMin / 60)}h/dia` : 'sem escala'}</small></span>
    ), tot: (r) => `Total · ${r.linhas.length} funcionário${r.linhas.length === 1 ? '' : 's'}` },
    { k: 'trab', t: 'Trab.', n: true, v: (l) => l.trabalhadoMin, cell: (l) => minutosParaHhMm(l.trabalhadoMin), tot: (r) => minutosParaHhMm(r.totais.trabalhadoMin) },
    // Contratado do MÊS INTEIRO (o que a escala espera até o último dia). O
    // apurado até hoje fica no tooltip — é a base do saldo.
    { k: 'contr', t: modo === 'espelho' ? 'Previsto' : 'Contr.', n: true, v: (l) => l.contratadoMesMin ?? l.contratadoMin,
      cell: (l) => <span title={`Mês inteiro · até hoje ${minutosParaHhMm(l.contratadoMin)}`}>{minutosParaHhMm(l.contratadoMesMin ?? l.contratadoMin)}</span>,
      tot: (r) => minutosParaHhMm(r.totais.contratadoMesMin ?? r.totais.contratadoMin) },
  ];
  if (modo === 'espelho') {
    base.push(
      { k: 'extras', t: 'Extras', n: true, v: (l) => l.extrasMin, cell: (l) => (l.extrasMin > 0 ? `+${minutosParaHhMm(l.extrasMin)}` : '—'), cls: (l) => (l.extrasMin > 0 ? vt.pos : vt.mute), tot: (r) => `+${minutosParaHhMm(r.totais.extrasMin)}` },
      { k: 'atrfal', t: 'Atr./Faltas', n: true, v: (l) => l.atrasoMin + l.faltaMin, cell: (l) => (l.atrasoMin + l.faltaMin > 0 ? `−${minutosParaHhMm(l.atrasoMin + l.faltaMin)}` : '—'), cls: (l) => (l.atrasoMin + l.faltaMin > 0 ? vt.neg : vt.mute), tot: (r) => `−${minutosParaHhMm(r.totais.atrasoMin + r.totais.faltaMin)}` },
    );
  } else {
    base.push(
      { k: 'e50', t: 'Extra 50%', n: true, v: (l) => l.extra50Min, cell: (l) => hhOuTraco(l.extra50Min), cls: (l) => (l.extra50Min > 0 ? vt.pos : vt.mute), tot: (r) => minutosParaHhMm(r.totais.extra50Min) },
      { k: 'e100', t: 'Extra 100%', n: true, v: (l) => l.extra100Min, cell: (l) => hhOuTraco(l.extra100Min), cls: (l) => (l.extra100Min > 0 ? vt.pos : vt.mute), tot: (r) => minutosParaHhMm(r.totais.extra100Min) },
      { k: 'not', t: 'Noturno', n: true, v: (l) => l.noturnoMin, cell: (l) => hhOuTraco(l.noturnoMin), cls: (l) => (l.noturnoMin > 0 ? '' : vt.mute), tot: (r) => minutosParaHhMm(r.totais.noturnoMin) },
      { k: 'falta', t: 'Faltas', n: true, v: (l) => l.faltaMin, cell: (l) => hhOuTraco(l.faltaMin), cls: (l) => (l.faltaMin > 0 ? vt.neg : vt.mute), tot: (r) => minutosParaHhMm(r.totais.faltaMin) },
      { k: 'atraso', t: 'Atrasos', n: true, v: (l) => l.atrasoMin, cell: (l) => hhOuTraco(l.atrasoMin), cls: (l) => (l.atrasoMin > 0 ? vt.neg : vt.mute), tot: (r) => minutosParaHhMm(r.totais.atrasoMin) },
    );
  }
  base.push({ k: 'saldo', t: 'Saldo do mês', n: true, v: (l) => l.saldoMesMin, cell: (l) => comSinal(l.saldoMesMin), cls: (l) => sinal(l.saldoMesMin), tot: (r) => comSinal(r.totais.saldoMesMin) });
  if (modo === 'espelho') {
    base.push({ k: 'bant', t: 'Banco anterior', n: true, v: (l) => l.banco?.saldoAnteriorMin ?? -1e9, cell: (l) => (l.banco ? comSinal(l.banco.saldoAnteriorMin) : '—'), cls: (l) => (l.banco ? sinal(l.banco.saldoAnteriorMin) : vt.mute), tot: (r) => comSinal(r.totais.bancoAnteriorMin) });
  }
  base.push({ k: 'bacu', t: modo === 'espelho' ? 'Banco acumulado' : 'Banco acum.', n: true, v: (l) => l.banco?.saldoAcumuladoMin ?? -1e9, cell: (l) => (l.banco ? comSinal(l.banco.saldoAcumuladoMin) : <span className={vt.mute} title="Sem banco de horas: extra é paga na folha">sem banco</span>), cls: (l) => (l.banco ? sinal(l.banco.saldoAcumuladoMin) : ''), tot: (r) => comSinal(r.totais.bancoAcumuladoMin) });
  base.push({ k: 'sit', t: modo === 'espelho' ? 'Situação' : 'Sinais', v: (l) => l.sinais.impar + l.sinais.faltaDias.length + l.sinais.intervalo, cell: (l) => <Situacao l={l} hoje={hoje} modo={modo} /> });
  if (modo === 'apuracao') {
    base.push(
      { k: 'rext', t: 'Extras R$', n: true, v: (l) => l.extrasCentavos, cell: (l) => (!l.temSalario ? <span className={vt.mute} title="Sem salário cadastrado">—</span>
        : (l.extrasCentavos + l.adicionalNoturnoCentavos) > 0 ? reaisDeCentavos(l.extrasCentavos + l.adicionalNoturnoCentavos)
        : (l.extrasNoBancoMin ?? 0) > 0 ? <span className={vt.mute} title={`${minutosParaHhMm(l.extrasNoBancoMin!)} de extra foram pro banco de horas — não são pagas nesta folha`}>no banco</span>
        : '—'), tot: (r) => reaisDeCentavos(r.totais.extrasCentavos + r.totais.adicionalNoturnoCentavos) },
      { k: 'rdesc', t: 'Descontos R$', n: true, v: (l) => l.descontosCentavos, cell: (l) => (l.descontosCentavos > 0 ? `−${reaisDeCentavos(l.descontosCentavos)}` : '—'), cls: (l) => (l.descontosCentavos > 0 ? vt.neg : vt.mute), tot: (r) => `−${reaisDeCentavos(r.totais.descontosCentavos)}` },
    );
  }
  return base;
}

export function TabelaCompetencia({ rel, modo, busca, filtro, onAbrir }: {
  rel: RelatorioCompetencia;
  modo: ModoTabela;
  busca?: string;
  filtro?: FiltroApuracao;
  onAbrir: (empregadoId: string) => void;
}) {
  const [ord, setOrd] = useState<{ k: string; asc: boolean }>({ k: 'nome', asc: true });
  const cols = useMemo(() => colunas(modo, rel.hoje), [modo, rel.hoje]);

  const linhas = useMemo(() => {
    const q = (busca ?? '').trim().toLowerCase();
    let ls = rel.linhas.filter((l) => !q || l.nome.toLowerCase().includes(q) || (l.matricula ?? '').toLowerCase().includes(q));
    if (filtro === 'extras') ls = ls.filter((l) => l.extrasMin > 0);
    if (filtro === 'faltas') ls = ls.filter((l) => l.faltaMin > 0 || l.atrasoMin > 0);
    if (filtro === 'sinais') ls = ls.filter((l) => l.sinais.impar + l.sinais.intervalo + l.sinais.interjornada + l.sinais.faltaDias.length > 0);
    const c = cols.find((x) => x.k === ord.k) ?? cols[0]!;
    return [...ls].sort((a, b) => {
      const va = c.v(a), vb = c.v(b);
      const r = typeof va === 'string' && typeof vb === 'string' ? va.localeCompare(vb, 'pt-BR') : Number(va) - Number(vb);
      return ord.asc ? r : -r;
    });
  }, [rel.linhas, busca, filtro, cols, ord]);

  const clicar = (k: string) => setOrd((o) => (o.k === k ? { k, asc: !o.asc } : { k, asc: k === 'nome' }));
  const filtrado = linhas.length !== rel.linhas.length;

  return (
    <div className={vt.tab}>
      <div className={vt.scroll}>
        <table className={vt.table}>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.k} className={`${c.n ? vt.n : ''} ${ord.k === c.k ? vt.ord : ''}`} onClick={() => clicar(c.k)} title="Ordenar">
                  {c.t}{ord.k === c.k ? (ord.asc ? ' ▴' : ' ▾') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 && (
              <tr><td colSpan={cols.length}><div className={vt.vazio}>{rel.linhas.length === 0 ? 'Nenhum funcionário apurado nesta competência.' : 'Ninguém bate com o filtro.'}</div></td></tr>
            )}
            {linhas.map((l) => (
              <tr key={l.empregadoId} className={vt.row} tabIndex={0} role="button"
                onClick={() => onAbrir(l.empregadoId)}
                onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onAbrir(l.empregadoId); } }}>
                {cols.map((c) => <td key={c.k} className={`${c.n ? vt.n : ''} ${c.cls ? c.cls(l) : ''}`}>{c.cell(l)}</td>)}
              </tr>
            ))}
          </tbody>
          {!filtrado && rel.linhas.length > 1 && (
            <tfoot>
              <tr className={vt.tot}>{cols.map((c) => <td key={c.k} className={c.n ? vt.n : ''}>{c.tot ? c.tot(rel) : ''}</td>)}</tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
