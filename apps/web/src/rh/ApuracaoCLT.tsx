import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { minutosParaHhMm, reaisDeCentavos } from '../lib/formato';
import { salvarBlob } from '../lib/download';
import { Botao } from '../components/Botao';
import type { ApuracaoResp, Empregado } from '../tipos';
import css from './ApuracaoCLT.module.css';

const mesAtual = () => new Date().toISOString().slice(0, 7);
function faixaDoMes(mes: string): { inicio: string; fim: string } {
  const [a, m] = mes.split('-').map(Number);
  const ultimo = new Date(a!, m!, 0).getDate();
  return { inicio: `${mes}-01`, fim: `${mes}-${String(ultimo).padStart(2, '0')}` };
}
const fmtDia = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
};
const diaSemanaCurto = (iso: string) =>
  ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(`${iso}T12:00:00-0300`).getUTCDay()];

export function ApuracaoCLT() {
  const [emps, setEmps] = useState<Empregado[]>([]);
  const [empregadoId, setEmpregadoId] = useState('');
  const [mes, setMes] = useState(mesAtual());
  const [ap, setAp] = useState<ApuracaoResp | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [baixando, setBaixando] = useState(false);

  useEffect(() => {
    api.get<Empregado[]>('/empregados')
      .then((l) => { const a = l.filter((e) => e.ativo); setEmps(a); if (a[0]) setEmpregadoId(a[0].id); })
      .catch((e) => setErro((e as Error).message));
  }, []);

  useEffect(() => {
    if (!empregadoId) return;
    const { inicio, fim } = faixaDoMes(mes);
    setCarregando(true); setErro(null);
    api.get<ApuracaoResp>(`/tratamento/apuracao?empregadoId=${empregadoId}&inicio=${inicio}&fim=${fim}`)
      .then(setAp)
      .catch((e) => { setErro((e as Error).message); setAp(null); })
      .finally(() => setCarregando(false));
  }, [empregadoId, mes]);

  async function baixarPdf() {
    const { inicio, fim } = faixaDoMes(mes);
    setBaixando(true);
    try {
      const blob = await api.baixar(`/tratamento/apuracao/pdf?empregadoId=${empregadoId}&inicio=${inicio}&fim=${fim}`);
      salvarBlob(blob, `apuracao_${mes}.pdf`);
    } catch (e) { setErro((e as Error).message); }
    finally { setBaixando(false); }
  }

  const r = ap?.resultado;
  const extra50 = r?.extrasPorAdicional['50'] ?? 0;
  const extra100 = r?.extrasPorAdicional['100'] ?? 0;
  const violSet = new Set(r?.diasComViolacao ?? []);

  return (
    <div>
      <div className={css.head}>
        <div><h2>Apuração CLT</h2><p>Fechamento de competência pelo motor de regras</p></div>
        {ap && <Botao variante="coral" className={css.pdfBtn} onClick={baixarPdf} disabled={baixando}>{baixando ? 'Gerando…' : 'Baixar PDF'}</Botao>}
      </div>

      <div className={css.controles}>
        <label className={css.sel}>
          <span className={css.lb}>Funcionário</span>
          <select value={empregadoId} onChange={(e) => setEmpregadoId(e.target.value)}>
            {emps.length === 0 && <option value="">— nenhum funcionário —</option>}
            {emps.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </label>
        <label className={css.sel}>
          <span className={css.lb}>Competência</span>
          <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
        </label>
      </div>

      {erro && <p className={css.erro}>{erro}</p>}
      {carregando && <p className={css.carregando}>Apurando…</p>}

      {r && !carregando && (
        <>
          <div className={css.cards}>
            <Card k="Trabalhado" v={minutosParaHhMm(r.totalTrabalhadoMin)} />
            <Card k="Contratado" v={minutosParaHhMm(r.totalContratadoMin)} />
            <Card k="Extra 50%" v={minutosParaHhMm(extra50)} destaque={extra50 > 0} />
            <Card k="Extra 100%" v={minutosParaHhMm(extra100)} destaque={extra100 > 0} />
            <Card k="Noturno (legal)" v={minutosParaHhMm(r.totalNoturnoLegalMin)} />
            <Card k="Faltas" v={minutosParaHhMm(r.totalFaltaMin)} alerta={r.totalFaltaMin > 0} />
            <Card k="Atrasos" v={minutosParaHhMm(r.totalAtrasoMin)} alerta={r.totalAtrasoMin > 0} />
            <Card k={r.saldoPeriodoMin >= 0 ? 'Saldo credor' : 'Saldo devedor'} v={minutosParaHhMm(r.saldoPeriodoMin)} />
            {r.bancoDeHorasMin !== 0 && <Card k="Banco de horas" v={minutosParaHhMm(r.bancoDeHorasMin)} />}
            {r.reflexoDsrMin > 0 && <Card k="Reflexo DSR ~" v={minutosParaHhMm(r.reflexoDsrMin)} nota="estimativa" />}
            {r.dsrPerdidoSemanas > 0 && <Card k="DSR perdido" v={`${r.dsrPerdidoSemanas} sem`} alerta />}
          </div>

          <div className={css.tabela}>
            <div className={`${css.linha} ${css.thead}`}>
              <span>Dia</span><span>Trab.</span><span>Contr.</span><span>Extra</span><span>Noturno</span><span>Falta</span><span>Sinais</span>
            </div>
            {r.dias.map((d) => {
              const vazio = d.minutosTrabalhados === 0 && d.minutosContratados === 0 && d.faltaMin === 0;
              return (
                <div key={d.data} className={`${css.linha} ${violSet.has(d.data) ? css.viol : ''} ${vazio ? css.diaVazio : ''}`}>
                  <span className={css.data}>{fmtDia(d.data)} <em>{diaSemanaCurto(d.data)}</em></span>
                  <span className={css.mono}>{d.minutosTrabalhados ? minutosParaHhMm(d.minutosTrabalhados) : '—'}</span>
                  <span className={css.mono}>{d.minutosContratados ? minutosParaHhMm(d.minutosContratados) : '—'}</span>
                  <span className={css.mono}>{d.extras.length ? d.extras.map((e) => `${minutosParaHhMm(e.min)}@${e.adicionalPct}%`).join(' ') : '—'}</span>
                  <span className={css.mono}>{d.minutosNoturnosLegais ? minutosParaHhMm(d.minutosNoturnosLegais) : '—'}</span>
                  <span className={`${css.mono} ${d.faltaMin ? css.faltaTxt : ''}`}>{d.faltaMin ? minutosParaHhMm(d.faltaMin) : '—'}</span>
                  <span className={css.sinais}>
                    {d.atrasoMin > 0 && <span className={`${css.tag} ${css.tagAtraso}`} title="Atraso/saída antecipada">atraso {minutosParaHhMm(d.atrasoMin)}</span>}
                    {d.paresIncompletos && <span className={css.tag} title="Batidas ímpares">ímpar</span>}
                    {d.penalidadeIntervaloMin > 0 && <span className={css.tag} title="Intervalo insuficiente (Art. 71 §4º)">interv.</span>}
                    {d.violacaoInterjornada && <span className={css.tag} title="Interjornada < 11h (Art. 66)">11h</span>}
                  </span>
                </div>
              );
            })}
          </div>

          {ap!.valores && (
            <div className={css.valores}>
              <h3>Valores (R$)</h3>
              <div className={css.vLinhas}>
                <VLinha k={`Valor-hora (salário / 220h)`} v={reaisDeCentavos(ap!.valores.valorHoraCentavos)} />
                <VLinha k="Horas extras (base + adicional)" v={reaisDeCentavos(ap!.valores.extrasCentavos)} />
                <VLinha k="Adicional noturno" v={reaisDeCentavos(ap!.valores.adicionalNoturnoCentavos)} />
                <VLinha k="Reflexo de DSR (estimativa)" v={reaisDeCentavos(ap!.valores.reflexoDsrCentavos)} />
                {ap!.valores.descontoFaltasCentavos > 0 && <VLinha k="(–) Faltas" v={`- ${reaisDeCentavos(ap!.valores.descontoFaltasCentavos)}`} desc />}
                {ap!.valores.descontoAtrasosCentavos > 0 && <VLinha k="(–) Atrasos" v={`- ${reaisDeCentavos(ap!.valores.descontoAtrasosCentavos)}`} desc />}
                {ap!.valores.descontoDsrPerdidoCentavos > 0 && <VLinha k="(–) DSR perdido" v={`- ${reaisDeCentavos(ap!.valores.descontoDsrPerdidoCentavos)}`} desc />}
                <VLinha k="Resultado parcial da jornada" v={reaisDeCentavos(ap!.valores.liquidoProventosCentavos)} forte />
              </div>
            </div>
          )}

          <p className={css.disclaimer}>
            Regras aplicadas: <strong>{ap!.regras}</strong>. Escala considerada seg–sex quando não há configuração específica;
            feriados vêm do calendário do cliente. O <strong>reflexo de DSR é estimativa</strong> e os percentuais seguem a base
            CLT — o acordo/convenção coletiva do cliente prevalece. Não substitui validação contábil.
          </p>
        </>
      )}
    </div>
  );
}

function Card({ k, v, destaque, alerta, nota }: { k: string; v: string; destaque?: boolean; alerta?: boolean; nota?: string }) {
  return (
    <div className={`${css.card} ${destaque ? css.cardDestaque : ''} ${alerta ? css.cardAlerta : ''}`}>
      <div className={css.cardK}>{k}{nota && <em> {nota}</em>}</div>
      <div className={css.cardV}>{v}</div>
    </div>
  );
}

function VLinha({ k, v, forte, desc }: { k: string; v: string; forte?: boolean; desc?: boolean }) {
  return (
    <div className={`${css.vLinha} ${forte ? css.vForte : ''}`}>
      <span className={desc ? css.vDesc : ''}>{k}</span>
      <strong className={desc ? css.vDesc : ''}>{v}</strong>
    </div>
  );
}
