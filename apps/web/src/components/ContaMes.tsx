import { useState, type ReactNode } from 'react';
import type { ContaMes as TConta, DestinoDiaConta } from '../tipos';
import css from './ContaMes.module.css';

const hm = (min: number) => `${Math.floor(Math.abs(min) / 60)}h${String(Math.abs(min) % 60).padStart(2, '0')}`;
const sinal = (min: number) => (min === 0 ? '0h00' : `${min > 0 ? '+' : '−'}${hm(min)}`);
const SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const diaTxt = (d: string) => `${SEM[new Date(`${d}T12:00:00-03:00`).getDay()]} ${d.slice(8, 10)}`;
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const listaDias = (ds: string[]) => ds.length <= 3 ? ds.map(diaTxt).join(', ') : `${ds.slice(0, 2).map(diaTxt).join(', ')} e mais ${ds.length - 2}`;

const DESTINO: Record<DestinoDiaConta, { rh: string; eu: string; tom: string }> = {
  BANCO: { rh: 'banco', eu: 'banco', tom: 'in' },
  PAGA: { rh: 'extra paga', eu: 'extra paga', tom: 'ok' },
  FOLHA: { rh: 'descontado', eu: 'descontado', tom: 'er' },
  TOLERADO: { rh: 'tolerância', eu: 'tolerância', tom: 'cz' },
  FALTA: { rh: 'falta', eu: 'falta', tom: 'er' },
  PENDENTE: { rh: 'em aberto', eu: 'em aberto', tom: 'av' },
  SEMANA: { rh: 'semana aberta', eu: 'semana aberta', tom: 'av' },
  ZERO: { rh: 'certinho', eu: 'certinho', tom: 'cz' },
};

function L({ op, rot, sub, v, tipo }: { op?: string; rot: ReactNode; sub?: ReactNode; v: string; tipo?: 'res' | 'ok' | 'neg' | 'fim' }) {
  return (
    <div className={`${css.l} ${tipo === 'res' || tipo === 'fim' ? css.res : ''} ${tipo === 'fim' ? css.fim : ''} ${tipo === 'neg' ? css.neg : ''} ${tipo === 'ok' ? css.ok : ''}`}>
      <i aria-hidden="true">{op}</i><span>{rot}{sub && <small>{sub}</small>}</span><span className={css.v}>{v}</span>
    </div>
  );
}

/**
 * A conta do mês por extenso, igual para o RH e para o funcionário:
 * previsto → tira as faltas (à parte) → compara com o trabalhado → o que
 * sobrou, o que faltou e quanto um abateu o outro → para onde vai.
 */
export function ContaMes({ conta: c, mes, quem, atual, aoVerRegras }: {
  conta: TConta; mes: string; quem: 'rh' | 'eu'; atual: boolean; aoVerRegras?: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const eu = quem === 'eu';
  const banco = c.destino.tipo === 'BANCO';
  const intraMes = c.destino.formaCalculo === 'INTRA_MES';
  const faltaFora = c.falta.min > 0 && c.falta.destino !== 'BANCO';
  const final = banco ? c.destino.paraBancoMin : c.destino.extraPagaMin - c.destino.atrasoFolhaMin;
  const resumo = <>sobrou {sinal(c.sobrouMin)} · faltou {c.faltouMin ? `−${hm(c.faltouMin)}` : '0h00'}{c.abatidoMin ? ` · ${hm(c.abatidoMin)} abatidas uma pela outra` : ''}</>;
  const diasVisiveis = c.dias.filter((d) => d.destino !== 'ZERO' || d.faltaMin > 0);

  return (
    <section className={css.conta} aria-labelledby="conta-h">
      <div className={css.topo}>
        <h3 id="conta-h">{eu ? `Sua conta de ${mes}` : `Como chegamos no saldo de ${mes}`}</h3>
        {atual ? <span className={css.vivo}>atualizado agora</span> : <span className={css.fechado}>mês encerrado</span>}
      </div>

      <div className={css.tres} role="group" aria-label="Resumo">
        <div className={css.tSob}><small>{eu ? 'Você fez a mais' : 'Sobrou'}</small><b>{sinal(c.sobrouMin)}</b><span>horas a mais que contam</span></div>
        <div className={css.tFal}><small>{eu ? 'Ficou devendo' : 'Faltou'}</small><b>{c.faltouMin ? `−${hm(c.faltouMin)}` : '0h00'}</b><span>atrasos e saídas cedo</span></div>
        <div className={css.tAb}><small>Um abateu o outro</small><b>{hm(c.abatidoMin)}</b>
          <span>{c.abatidoMin > 0 ? (banco ? 'compensados no banco' : 'compensados na semana') : c.faltouMin && c.sobrouMin ? 'não se compensam pela regra' : '—'}</span></div>
      </div>

      <div className={css.linhas}>
        <L rot={eu ? `Combinado até ${dm(c.ate)}` : `Previsto até ${dm(c.ate)}`} sub="pela escala" v={hm(c.previstoMin)} />
        {c.falta.min > 0 && (
          <L op="−" tipo="neg" rot={`${c.falta.dias.length === 1 ? 'Falta' : 'Faltas'} (${listaDias(c.falta.dias)})`} v={hm(c.falta.min)}
            sub={c.falta.destino === 'DESCONTA' ? (eu ? 'descontada no salário, não sai do banco' : 'não entram na conta do banco · descontadas na folha (com DSR)')
              : c.falta.destino === 'BANCO' ? 'abatida do banco (veja abaixo)' : 'abonada: não desconta'} />
        )}
        {c.falta.min > 0 && <L op="=" tipo="res" rot={eu ? 'Combinado nos dias que você veio' : 'Previsto nos dias em que veio'} v={hm(c.previstoDiasVeioMin)} />}
        <L rot={eu ? 'Você trabalhou' : 'Trabalhou'} v={hm(c.trabalhadoMin)} />
        <L op="=" tipo="res" rot="Diferença no relógio" sub="trabalhado − previsto, minuto a minuto" v={sinal(c.diferencaMin)} />
        {c.ajusteMin !== 0 && <L op={c.ajusteMin > 0 ? '+' : '−'} rot="Tolerância" sub={eu ? 'até 5 min por batida (10 por dia) não contam' : 'atrasos e extras pequenos (até 5 min por marcação, 10 por dia) não contam'} v={sinal(c.ajusteMin)} />}
        {c.semanaAbertaMin !== 0 && <L op={c.semanaAbertaMin > 0 ? '−' : '+'} rot="Semana ainda aberta" sub="compensa na semana: entra quando a semana fechar (domingo)" v={sinal(-c.semanaAbertaMin)} />}
        {c.pendentes.dias.length > 0 && <L rot={`${c.pendentes.dias.length} ${c.pendentes.dias.length === 1 ? 'dia' : 'dias'} com batida em aberto (${listaDias(c.pendentes.dias)})`} sub="ficam fora da conta até o ajuste" v="—" />}

        {banco ? (
          <>
            {(c.destino.atrasoFolhaMin > 0 || (c.falta.min > 0 && c.falta.destino === 'BANCO')) && <L op="=" tipo="res" rot="Saldo dos dias trabalhados" sub={resumo} v={sinal(c.resultadoMin)} />}
            {c.falta.min > 0 && c.falta.destino === 'BANCO' && <L op="−" tipo="neg" rot="Faltas abatidas do banco" v={`−${hm(c.falta.min)}`} />}
            {c.destino.atrasoFolhaMin > 0 && <L op="" tipo="neg" rot="Atrasos descontados na folha" sub="pela regra, não abatem do banco" v={`−${hm(c.destino.atrasoFolhaMin)}`} />}
            <L op="→" tipo="fim" rot={intraMes ? (eu ? `Saldo de ${mes}` : `Saldo do mês`) : (eu ? 'Para o seu banco' : `Vai para o banco em ${mes}`)}
              sub={intraMes ? <>{resumo}<br />no fechamento, o que sobrar é pago como extra; o que faltar segue a regra do mês</> : resumo} v={sinal(final)} />
          </>
        ) : (
          <>
            <L op="=" tipo="res" rot={`Saldo de ${mes}`} sub={resumo} v={sinal(c.resultadoMin)} />
            <L op="→" tipo="ok" rot="Hora extra paga na folha" v={c.destino.extraPagaMin ? `+${hm(c.destino.extraPagaMin)}` : '0h00'} />
            <L op="→" tipo="neg" rot={eu ? 'Atraso descontado no salário' : 'Atraso descontado na folha'} v={c.destino.atrasoFolhaMin ? `−${hm(c.destino.atrasoFolhaMin)}` : '0h00'} />
            {c.destino.atrasoToleradoMin > 0 && <L rot="Atraso tolerado (não desconta)" v={hm(c.destino.atrasoToleradoMin)} />}
          </>
        )}
      </div>

      {faltaFora && c.falta.destino === 'DESCONTA' && (
        <div className={css.porque}>
          <b>{eu ? 'Faltou um dia?' : 'Por que a falta não sai do banco?'}</b>
          {eu ? <>Falta de dia inteiro não é tirada {banco ? 'do banco' : 'das horas a mais'}: ela é descontada no salário, junto com o descanso da semana. Atrasos e saídas cedo{banco && c.destino.destinoAtraso === 'BANCO' ? ', sim, abatem do banco.' : ' seguem a regra da empresa.'}</>
            : <>Pela regra de cálculo, falta de dia inteiro é <b>descontada na folha</b> (com o descanso semanal) e <b>não é compensada</b> {banco ? 'com as horas do banco' : 'com as horas a mais'}. Se o combinado é folgar esse dia trabalhando mais na semana, a escala precisa de "Compensa na semana".{aoVerRegras && <> <button type="button" className={css.lk} onClick={aoVerRegras}>Ver como as horas contam →</button></>}</>}
        </div>
      )}

      {diasVisiveis.length > 0 && (
        <div className={css.diaDia}>
          <button type="button" className={css.abrir} aria-expanded={aberto} onClick={() => setAberto((v) => !v)}>
            {aberto ? '▾' : '▸'} Dia a dia: de onde veio cada hora ({diasVisiveis.length} {diasVisiveis.length === 1 ? 'dia' : 'dias'})
          </button>
          {aberto && (
            <div className={css.tabWrap}>
              <table className={css.tab}>
                <thead><tr><th>Dia</th><th className={css.r}>{eu ? 'Combinado' : 'Previsto'}</th><th className={css.r}>Trabalhou</th><th className={css.r}>Diferença</th><th className={css.r}>Contou</th><th>Para onde</th></tr></thead>
                <tbody>
                  {diasVisiveis.map((d) => (
                    <tr key={d.data}>
                      <td>{diaTxt(d.data)}</td>
                      <td className={css.r}>{hm(d.previstoMin)}</td>
                      <td className={css.r}>{d.trabalhadoMin ? hm(d.trabalhadoMin) : '—'}</td>
                      <td className={`${css.r} ${d.brutoMin > 0 ? css.pos : d.brutoMin < 0 ? css.negTxt : ''}`}>{d.destino === 'FALTA' || d.destino === 'PENDENTE' ? '—' : sinal(d.brutoMin)}</td>
                      <td className={`${css.r} ${css.forte}`}>{d.destino === 'FALTA' ? `−${hm(d.faltaMin)}` : d.destino === 'PENDENTE' ? '—' : sinal(d.saldoMin)}</td>
                      <td><span className={`${css.tag} ${css[`t-${DESTINO[d.destino].tom}`]}`}>{d.destino === 'FALTA' ? (c.falta.destino === 'DESCONTA' ? (eu ? 'falta · salário' : 'falta · folha') : c.falta.destino === 'BANCO' ? 'falta · banco' : 'falta · abonada') : DESTINO[d.destino][quem]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
