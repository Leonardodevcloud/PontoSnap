import { useState } from 'react';
import { api } from '../lib/api';
import { minutosParaHhMm, reaisDeCentavos } from '../lib/formato';
import type { RelatorioResp } from '../tipos';
import { Botao } from '../components/Botao';
import { salvarBlob } from '../lib/download';
import css from './Relatorios.module.css';

const mesAtual = () => new Date().toISOString().slice(0, 7);
function faixaDoMes(mes: string) {
  const [a, m] = mes.split('-').map(Number);
  const ultimo = new Date(a!, m!, 0).getDate();
  return { inicio: `${mes}-01`, fim: `${mes}-${String(ultimo).padStart(2, '0')}` };
}

export function Relatorios() {
  const [mes, setMes] = useState(mesAtual());
  const [rel, setRel] = useState<RelatorioResp | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function gerar() {
    setErro(null); setCarregando(true); setRel(null);
    try {
      const { inicio, fim } = faixaDoMes(mes);
      setRel(await api.get<RelatorioResp>(`/tratamento/relatorio-competencia?inicio=${inicio}&fim=${fim}`));
    } catch (e) { setErro((e as Error).message); }
    finally { setCarregando(false); }
  }

  async function gerarBackground() {
    setErro(null); setCarregando(true); setRel(null);
    try {
      const { inicio, fim } = faixaDoMes(mes);
      const { id } = await api.post<{ id: string }>('/jobs/relatorio-competencia', { inicio, fim });
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const j = await api.get<{ status: string; resultado: RelatorioResp | null; erro: string | null }>(`/jobs/${id}`);
        if (j.status === 'concluido') { setRel(j.resultado); return; }
        if (j.status === 'erro') { setErro(j.erro ?? 'Falha ao processar o relatório'); return; }
      }
      setErro('O relatório demorou mais que o esperado. Tente novamente.');
    } catch (e) { setErro((e as Error).message); }
    finally { setCarregando(false); }
  }

  async function baixar(fmt: 'pdf' | 'xlsx') {
    const { inicio, fim } = faixaDoMes(mes);
    try {
      const blob = await api.baixar(`/tratamento/relatorio-competencia/${fmt}?inicio=${inicio}&fim=${fim}`);
      salvarBlob(blob, `relatorio_${mes}.${fmt}`);
    } catch (e) { setErro((e as Error).message); }
  }

  const maxExtras = rel ? Math.max(1, ...rel.linhas.map((l) => l.extrasCentavos)) : 1;
  const comExtras = rel?.linhas.filter((l) => l.extrasCentavos > 0).sort((a, b) => b.extrasCentavos - a.extrasCentavos) ?? [];

  return (
    <div>
      <div className={css.head}>
        <div><h2>Relatórios</h2><p>Consolidado da competência por funcionário</p></div>
        <div className={css.controles}>
          <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
          <Botao variante="coral" className={css.btn} onClick={gerar} disabled={carregando}>{carregando ? 'Apurando…' : 'Gerar'}</Botao>
          <Botao variante="ghost" className={css.btn} onClick={gerarBackground} disabled={carregando} title="Recomendado para muitos funcionários">2º plano</Botao>
          {rel && <Botao variante="ghost" className={css.btn} onClick={() => baixar('pdf')}>PDF</Botao>}
          {rel && <Botao variante="ghost" className={css.btn} onClick={() => baixar('xlsx')}>Excel</Botao>}
        </div>
      </div>

      {erro && <p className={css.erro}>{erro}</p>}
      {carregando && <p className={css.info}>Apurando todos os funcionários da competência… (o modo 2º plano processa sem travar a tela)</p>}
      {!rel && !carregando && <p className={css.info}>Escolha a competência e clique em Gerar.</p>}

      {rel && (
        <>
          <div className={css.cards}>
            <Card k="Custo em extras" v={reaisDeCentavos(rel.totais.extrasCentavos)} destaque />
            <Card k="Adicional noturno" v={reaisDeCentavos(rel.totais.adicionalNoturnoCentavos)} />
            <Card k="Total de extras" v={minutosParaHhMm(rel.totais.extrasMin)} />
            <Card k="Total de faltas" v={minutosParaHhMm(rel.totais.faltaMin)} alerta={rel.totais.faltaMin > 0} />
            <Card k="Total de atrasos" v={minutosParaHhMm(rel.totais.atrasoMin)} alerta={rel.totais.atrasoMin > 0} />
          </div>

          {comExtras.length > 0 && (
            <div className={css.grafico}>
              <h3>Custo de extras por funcionário</h3>
              {comExtras.map((l) => (
                <div key={l.empregadoId} className={css.barra}>
                  <span className={css.barraNome}>{l.nome}</span>
                  <div className={css.barraTrilho}>
                    <div className={css.barraFill} style={{ width: `${(l.extrasCentavos / maxExtras) * 100}%` }} />
                  </div>
                  <span className={css.barraVal}>{reaisDeCentavos(l.extrasCentavos)}</span>
                </div>
              ))}
            </div>
          )}

          <div className={css.tabela}>
            <div className={`${css.linha} ${css.thead}`}>
              <span>Funcionário</span><span>Trab.</span><span>Extra</span><span>Noturno</span><span>Falta</span><span>Atraso</span><span>Extras R$</span><span>Parcial R$</span>
            </div>
            {rel.linhas.map((l) => (
              <div key={l.empregadoId} className={css.linha}>
                <span className={css.nome}>{l.nome}{!l.temSalario && <em className={css.semSal}> sem salário</em>}</span>
                <span className={css.mono}>{minutosParaHhMm(l.trabalhadoMin)}</span>
                <span className={css.mono}>{l.extrasMin ? minutosParaHhMm(l.extrasMin) : '—'}</span>
                <span className={css.mono}>{l.noturnoMin ? minutosParaHhMm(l.noturnoMin) : '—'}</span>
                <span className={`${css.mono} ${l.faltaMin ? css.alertaTxt : ''}`}>{l.faltaMin ? minutosParaHhMm(l.faltaMin) : '—'}</span>
                <span className={`${css.mono} ${l.atrasoMin ? css.alertaTxt : ''}`}>{l.atrasoMin ? minutosParaHhMm(l.atrasoMin) : '—'}</span>
                <span className={css.mono}>{l.temSalario ? reaisDeCentavos(l.extrasCentavos) : '—'}</span>
                <span className={css.mono}>{l.temSalario ? reaisDeCentavos(l.liquidoProventosCentavos) : '—'}</span>
              </div>
            ))}
            <div className={`${css.linha} ${css.total}`}>
              <span>Total</span>
              <span className={css.mono}>{minutosParaHhMm(rel.totais.trabalhadoMin)}</span>
              <span className={css.mono}>{minutosParaHhMm(rel.totais.extrasMin)}</span>
              <span className={css.mono}>{minutosParaHhMm(rel.totais.noturnoMin)}</span>
              <span className={css.mono}>{minutosParaHhMm(rel.totais.faltaMin)}</span>
              <span className={css.mono}>{minutosParaHhMm(rel.totais.atrasoMin)}</span>
              <span className={css.mono}>{reaisDeCentavos(rel.totais.extrasCentavos)}</span>
              <span className={css.mono}>{reaisDeCentavos(rel.totais.liquidoProventosCentavos)}</span>
            </div>
          </div>

          <p className={css.disclaimer}>
            Valores calculados sobre o salário cadastrado (divisor 220h). Reflexo de DSR é estimativa. Cobre o que a
            jornada gera — não é a folha completa. Não substitui validação contábil.
          </p>
        </>
      )}
    </div>
  );
}

function Card({ k, v, destaque, alerta }: { k: string; v: string; destaque?: boolean; alerta?: boolean }) {
  return (
    <div className={`${css.card} ${destaque ? css.cardDestaque : ''} ${alerta ? css.cardAlerta : ''}`}>
      <div className={css.cardK}>{k}</div>
      <div className={css.cardV}>{v}</div>
    </div>
  );
}
