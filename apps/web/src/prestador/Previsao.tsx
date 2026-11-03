import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { brl, diaMes, type Previsao, type SemanaPrevisao } from '../lib/prestador';
import { Explica } from '../components/Explica';
import css from './Prestador.module.css';

const SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const nomeMes = (c: string) => MESES[Number(c.slice(5, 7)) - 1]!;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const somaDia = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dow = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;

type Fase = 'passada' | 'atual' | 'futura';
const faseDe = (s: SemanaPrevisao, hoje: string): Fase => (s.fim < hoje ? 'passada' : s.inicio <= hoje ? 'atual' : 'futura');

/**
 * Previsão do mês no app do prestador: quanto vai emitir em cada semana
 * (motorista) ou no mês (MEI), pela escala e pelos feriados. Os débitos saem
 * do pagamento, não da nota.
 */
export function PrevisaoPrestador() {
  const [mes, setMes] = useState<string | null>(null);
  const [d, setD] = useState<Previsao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    setErro(null);
    api.get<Previsao>(`/portal/eu/previsao${mes ? `?mes=${mes}` : ''}`)
      .then((r) => { if (vivo) setD(r); })
      .catch((e) => { if (vivo) setErro((e as Error).message); });
    return () => { vivo = false; };
  }, [mes]);

  if (erro && !d) return <p className={css.erro}>{erro}</p>;
  if (!d) return <div className={css.esqueleto} aria-busy="true" />;

  return (
    <>
      {d.meses.length > 1 && (
        <div className={css.segMes} role="group" aria-label="Mês da previsão">
          {d.meses.map((m) => (
            <button key={m} type="button" aria-pressed={m === d.competencia} onClick={() => setMes(m)}>{cap(nomeMes(m))}</button>
          ))}
        </div>
      )}
      {!d.noMes ? (
        <div className={css.vazio}>
          <b>Sem previsão para {nomeMes(d.competencia)}</b>
          <p>Você não está no fechamento deste mês. Se isso estiver errado, fale com o RH.</p>
        </div>
      ) : d.tipo === 'MOTORISTA' ? <PrevisaoMotorista d={d} /> : <PrevisaoMei d={d} />}
      <p className={css.rodPrev}>Previsão pela sua escala ({d.noMes && d.baseDias === 'SEG_SEX' ? 'seg–sex' : 'seg–sáb'}, sem feriados). O valor certo sai quando o RH fecha{d.tipo === 'MOTORISTA' ? ' cada semana' : ' o mês'}: faltas, adicionais e débitos podem mudar.</p>
    </>
  );
}

function PrevisaoMotorista({ d }: { d: Extract<Previsao, { tipo: 'MOTORISTA'; noMes: true }> }) {
  const navegar = useNavigate();
  const fases = d.semanas.map((s) => faseDe(s, d.hoje));
  const dias = d.semanas.reduce((a, s) => a + s.dias, 0);
  const temAtual = fases.includes('atual');
  const temPaga = d.semanas.some((s) => s.pago);
  return (
    <>
      <section className={css.hero} aria-label={`${d.rotulo}: ${brl(d.nfCent)} em notas`}>
        <small>{d.rotulo} · {d.fechado ? 'fechado' : 'previsão'}</small>
        <span className={css.valor}>{brl(d.nfCent)}</span>
        <div className={css.heroLin}><span>em {plural(d.semanas.length, 'nota semanal', 'notas semanais')} · {plural(dias, 'dia', 'dias')}</span></div>
        <div className={css.barraPrev} aria-hidden="true">
          {d.semanas.map((s, i) => (
            <i key={s.inicio} style={{ flex: Math.max(1, s.nfCent) }}
              className={s.pago ? css.bPaga : fases[i] === 'atual' ? css.bAtual : fases[i] === 'passada' ? css.bPassada : ''} />
          ))}
        </div>
        <div className={css.legPrev} aria-hidden="true">
          {temPaga && <span className={css.lPaga}>pagas</span>}
          {temAtual && <span className={css.lAtual}>esta semana</span>}
          <span>próximas</span>
        </div>
        {d.debitosCent > 0 && (
          <>
            <div className={css.heroRecebe}><span>Você deve receber</span><b>{brl(d.recebeCent)}</b>
              <small>{d.debitos.map((x) => `${x.descricao} ${brl(x.valorCent)}`).join(' · ')} sai do pagamento, não da nota{d.debitoPendenteCent > 0 ? ' (o RH escolhe a semana na hora de pagar)' : ''}.</small>
            </div>
          </>
        )}
      </section>

      <div className={css.secaoPrev}><span>Semana a semana</span>
        <Explica lado="dir">Cada semana vira uma nota. O valor é dias × diária ({brl(d.diariaCent)}), mais adicionais. A nota de uma semana pode ser emitida no dia seguinte ao fim dela, quando o RH fechar.</Explica>
      </div>
      {d.semanas.map((s, i) => (
        <SemanaCard key={s.inicio} s={s} fase={fases[i]!} d={d} onAbrir={s.nota ? () => navegar(`/notas/${s.nota!.id}`) : undefined} />
      ))}
    </>
  );
}

function SemanaCard({ s, fase, d, onAbrir }: { s: SemanaPrevisao; fase: Fase; d: Extract<Previsao, { tipo: 'MOTORISTA'; noMes: true }>; onAbrir?: () => void }) {
  const viraMes = s.fim.slice(0, 7) !== d.competencia || s.inicio.slice(0, 7) !== d.competencia;
  const sub = [
    viraMes ? `${plural(s.dias, 'dia', 'dias')} em ${nomeMes(d.competencia)}` : fase === 'futura' ? plural(s.dias, 'dia previsto', 'dias previstos') : plural(s.dias, 'dia', 'dias'),
    s.dias !== s.diasAuto ? `previsto ${s.diasAuto}` : null,
    s.feriados.length ? `feriado ${s.feriados.map(diaMes).join(', ')}` : null,
  ].filter(Boolean).join(' · ');
  const situacao = s.pago ? 'paga'
    : s.nota?.status === 'RECUSADA' ? null
    : s.nota?.status === 'ENVIADA' ? 'nota enviada'
    : s.nota?.status === 'APROVADA' ? 'aprovada'
    : s.nota ? 'pronta para emitir'
    : fase === 'passada' ? 'esperando o RH fechar'
    : `emitir em ${diaMes(somaDia(s.fim, 1))}`;
  const conteudo = (
    <>
      <div className={css.semTopo}>
        <div>
          <b>{diaMes(s.inicio)} a {diaMes(s.fim)}</b>
          {fase === 'atual' ? <span className={`${css.tag} ${css.tagAtual}`}>esta semana</span>
            : s.nota?.status === 'RECUSADA' ? <span className={`${css.tag} ${css['t-er']}`}>refazer nota</span>
            : s.nota?.status === 'AGUARDANDO' && !s.pago ? <span className={`${css.tag} ${css['t-av']}`}>falta enviar</span>
            : <small>{sub}</small>}
        </div>
        <div className={css.semDir}>
          <strong>{brl(s.nfCent)}</strong>
          <span>{fase === 'atual' ? `${plural(s.dias, 'dia', 'dias')} × ${brl(d.diariaCent)}` : situacao}</span>
        </div>
      </div>
      {fase === 'atual' && <DiasDaSemana s={s} d={d} />}
      {fase === 'atual' && <p className={css.notaPrev}>{sub}. A nota desta semana fica pronta para emitir a partir de <b>{SEM[dow(somaDia(s.fim, 1))]}, {diaMes(somaDia(s.fim, 1))}</b>.</p>}
      {s.adicionalCent > 0 && <div className={css.linPrev}><span>Adicionais</span><b>+ {brl(s.adicionalCent)}</b></div>}
      {s.debitoCent > 0 && <>
        <div className={css.linPrev}><span>Débito descontado</span><b className={css.neg}>− {brl(s.debitoCent)}</b></div>
        <div className={css.linPrev}><span>Você recebe</span><b>{brl(s.recebeCent)}</b></div>
      </>}
      {viraMes && fase !== 'atual' && <p className={css.notaPrev}>{s.fim.slice(0, 7) !== d.competencia ? `O resto da semana entra na previsão de ${nomeMes(s.fim.slice(0, 7))}.` : `O começo da semana ficou em ${nomeMes(s.inicio.slice(0, 7))}.`}</p>}
    </>
  );
  const cls = `${css.semPrev} ${fase === 'atual' ? css.semAtual : ''} ${fase === 'passada' && s.pago ? css.semFeita : ''}`;
  return onAbrir
    ? <button type="button" className={cls} onClick={onAbrir} aria-label={`Semana ${diaMes(s.inicio)} a ${diaMes(s.fim)}: ${brl(s.nfCent)}. Abrir a nota.`}>{conteudo}</button>
    : <section className={cls}>{conteudo}</section>;
}

function DiasDaSemana({ s, d }: { s: SemanaPrevisao; d: Extract<Previsao, { tipo: 'MOTORISTA'; noMes: true }> }) {
  const datas = Array.from({ length: 7 }, (_, i) => somaDia(s.inicio, i));
  const noMes = new Set(s.diasNoMes);
  const fer = new Set(s.feriados);
  return (
    <div className={css.diasPrev} role="list" aria-label="Dias da semana">
      {datas.map((x) => {
        const w = dow(x);
        const tipo = !noMes.has(x) ? 'fora' : fer.has(x) ? 'fer' : (w === 0 || (w === 6 && d.baseDias === 'SEG_SEX')) ? 'folga' : 'prev';
        const hoje = x === d.hoje && tipo === 'prev';
        const rot = tipo === 'fer' ? 'feriado' : tipo === 'folga' ? 'folga' : tipo === 'fora' ? 'outro mês' : hoje ? 'hoje' : x < d.hoje ? 'já passou' : 'previsto';
        return (
          <div key={x} role="listitem" title={`${diaMes(x)} · ${rot}`} aria-label={`${SEM[w]} ${diaMes(x)}: ${rot}`}
            className={`${css.diaP} ${hoje ? css.dHoje : css[`d_${tipo}`] ?? ''} ${tipo === 'prev' && x < d.hoje ? css.dPassou : ''}`}>
            {x.slice(8, 10)}<small>{tipo === 'fer' ? 'feriado' : SEM[w]}</small>
          </div>
        );
      })}
    </div>
  );
}

function PrevisaoMei({ d }: { d: Extract<Previsao, { tipo: 'MEI'; noMes: true }> }) {
  const navegar = useNavigate();
  const proxMes = (() => { const x = new Date(`${d.competencia}-15T12:00:00Z`); x.setUTCMonth(x.getUTCMonth() + 1); return x.toISOString().slice(0, 7); })();
  const desconto = d.nfCent - d.recebeCent;
  return (
    <>
      <section className={css.hero} aria-label={`${d.rotulo}: nota de ${brl(d.nfCent)}`}>
        <small>{d.rotulo} · {d.fechado || d.fechadoIndividual ? 'fechado' : 'previsão'}</small>
        <span className={css.valor}>{brl(d.nfCent)}</span>
        <div className={css.heroLin}><span>1 nota · emitir a partir de 01/{proxMes.slice(5, 7)}</span></div>
        {desconto > 0 && (
          <div className={css.heroRecebe}><span>Você deve receber</span><b>{brl(d.recebeCent)}</b>
            <small>{d.debitos.length ? `${d.debitos.map((x) => `${x.descricao} ${brl(x.valorCent)}`).join(' · ')} sai do pagamento, não da nota.` : 'Os descontos saem do pagamento, não da nota.'}</small>
          </div>
        )}
        {d.nota && <button type="button" className={css.acaoHero} onClick={() => navegar(`/notas/${d.nota!.id}`)}>Ver a nota do mês</button>}
      </section>
      <section className={css.card}>
        <h3>Como fica o mês</h3>
        <div className={css.lin}><span>Contrato</span><span className={css.mono}>{brl(d.contratoCent)}</span></div>
        <div className={css.lin}><span>{d.diasMes} dias ({d.baseDias === 'SEG_SAB' ? 'seg–sáb' : 'seg–sex'}, sem feriados)</span><span className={css.mono}>{brl(d.valorDiaCent)}/dia</span></div>
        {d.nfCent !== d.contratoCent && <div className={css.lin}><span>Extras, faltas e meta lançados até agora</span><span className={css.mono}>{d.nfCent > d.contratoCent ? '+ ' : '− '}{brl(Math.abs(d.nfCent - d.contratoCent))}</span></div>}
        <div className={css.total}><span>Valor da nota</span><span className={css.mono}>{brl(d.nfCent)}</span></div>
      </section>
    </>
  );
}
