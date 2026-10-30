import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { minutosParaHhMm } from '../lib/formato';
import type { BancoResp } from '../tipos';
import { Explica } from '../components/Explica';
import css from './MeuBanco.module.css';

const fmtData = (d: string) => new Date(`${d}T12:00:00-0300`).toLocaleDateString('pt-BR');

const ROTULO: Record<string, string> = {
  CREDITO: 'Hora extra',
  DEBITO: 'Compensação',
  PAGAMENTO: 'Pago na folha',
  AJUSTE: 'Ajuste do RH',
};

function comSinal(min: number): string {
  const s = minutosParaHhMm(Math.abs(min));
  return `${min > 0 ? '+' : min < 0 ? '−' : ''}${s}`;
}

export function MeuBanco() {
  const [dados, setDados] = useState<BancoResp | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try { setDados(await api.get<BancoResp>('/marcacao/meu-banco')); }
      catch (e) { setErro((e as Error).message); }
    })();
  }, []);

  if (erro) return <div className="appshell"><p className={css.erro}>{erro}</p></div>;
  if (!dados) return <div className="appshell"><div className={css.vazio}>Carregando…</div></div>;

  // Sem acordo não existe banco de horas — e dizer isso é mais honesto que
  // mostrar um saldo que não tem respaldo nenhum.
  if (!dados.ativo || !dados.saldo) {
    return (
      <div className="appshell">
        <div className={css.h}>Banco de horas</div>
        <div className={css.semAcordo}>
          <b>Sua empresa não usa banco de horas</b>
          <p>
            Suas horas extras são pagas na folha, com o adicional da lei.
            Veja o mês em <strong>Meu espelho</strong>.
          </p>
        </div>
      </div>
    );
  }

  const s = dados.saldo;
  const acordo = dados.tipoAcordo === 'COLETIVO' ? 'Acordo coletivo' : 'Acordo individual';
  const intraMes = dados.formaCalculo === 'INTRA_MES';

  // Saldo oficial (meses fechados) + o mês em andamento = o que a pessoa
  // realmente tem. Antes a tela só mostrava o mês corrente se o oficial
  // fosse zero, e parecia que as horas sumiam depois do primeiro fechamento.
  const mesCorrente = dados.mesCorrente;
  const projetado = dados.saldoProjetadoMin ?? s.saldoMin;
  const rotuloMes = mesCorrente
    ? new Date(`${mesCorrente.competencia}-01T12:00:00-0300`).toLocaleDateString('pt-BR', { month: 'long' })
    : '';

  return (
    <div className="appshell">
      <div className={css.h}>
        Banco de horas
        <Explica lado="dir">{acordo} · {intraMes ? 'compensa no mês e paga a diferença.' : `compensar em até ${dados.prazoMeses} meses.`}</Explica>
      </div>

      <div className={css.resumo}>
        <div className={css.rL}>
          {intraMes ? `Saldo de ${rotuloMes || 'este mês'} até agora` : 'Saldo do banco'}
          {intraMes && (
            <Explica>
              {s.saldoMin < 0 && <>Veio devendo do mês anterior: <b>{comSinal(s.saldoMin)}</b> (já está na conta). </>}
              No fim do mês, o que sobrar é <b>pago na folha</b> como hora extra; se faltar,
              {dados.negativoMes === 'CARREGA' ? ' passa para o mês seguinte.' : ' é descontado na folha.'}
            </Explica>
          )}
        </div>
        <div className={`${css.rV} ${(intraMes ? projetado : s.saldoMin) < 0 ? css.rVneg : ''}`}>{comSinal(intraMes ? projetado : s.saldoMin)}</div>
        {mesCorrente && !intraMes && (
          <div className={css.soma}>
            <div><span>Saldo do banco (meses fechados)</span><b>{comSinal(s.saldoMin)}</b></div>
            <div><span>+ {rotuloMes} até agora</span><b>{comSinal(mesCorrente.estimadoMin)}</b></div>
            <div className={css.somaTot}>
              <span>= se o mês fechasse hoje <Explica>{rotuloMes} entra no saldo no dia 1º. Até lá, cada batida atualiza a previsão. A conta completa está em Meu espelho.</Explica></span>
              <b className={projetado < 0 ? css.neg : ''}>{comSinal(projetado)}</b>
            </div>
          </div>
        )}
        <div className={css.mini}>
          <div>
            <div className={css.mL}>Creditado</div>
            <div className={css.mV}>+{minutosParaHhMm(s.creditadoMin)}</div>
          </div>
          <div>
            <div className={css.mL}>Compensado</div>
            <div className={css.mV}>−{minutosParaHhMm(s.compensadoMin)}</div>
          </div>
          {s.pagoMin > 0 && (
            <div>
              <div className={css.mL}>Pago</div>
              <div className={css.mV}>{minutosParaHhMm(s.pagoMin)}</div>
            </div>
          )}
        </div>
      </div>

      {/* Um aviso por vez: o mais grave vira faixa; os outros, uma linha com "?". */}
      {(() => {
        const avisos: { curto: React.ReactNode; longo: React.ReactNode; grave?: boolean }[] = [];
        // O prazo é a informação que mais importa: saldo sem data engana.
        if (s.vencidoMin > 0) avisos.push({ grave: true,
          curto: <><b>{minutosParaHhMm(s.vencidoMin)}</b> passaram do prazo de compensação</>,
          longo: <>Pela lei, essas horas viram hora extra e a empresa paga em dinheiro, com adicional. Fale com o RH.</> });
        if (s.devedorMin > 0) avisos.push({
          curto: <>Você compensou <b>{minutosParaHhMm(s.devedorMin)}</b> a mais do que tinha</>,
          longo: <>Você compensou {minutosParaHhMm(s.devedorMin)} a mais do que tinha no banco. Essas horas voltam a zero conforme você faz extra.</> });
        if (s.vencidoMin === 0 && s.aVencerMin > 0 && s.proximoVencimento) avisos.push({
          curto: <><b>{minutosParaHhMm(s.aVencerMin)}</b> vencem em <b>{fmtData(s.proximoVencimento)}</b></>,
          longo: <>O que não for compensado até lá vira hora extra paga.</> });
        if (dados.conta && dados.conta.falta.min > 0 && dados.conta.falta.destino === 'DESCONTA') {
          const c = dados.conta;
          avisos.push({
            curto: <>Falta é descontada no salário, não no banco</>,
            longo: <>Falta de dia inteiro não é tirada do banco: ela é descontada no salário, junto com o descanso da semana
              {c.falta.dias.length ? ` (este mês: ${c.falta.dias.map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`).join(', ')})` : ''}.
              {c.destino.destinoAtraso === 'BANCO' ? ' Atrasos e saídas cedo, sim, abatem do banco.' : ''}</> });
        }
        const [primeiro, ...resto] = avisos;
        return (
          <>
            {primeiro && (
              <div className={`${css.prazo} ${primeiro.grave ? css.prazoVencido : ''}`}>
                {primeiro.curto}. {primeiro.longo}
              </div>
            )}
            {resto.map((a, i) => (
              <div key={i} className={css.nota}>{a.curto} <Explica lado="dir">{a.longo}</Explica></div>
            ))}
            {!primeiro && s.proximoVencimento && (
              <div className={css.prazoOk}>Próximo vencimento em <b>{fmtData(s.proximoVencimento)}</b>.</div>
            )}
          </>
        );
      })()}

      <div className={css.hExtrato}>Extrato</div>
      {dados.extrato.length === 0 && <div className={css.vazio}>Nenhum movimento ainda.</div>}
      {dados.extrato.map((m, i) => (
        <div key={`${m.data}-${i}`} className={css.ext}>
          <div>
            <div className={css.extE}>{m.descricao || ROTULO[m.tipo] || m.tipo}</div>
            <div className={css.extD}>{fmtData(m.data)}{m.competencia ? ' · fechamento do mês' : ''}</div>
          </div>
          <div className={`${css.extV} ${m.minutos > 0 ? css.pos : css.neg}`}>{comSinal(m.minutos)}</div>
        </div>
      ))}
    </div>
  );
}
