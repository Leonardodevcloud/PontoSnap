import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Link } from 'react-router-dom';
import { minutosParaHhMm, reaisDeCentavos, rotuloMarcacao } from '../lib/formato';
import { salvarBlob } from '../lib/download';
import { Botao } from '../components/Botao';
import type { ApuracaoResp, Empregado, ResultadoDiaCLT, BatidaDia } from '../tipos';
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

const ROTULO_DESTINO: Record<string, string> = {
  DESCONTA: 'desconto sinalizado', BANCO: 'abatido do banco', ABONA: 'abonado',
  TOLERA: 'tolerado', PAGA: 'pago como extra',
};
const ehBanco = (d: string) => d === 'BANCO';

export function ApuracaoCLT() {
  const [diaAberto, setDiaAberto] = useState<string | null>(null);
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
            {r.reflexoDsrMin > 0 && <Card k="Reflexo do DSR" v={minutosParaHhMm(r.reflexoDsrMin)} nota="estimativa" dica="Reflexo do descanso semanal remunerado sobre as horas extras da semana. É uma estimativa — a folha de pagamento faz o cálculo exato." />}
            {r.dsrPerdidoSemanas > 0 && <Card k="DSR perdido" v={`${r.dsrPerdidoSemanas} sem`} alerta dica="Semanas em que o funcionário perdeu o descanso semanal remunerado por falta ou atraso." />}
          </div>

          {ap!.destinacao && (ap!.destinacao.falta.min > 0 || ap!.destinacao.atraso.min > 0) && (
            <div className={css.destinacao}>
              <h3>Destinação — o que foi feito com falta e atraso</h3>
              {ap!.destinacao.falta.min > 0 && (
                <div className={css.destLinha}>
                  <span>Faltas injustificadas</span>
                  <span><span className={css.mono}>{minutosParaHhMm(ap!.destinacao.falta.min)}</span> <span className={`${css.destBadge} ${ehBanco(ap!.destinacao.falta.destino) ? css.destBanco : css.destDesc}`}>{ROTULO_DESTINO[ap!.destinacao.falta.destino]}</span></span>
                </div>
              )}
              {ap!.destinacao.atraso.min > 0 && (
                <div className={css.destLinha}>
                  <span>Atrasos e saídas antecipadas</span>
                  <span><span className={css.mono}>{minutosParaHhMm(ap!.destinacao.atraso.min)}</span> <span className={`${css.destBadge} ${ehBanco(ap!.destinacao.atraso.destino) ? css.destBanco : css.destDesc}`}>{ROTULO_DESTINO[ap!.destinacao.atraso.destino]}</span></span>
                </div>
              )}
              <p className={css.destNota}>O sistema calcula e sinaliza — o desconto real é aplicado pela folha.</p>
            </div>
          )}

          <div className={css.tabela}>
            <div className={`${css.linha} ${css.thead}`}>
              <span>Dia</span><span>Trab.</span><span>Contr.</span><span>Extra</span><span>Noturno</span><span>Falta</span><span>Sinais</span>
            </div>
            {r.dias.map((d) => {
              const vazio = d.minutosTrabalhados === 0 && d.minutosContratados === 0 && d.faltaMin === 0;
              return (
                <div
                  key={d.data} role="button" tabIndex={0}
                  className={`${css.linha} ${css.clicavel} ${violSet.has(d.data) ? css.viol : ''} ${vazio ? css.diaVazio : ''} ${diaAberto === d.data ? css.linhaSel : ''}`}
                  onClick={() => setDiaAberto(d.data)}
                  onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setDiaAberto(d.data); } }}
                >
                  <span className={css.data}>{fmtDia(d.data)} <em>{diaSemanaCurto(d.data)}</em></span>
                  <span className={css.mono}>{d.minutosTrabalhados ? minutosParaHhMm(d.minutosTrabalhados) : '—'}</span>
                  <span className={css.mono}>{d.minutosContratados ? minutosParaHhMm(d.minutosContratados) : '—'}</span>
                  <span className={css.mono}>
                    {d.extras.length
                      ? d.extras.map((e, i) => (
                          <span key={i} className={css.extraItem}>{minutosParaHhMm(e.min)} <em>+{e.adicionalPct}%</em></span>
                        ))
                      : '—'}
                  </span>
                  <span className={css.mono}>{d.minutosNoturnosLegais ? minutosParaHhMm(d.minutosNoturnosLegais) : '—'}</span>
                  <span className={`${css.mono} ${d.faltaMin ? css.faltaTxt : ''}`}>{d.faltaMin ? minutosParaHhMm(d.faltaMin) : '—'}</span>
                  <span className={css.sinais}>
                    {d.atrasoMin > 0 && <span className={`${css.tag} ${css.tagAtraso}`} title="Atraso na entrada ou saída antecipada">atraso {minutosParaHhMm(d.atrasoMin)}</span>}
                    {d.paresIncompletos && <span className={css.tag} title="Número ímpar de batidas — alguém esqueceu de registrar a entrada ou a saída">faltou bater</span>}
                    {d.penalidadeIntervaloMin > 0 && <span className={css.tag} title="Intervalo (almoço) abaixo do mínimo legal — Art. 71 §4º">intervalo curto</span>}
                    {d.violacaoInterjornada && <span className={css.tag} title="Menos de 11h de descanso entre duas jornadas — Art. 66">descanso &lt; 11h</span>}
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

          {diaAberto && (
            <GavetaDia
              data={diaAberto}
              dia={r.dias.find((x) => x.data === diaAberto)}
              batidas={ap!.batidas?.[diaAberto] ?? []}
              esperadas={ap!.esperadas ?? 0}
              pares={ap!.horarioPares ?? []}
              nome={ap!.nome}
              onFechar={() => setDiaAberto(null)}
            />
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

function Card({ k, v, destaque, alerta, nota, dica }: { k: string; v: string; destaque?: boolean; alerta?: boolean; nota?: string; dica?: string }) {
  return (
    <div className={`${css.card} ${destaque ? css.cardDestaque : ''} ${alerta ? css.cardAlerta : ''}`} title={dica}>
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

/** Gaveta lateral com o detalhe de um dia: batidas, números e sinais. */
function GavetaDia({ data, dia, batidas, esperadas, pares, nome, onFechar }: {
  data: string;
  dia?: ResultadoDiaCLT;
  batidas: BatidaDia[];
  esperadas: number;
  pares: { entrada: string; saida: string }[];
  nome: string;
  onFechar: () => void;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar]);

  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const hor = (p: string) => `${p.slice(0, 2)}:${p.slice(2)}`;
  // As desconsideradas não entram na contagem de rótulos: elas não valem na jornada.
  const valendo = batidas.filter((b) => b.origem !== 'DESCONSIDERADA');
  const diaSem = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][new Date(`${data}T12:00:00-0300`).getUTCDay()];

  return (
    <>
      <div className={css.fundoGaveta} onClick={onFechar} />
      <aside className={css.gaveta} role="dialog" aria-label={`Detalhe de ${data}`}>
        <div className={css.gTop}>
          <div>
            <p className={css.gData}>{diaSem}, {fmtDia(data)}</p>
            <p className={css.gSub}>
              {nome}
              {pares.length > 0 && ` · horário ${pares.map((p) => `${hor(p.entrada)}–${hor(p.saida)}`).join(' / ')}`}
            </p>
          </div>
          <button className={css.gX} onClick={onFechar} aria-label="Fechar">✕</button>
        </div>

        <span className={css.gSecLb}>Batidas do dia</span>
        {batidas.length === 0 ? (
          <p className={css.gVazio}>
            Nenhuma batida neste dia.
            {dia?.faltaMin ? ' O dia está contando como falta.' : ''}
          </p>
        ) : (
          <>
            {(() => {
              let iValendo = -1;
              return batidas.map((b, i) => {
                const desc = b.origem === 'DESCONSIDERADA';
                if (!desc) iValendo++;
                const rot = desc ? 'desconsiderada' : rotuloMarcacao(iValendo, esperadas || valendo.length);
                return (
                  <div key={`${b.dtMarcacao}-${i}`} className={css.gBat}>
                    <span className={`${css.gDot} ${desc ? css.gDotOff : iValendo % 2 === 0 ? css.gDotE : css.gDotS}`} />
                    <span className={`${css.gBatNome} ${desc ? css.gRiscado : ''}`}>{rot}</span>
                    <span className={`${css.gBatHora} ${desc ? css.gRiscado : ''}`}>{hhmm(b.dtMarcacao)}</span>
                    {b.origem === 'INCLUIDA' && <span className={css.gTagAj} title={b.motivo ?? ''}>ajuste</span>}
                    {desc && <span className={css.gTagDesc} title={b.motivo ?? ''}>fora da conta</span>}
                  </div>
                );
              });
            })()}
            {batidas.some((b) => b.origem !== 'ORIGINAL') && (
              <p className={css.gObs}>
                A batida marcada como <strong>ajuste</strong> entrou por pedido aprovado. A que está <strong>fora da conta</strong>
                {' '}continua no arquivo fiscal, mas não conta na jornada.
              </p>
            )}
          </>
        )}

        {dia && (
          <>
            <div className={css.gSep} />
            <span className={css.gSecLb}>Números do dia</span>
            <div className={css.gGrade}>
              <Caixa k="trabalhado" v={dia.minutosTrabalhados ? minutosParaHhMm(dia.minutosTrabalhados) : '—'} />
              <Caixa k="contratado" v={dia.minutosContratados ? minutosParaHhMm(dia.minutosContratados) : '—'} />
              {dia.extras.map((e, i) => <Caixa key={i} k={`extra +${e.adicionalPct}%`} v={minutosParaHhMm(e.min)} bom />)}
              {dia.minutosNoturnosLegais > 0 && <Caixa k="noturno" v={minutosParaHhMm(dia.minutosNoturnosLegais)} />}
              {dia.atrasoMin > 0 && <Caixa k="atraso" v={minutosParaHhMm(dia.atrasoMin)} ruim />}
              {dia.faltaMin > 0 && <Caixa k="falta" v={minutosParaHhMm(dia.faltaMin)} ruim />}
              {dia.intervaloGozadoMin > 0 && <Caixa k="intervalo" v={minutosParaHhMm(dia.intervaloGozadoMin)} ruim={dia.penalidadeIntervaloMin > 0} />}
              <Caixa k="saldo do dia" v={`${dia.saldoMin > 0 ? '+' : ''}${minutosParaHhMm(Math.abs(dia.saldoMin))}`} bom={dia.saldoMin > 0} ruim={dia.saldoMin < 0} />
            </div>

            {(dia.atrasoMin > 0 || dia.paresIncompletos || dia.penalidadeIntervaloMin > 0 || dia.violacaoInterjornada || dia.observacoes.length > 0) && (
              <>
                <div className={css.gSep} />
                <span className={css.gSecLb}>Sinais</span>
                <div className={css.gSinais}>
                  {dia.atrasoMin > 0 && <span className={`${css.tag} ${css.tagAtraso}`}>atraso {minutosParaHhMm(dia.atrasoMin)}</span>}
                  {dia.paresIncompletos && <span className={css.tag}>faltou bater</span>}
                  {dia.penalidadeIntervaloMin > 0 && <span className={css.tag}>intervalo curto</span>}
                  {dia.violacaoInterjornada && <span className={css.tag}>descanso &lt; 11h</span>}
                </div>
                {dia.penalidadeIntervaloMin > 0 && (
                  <p className={css.gObs}>Intervalo abaixo do mínimo legal: a CLT manda pagar o período todo como extra (Art. 71 §4º). Já está no cálculo.</p>
                )}
                {dia.observacoes.map((o, i) => <p key={i} className={css.gObs}>{o}</p>)}
              </>
            )}
          </>
        )}

        <div className={css.gAcoes}>
          <Link to={`/rh/ajustes?empregado=${encodeURIComponent(nome)}&data=${data}`} className={css.gBtn}>Lançar ajuste neste dia</Link>
          <Link to={`/rh/espelhos?data=${data}`} className={css.gBtn2}>Abrir espelho</Link>
        </div>
      </aside>
    </>
  );
}

function Caixa({ k, v, bom, ruim }: { k: string; v: string; bom?: boolean; ruim?: boolean }) {
  return (
    <div className={css.gBox}>
      <span className={css.gBoxL}>{k}</span>
      <span className={`${css.gBoxV} ${bom ? css.gBom : ''} ${ruim ? css.gRuim : ''}`}>{v}</span>
    </div>
  );
}
