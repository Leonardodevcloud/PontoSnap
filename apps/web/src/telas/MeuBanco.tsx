import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { minutosParaHhMm } from '../lib/formato';
import type { BancoResp } from '../tipos';
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

  return (
    <div className="appshell">
      <div className={css.h}>Banco de horas</div>
      <div className={css.s}>{acordo} · compensar em até {dados.prazoMeses} meses</div>

      <div className={css.resumo}>
        <div className={css.rL}>Saldo acumulado</div>
        <div className={`${css.rV} ${s.saldoMin < 0 ? css.rVneg : ''}`}>{comSinal(s.saldoMin)}</div>
        <div className={css.mini}>
          <div>
            <div className={css.mL}>Creditado</div>
            <div className={`${css.mV} ${css.pos}`}>+{minutosParaHhMm(s.creditadoMin)}</div>
          </div>
          <div>
            <div className={css.mL}>Compensado</div>
            <div className={`${css.mV} ${css.neg}`}>−{minutosParaHhMm(s.compensadoMin)}</div>
          </div>
          {s.pagoMin > 0 && (
            <div>
              <div className={css.mL}>Pago</div>
              <div className={css.mV}>{minutosParaHhMm(s.pagoMin)}</div>
            </div>
          )}
        </div>
      </div>

      {/* O prazo é a informação que mais importa: saldo sem data engana. */}
      {s.vencidoMin > 0 && (
        <div className={`${css.prazo} ${css.prazoVencido}`}>
          <b>{minutosParaHhMm(s.vencidoMin)}</b> passaram do prazo de compensação.
          Pela lei, essas horas viram hora extra e a empresa paga em dinheiro,
          com adicional. Fale com o RH.
        </div>
      )}

      {s.vencidoMin === 0 && s.aVencerMin > 0 && s.proximoVencimento && (
        <div className={css.prazo}>
          ⏳ <b>{minutosParaHhMm(s.aVencerMin)}</b> vencem em <b>{fmtData(s.proximoVencimento)}</b>.
          O que não for compensado até lá vira hora extra paga.
        </div>
      )}

      {s.vencidoMin === 0 && s.aVencerMin === 0 && s.proximoVencimento && (
        <div className={css.prazoOk}>
          Próximo vencimento em <b>{fmtData(s.proximoVencimento)}</b>.
        </div>
      )}

      {s.devedorMin > 0 && (
        <div className={css.prazo}>
          Você compensou <b>{minutosParaHhMm(s.devedorMin)}</b> a mais do que tinha no banco.
          Essas horas voltam a zero conforme você faz extra.
        </div>
      )}

      <div className={css.hExtrato}>Extrato</div>
      {dados.extrato.length === 0 && <div className={css.vazio}>Nenhum movimento ainda.</div>}
      {dados.extrato.map((m, i) => (
        <div key={`${m.data}-${i}`} className={css.ext}>
          <div>
            <div className={css.extE}>{m.descricao || ROTULO[m.tipo] || m.tipo}</div>
            <div className={css.extD}>{fmtData(m.data)}</div>
          </div>
          <div className={`${css.extV} ${m.minutos > 0 ? css.pos : css.neg}`}>{comSinal(m.minutos)}</div>
        </div>
      ))}
    </div>
  );
}
