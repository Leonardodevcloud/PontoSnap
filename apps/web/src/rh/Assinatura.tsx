import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { MinhaAssinatura, Cobranca } from '../tipos';
import css from './Assinatura.module.css';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (d: string) => new Date(`${d}T12:00:00-0300`).toLocaleDateString('pt-BR');
const fmtComp = (c: string) => {
  const [ano, mes] = c.split('-');
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${meses[Number(mes) - 1]}/${ano}`;
};

export function Assinatura() {
  const [dados, setDados] = useState<MinhaAssinatura | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [avisando, setAvisando] = useState(false);

  const carregar = useCallback(async () => {
    try { setDados(await api.get<MinhaAssinatura>('/minha-assinatura')); }
    catch (e) { setErro((e as Error).message); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function jaPaguei(c: Cobranca) {
    setAvisando(true);
    try { await api.post(`/minha-assinatura/cobrancas/${c.id}/ja-paguei`); void carregar(); }
    catch (e) { setErro((e as Error).message); } finally { setAvisando(false); }
  }

  if (erro) return <div className={css.tela}><p className={css.erro}>{erro}</p></div>;
  if (!dados) return <div className={css.tela}><p className={css.carregando}>carregando…</p></div>;

  if (!dados.assinatura) {
    return (
      <div className={css.tela}>
        <h2 className={css.h}>Sua assinatura</h2>
        <p className={css.semAss}>Sua assinatura ainda não foi configurada. Fale com o suporte do PontoSnap.</p>
      </div>
    );
  }

  const aberto = dados.emAberto;
  const atrasada = aberto?.atrasada;

  return (
    <div className={css.tela}>
      <h2 className={css.h}>Sua assinatura</h2>
      <p className={css.sub}>Plano e situação do PontoSnap na sua empresa.</p>

      <div className={css.cartao}>
        <div className={`${css.status} ${atrasada ? css.stAtraso : css.stOk}`}>
          <span className={css.bola} />
          <span className={css.stTexto}>
            {!aberto ? 'Tudo em dia' : atrasada ? `Atrasada há ${aberto.diasAtraso} dia${aberto.diasAtraso !== 1 ? 's' : ''}` : 'Em aberto'}
          </span>
        </div>

        <div className={css.info}><span className={css.k}>Vencimento</span><span className={css.v}>dia {dados.assinatura.diaVencimento} de cada mês</span></div>
        {aberto && (
          <>
            <div className={css.info}><span className={css.k}>Valor</span><span className={`${css.v} ${css.mono}`}>{brl(aberto.valor)}</span></div>
            <div className={css.info}>
              <span className={css.k}>{atrasada ? 'Venceu em' : 'Vence em'}</span>
              <span className={css.v} style={atrasada ? { color: 'var(--coral-dark)' } : undefined}>{fmtData(aberto.vencimento)}</span>
            </div>
          </>
        )}

        {aberto && (
          <div className={css.boletoBox}>
            {aberto.boletoUrl && (
              <a className={css.btnCoral} href={aberto.boletoUrl} target="_blank" rel="noreferrer">Ver boleto</a>
            )}
            <button className={css.btnGhost} onClick={() => void jaPaguei(aberto)} disabled={avisando || !!aberto.avisoPagamentoEm}>
              {aberto.avisoPagamentoEm ? 'Pagamento avisado' : avisando ? 'Avisando…' : 'Já paguei'}
            </button>
          </div>
        )}
        <p className={css.nota}>
          {aberto?.avisoPagamentoEm
            ? 'Recebemos seu aviso. A confirmação pode levar até 2 dias úteis.'
            : 'Boletos e recibos são enviados por e-mail. Dúvidas? Fale com o suporte do PontoSnap.'}
        </p>
      </div>

      {dados.cobrancas.length > 0 && (
        <div className={css.historico}>
          <h3 className={css.hHist}>Histórico</h3>
          {dados.cobrancas.map((c) => (
            <div key={c.id} className={css.linhaHist}>
              <span className={css.comp}>{fmtComp(c.competencia)}</span>
              <span className={css.valorHist}>{brl(c.valor)}</span>
              <span className={`${css.pill} ${c.status === 'PAGA' ? css.pillPaga : c.atrasada ? css.pillAtraso : css.pillAberta}`}>
                {c.status === 'PAGA' ? 'Pago' : c.atrasada ? 'Atrasado' : 'Em aberto'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
