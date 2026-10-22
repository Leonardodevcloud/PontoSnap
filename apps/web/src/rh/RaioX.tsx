import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Avatar } from '../components/Avatar';
import { ModalPessoa } from '../components/ModalPessoa';
import { acordoEmpresaTxt, hhmm, JORNADA, NIVEL, type RaioX as TRaioX } from '../lib/compensacao';
import cssP from './Prestadores.module.css';
import css from './RaioX.module.css';

const dia = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const NOMES_DIA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const diasTxt = (ds: number[]) => {
  const o = [...ds].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  return o.length === 5 && o.join() === '1,2,3,4,5' ? 'seg a sex' : o.length === 6 && !o.includes(0) ? 'seg a sáb' : o.map((d) => NOMES_DIA[d]).join(', ');
};
const FALTA: Record<string, string> = { DESCONTA: 'desconta (com DSR)', BANCO: 'abate das horas', ABONA: 'abonada' };
const ATRASO: Record<string, string> = { DESCONTA: 'desconta', BANCO: 'abate das horas', TOLERA: 'tolerado' };

/**
 * "Como as horas contam": a cadeia escala → perfil → banco → faltas/atrasos
 * de UM funcionário, do jeito que o motor de cálculo usa, e o efeito em
 * linguagem simples. O elo que causa o problema fica marcado.
 */
export function RaioX({ empregadoId, onFechar, onEscala, onPerfil }: {
  empregadoId: string; onFechar: () => void; onEscala?: () => void; onPerfil?: () => void;
}) {
  const [r, setR] = useState<TRaioX | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { api.get<TRaioX>(`/ajuda/compensacao/${empregadoId}`).then(setR).catch((e) => setErro((e as Error).message)); }, [empregadoId]);

  const primeiro = r?.nome.split(' ')[0] ?? '';
  const erros = r?.alertas.filter((a) => a.gravidade === 'erro') ?? [];
  const avisos = r?.alertas.filter((a) => a.gravidade === 'aviso') ?? [];
  const probEscala = !!r && (!r.escala || r.alertas.some((a) => a.codigo === 'CONTRATO_SEM_COMPENSACAO'));
  const probPerfil = !!r && (r.alertas.some((a) => ['CONTRATO_LEGADO', 'ATRASO_DESCONTA_COM_BANCO'].includes(a.codigo))
    || (r.origemPerfil === 'NENHUM' && r.alertas.some((a) => a.codigo === 'CONTRATO_SEM_COMPENSACAO')));
  const probBanco = !!r && r.alertas.some((a) => a.codigo === 'CONTRATO_SEM_COMPENSACAO') && !r.banco.ativo;

  const veredito = !r ? null : !r.escala
    ? { tom: 'er', tit: `${primeiro} está sem escala`, txt: 'Sem escala o sistema não sabe a carga do dia: não calcula extra, atraso nem falta.' }
    : r.nivel === 'NAO'
      ? { tom: erros.length ? 'er' : 'cz', tit: `As horas de ${primeiro} não compensam entre dias`,
        txt: `Hora a mais num dia é paga como extra; hora a menos em outro é descontada.${r.jornada === 'CONTRATO_HORAS' ? ' O contrato de horas só tira o horário fixo — sozinho, cada dia fecha separado.' : ''}${!r.banco.ativo && r.banco.origem === 'EMPRESA' ? ` O banco vem da empresa, que está ${acordoEmpresaTxt(r.empresa)}.` : ''}` }
      : r.nivel === 'SEMANA'
        ? { tom: 'ok', tit: `As horas de ${primeiro} compensam dentro da semana`, txt: 'Conta o total de segunda a domingo. Passou da carga da semana: extra. Ficou abaixo: atraso. Dia sem batida só vira falta se a semana ficar devendo o dia inteiro.' }
        : r.nivel === 'MES'
          ? { tom: 'ok', tit: `As horas de ${primeiro} compensam dentro do mês`, txt: `Extras e atrasos do mês se anulam. No fechamento, o que sobrar é pago como hora extra; o que faltar ${r.banco.negativoMes === 'CARREGA' ? 'passa para o mês seguinte' : 'é descontado'}.` }
          : { tom: 'ok', tit: `As horas de ${primeiro} acumulam no banco`, txt: `O saldo passa de um mês para o outro para virar folga. Vence em ${r.banco.prazoMeses ?? '?'} meses (acordo ${r.banco.tipoAcordo === 'COLETIVO' ? 'coletivo' : 'individual'}); o vencido é pago.` };

  return (
    <ModalPessoa aberto onFechar={onFechar} largura={1000}
      foto={<Avatar id={empregadoId} nome={r?.nome ?? ''} tamanho={104} />}
      titulo={r?.nome ?? 'Carregando…'}
      meta={r ? <>Como as horas são contadas hoje{r.matricula ? ` · mat. ${r.matricula}` : ''}</> : null}
      chips={r ? <span className={`${cssP.tag} ${cssP[`t-${NIVEL[r.nivel].tom}`]}`}>{NIVEL[r.nivel].rot}</span> : null}
      rodape={<>
        <Link className={cssP.btnTxt} to="/rh/ajuda/compensar-horas" onClick={onFechar}>Ler: fazer as horas compensarem</Link>
        <span style={{ flex: 1 }} />
        {onPerfil && <button type="button" className={cssP.btnSec} onClick={onPerfil}>Trocar perfil</button>}
        {onEscala && <button type="button" className={cssP.btnSec} onClick={onEscala}>Trocar escala</button>}
        <Link className={cssP.btnPri} to={`/rh/ajuda/assistente?emp=${empregadoId}`} onClick={onFechar} data-autofoco>
          {erros.length ? 'Corrigir com o assistente' : 'Mudar com o assistente'}
        </Link>
      </>}>
      {erro && <p className={cssP.erro} role="alert">{erro}</p>}
      {!r && !erro && <div className={css.sk} aria-busy="true"><i /><i /></div>}
      {r && veredito && (
        <div className={css.corpo}>
          <div className={`${css.veredito} ${css[`v-${veredito.tom}`]}`}>
            <span className={css.vIc} aria-hidden="true">{veredito.tom === 'ok' ? '✓' : '!'}</span>
            <div><b>{veredito.tit}</b><span>{veredito.txt}</span></div>
          </div>

          <ol className={css.cadeia} aria-label="De onde vem cada regra">
            <li className={probEscala ? css.prob : ''}>
              <span className={css.q}>1 · Escala</span>
              <b>{r.escala?.codigo ?? 'Nenhuma'}</b>
              {r.escala ? <small>{JORNADA[r.escala.tipo]} · {hhmm(r.escala.cargaSemanaMin)} por semana · {diasTxt(r.escala.diasSemana)} · {r.semana ? <b>compensa na semana</b> : <>não compensa na semana</>}</small>
                : <small>Defina a escala para o ponto ser calculado.</small>}
              {r.proximaEscala && <small className={css.futuro}>Muda para {r.proximaEscala.codigo} em {dia(r.proximaEscala.aPartirDe)}</small>}
              {onEscala && <button type="button" className={css.de} onClick={onEscala}>{r.escala ? 'trocar escala' : 'definir escala'}</button>}
            </li>
            <li className={probPerfil ? css.prob : ''}>
              <span className={css.q}>2 · Perfil de regra</span>
              <b>{r.perfil?.nome ?? 'Nenhum'}</b>
              <small>{r.origemPerfil === 'PROPRIO' ? 'Escolhido para esta pessoa.' : r.origemPerfil === 'PADRAO' ? 'Não tem perfil próprio: usa o padrão da empresa.' : 'Sem perfil próprio e a empresa não tem perfil padrão: vale a CLT pura.'}</small>
              {r.contratoLegado && <small className={css.alertaTxt}>Ainda marca "contrato de horas" (forma antiga).</small>}
              {onPerfil && <button type="button" className={css.de} onClick={onPerfil}>{r.perfil ? 'trocar perfil' : 'escolher perfil'}</button>}
            </li>
            <li className={probBanco ? css.prob : ''}>
              <span className={css.q}>3 · Banco de horas</span>
              <b>{!r.banco.ativo ? 'Sem banco' : r.banco.modo === 'MES' ? 'Compensa no mês' : 'Acumula'}</b>
              <small>{r.banco.origem === 'PERFIL' ? 'Escolhido no perfil.' : `Igual à empresa: ${acordoEmpresaTxt(r.empresa)}.`}
                {r.banco.ativo && r.banco.modo === 'ACUMULA' && ` Vence em ${r.banco.prazoMeses} meses.`}
                {r.banco.ativo && r.banco.modo === 'MES' && ` Mês devendo: ${r.banco.negativoMes === 'CARREGA' ? 'passa para o seguinte' : 'desconta'}.`}</small>
              <Link className={css.de} to="/rh/regras" onClick={onFechar}>ver regras</Link>
            </li>
            <li className={r.alertas.some((a) => a.codigo === 'ATRASO_DESCONTA_COM_BANCO') ? css.prob : ''}>
              <span className={css.q}>4 · Faltas e atrasos</span>
              <b>Atraso {ATRASO[r.destinacao.atrasos]}</b>
              <small>Falta de dia inteiro: {FALTA[r.destinacao.faltas]}.</small>
            </li>
          </ol>

          <div className={css.efeitos} aria-label="Onde compensa">
            {([['dia', 'Dentro do dia', 'atraso e extra do mesmo dia se anulam'], ['semana', 'Na semana', r.niveis.semana ? 'dias da semana se compensam' : 'cada dia fecha sozinho'],
              ['mes', 'No mês', r.niveis.mes ? 'saldos do mês se anulam' : 'extra paga, atraso descontado'], ['acumula', 'Passa de mês', r.niveis.acumula ? 'vira folga depois' : 'não acumula']] as const).map(([k, t, d]) => (
              <div key={k} className={r.niveis[k] ? css.sim : css.nao}><b>{t}</b><span>{r.niveis[k] ? '✓ compensa' : '✕ não'}</span><small>{d}</small></div>
            ))}
          </div>

          {(erros.length > 0 || avisos.length > 0) && (
            <ul className={css.alertas}>
              {[...erros, ...avisos].map((a) => <li key={a.codigo} className={css[`a-${a.gravidade}`]}>{a.texto}</li>)}
            </ul>
          )}

          {r.historico.length > 1 && (
            <details className={css.hist}>
              <summary>Histórico de escala ({r.historico.length})</summary>
              <ul>{r.historico.map((h, i) => <li key={i}><b>{h.codigo}</b> · {h.dataInicio <= '2000-01-01' ? 'desde o início' : `de ${dia(h.dataInicio)}`}{h.dataFim ? ` até ${dia(h.dataFim)}` : ' em diante'}</li>)}</ul>
            </details>
          )}
          <p className={cssP.hint}>Mudou escala ou regra de quem já tem mês fechado? Os meses fechados não mudam sozinhos: abra o mês em Ponto do mês para recalcular.</p>
        </div>
      )}
    </ModalPessoa>
  );
}
