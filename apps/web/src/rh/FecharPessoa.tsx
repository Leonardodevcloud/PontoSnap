import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { brl, dataBr } from '../lib/prestador';
import type { PessoalDebito, PessoalLinhaMei, PessoalLinhaMot } from '../tipos';
import { ModalPessoa } from '../components/ModalPessoa';
import { Rosto } from './Prestadores';
import css from './FecharPessoa.module.css';

type Motivo = 'DESLIGAMENTO' | 'ANTECIPADO';
export interface PessoaFechar { id: string; nome: string; tipo: 'MEI' | 'MOTORISTA'; empresa: string | null; avatarSemente: number | null }
interface Previa {
  opcoes: { motivo: Motivo; ultimoDia: string | null; proporcional: boolean };
  atual: PessoalLinhaMei | PessoalLinhaMot; congelada: PessoalLinhaMei | PessoalLinhaMot; futurosCent: number; debitosMes: PessoalDebito[];
}

const hojeIso = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const ultimoDoMes = (mes: string) => { const [a, m] = mes.split('-').map(Number) as [number, number]; return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); };
const primeiro = (n: string) => n.trim().split(/\s+/)[0] ?? n;
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const nomeMes = (mes: string) => MESES[Number(mes.slice(5, 7)) - 1] ?? mes;

/**
 * Fechar UMA pessoa com o mês aberto (ex.: desligamento): congela o valor
 * dela, libera a nota e, no desligamento, tira dos meses seguintes. A prévia
 * à direita é recalculada pela API a cada mudança (nada é gravado antes de
 * confirmar).
 */
export function FecharPessoa({ pessoa, mes, motivoInicial = 'DESLIGAMENTO', temApp, onFechar, onFechado }: {
  /** undefined = consulta o acesso da pessoa. */
  pessoa: PessoaFechar; mes: string; motivoInicial?: Motivo; temApp?: boolean;
  onFechar: () => void; onFechado: (msg: string) => void | Promise<void>;
}) {
  const hoje = hojeIso();
  const [motivo, setMotivo] = useState<Motivo>(motivoInicial);
  const [ultimoDia, setUltimoDia] = useState(hoje.startsWith(mes) ? hoje : ultimoDoMes(mes));
  const [proporcional, setProporcional] = useState(true);
  const [liberar, setLiberar] = useState(true);
  const [cortar, setCortar] = useState(false);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const mei = pessoa.tipo === 'MEI';
  const [app, setApp] = useState(!!temApp);
  useEffect(() => {
    if (temApp !== undefined) return;
    api.get<{ status: string }>(`/portal/rh/prestadores/${pessoa.id}/acesso`).then((r) => setApp(r.status === 'ATIVO')).catch(() => {});
  }, [temApp, pessoa.id]);

  const corpo = { pessoaTipo: pessoa.tipo, pessoaId: pessoa.id, competencia: mes, motivo,
    ultimoDia: motivo === 'DESLIGAMENTO' ? ultimoDia : null, proporcional: mei && motivo === 'DESLIGAMENTO' && proporcional };

  useEffect(() => {
    if (motivo === 'DESLIGAMENTO' && !/^\d{4}-\d{2}-\d{2}$/.test(ultimoDia)) return;
    let vivo = true;
    setCarregando(true);
    const t = setTimeout(() => {
      api.post<Previa>('/portal/rh/fechar-pessoa/previa', corpo)
        .then((r) => { if (vivo) { setPrevia(r); setErro(null); } })
        .catch((e) => { if (vivo) { setPrevia(null); setErro((e as Error).message); } })
        .finally(() => { if (vivo) setCarregando(false); });
    }, 220);
    return () => { vivo = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motivo, ultimoDia, proporcional]);

  const c = previa?.congelada;
  const liquido = c ? c.liquidoCent : null;

  async function confirmar() {
    setEnviando(true); setErro(null);
    try {
      const r = await api.post<{ liberacao: { liberadas: number; alteradas: number } | null }>('/portal/rh/fechar-pessoa', { ...corpo, liberarNota: liberar, cortarAcesso: app && cortar });
      const lib = r.liberacao && (r.liberacao.liberadas + r.liberacao.alteradas) > 0;
      await onFechado(`${pessoa.nome} fechado${motivo === 'DESLIGAMENTO' ? ' (desligamento)' : ''} · ${brl(liquido ?? 0)}${lib ? ' · nota liberada' : ''}.`);
    } catch (e) { setErro((e as Error).message); setEnviando(false); }
  }

  return (
    <ModalPessoa aberto onFechar={onFechar} compacto largura={940}
      foto={<Rosto id={pessoa.id} semente={pessoa.avatarSemente} tamanho={64} />}
      titulo={pessoa.nome}
      meta={<><span className={css.passo}>Fechar só esta pessoa · {nomeMes(mes)}</span> · {mei ? 'MEI' : 'Motorista'}{pessoa.empresa ? ` · ${pessoa.empresa}` : ''}</>}
      rodape={<>
        <button type="button" className={css.btn2} onClick={onFechar}>Cancelar</button>
        <span className={css.esp} />
        {erro && <span className={css.erroRod} role="alert">{erro}</span>}
        <button type="button" className={css.btn1} disabled={enviando || carregando || !c} onClick={confirmar} data-autofoco>
          {enviando ? 'Fechando…' : `Fechar ${primeiro(pessoa.nome)}${liquido != null ? ` · ${brl(liquido)}` : ''}`}
        </button>
      </>}>
      <div className={css.grade}>
        <div className={css.col}>
          <fieldset className={css.grupo}>
            <legend>Por que fechar agora?</legend>
            <label className={`${css.op} ${motivo === 'DESLIGAMENTO' ? css.on : ''}`}>
              <input type="radio" name="motivo" checked={motivo === 'DESLIGAMENTO'} onChange={() => setMotivo('DESLIGAMENTO')} />
              <span><b>Desligamento</b><small>Último pagamento. Sai dos próximos meses; o histórico continua.</small></span>
            </label>
            <label className={`${css.op} ${motivo === 'ANTECIPADO' ? css.on : ''}`}>
              <input type="radio" name="motivo" checked={motivo === 'ANTECIPADO'} onChange={() => setMotivo('ANTECIPADO')} />
              <span><b>Pagar antes do fechamento</b><small>Congela o valor de {nomeMes(mes)} e continua ativo nos próximos meses.</small></span>
            </label>
          </fieldset>

          {motivo === 'DESLIGAMENTO' && (
            <div className={css.duo}>
              <div className={css.campo}>
                <label htmlFor="fp-ultimo">Último dia trabalhado</label>
                <input id="fp-ultimo" type="date" value={ultimoDia} min={`${mes}-01`} max={ultimoDoMes(mes)} onChange={(e) => setUltimoDia(e.target.value)} />
              </div>
              {mei && (
                <div className={css.campo}>
                  <span className={css.rot} id="fp-prop">Valor do contrato</span>
                  <div className={css.tog} role="group" aria-labelledby="fp-prop">
                    <button type="button" aria-pressed={proporcional} onClick={() => setProporcional(true)}>Proporcional</button>
                    <button type="button" aria-pressed={!proporcional} onClick={() => setProporcional(false)}>Mês cheio</button>
                  </div>
                </div>
              )}
            </div>
          )}

          <label className={`${css.op} ${liberar ? css.on : ''}`}>
            <input type="checkbox" checked={liberar} onChange={(e) => setLiberar(e.target.checked)} />
            <span><b>Liberar a nota para {mei ? 'emitir' : 'as semanas'} agora</b>
              <small>{app ? 'Recebe o aviso no celular e envia a nota pelo app.' : 'Sem app: o RH sobe a nota pela Folha e benefícios.'}</small></span>
          </label>
          {app && motivo === 'DESLIGAMENTO' && (
            <label className={`${css.op} ${cortar ? css.on : ''}`}>
              <input type="checkbox" checked={cortar} onChange={(e) => setCortar(e.target.checked)} />
              <span><b>Cortar o acesso ao app depois do pagamento</b><small>Até lá, consegue enviar a nota e ver o pagamento.</small></span>
            </label>
          )}
        </div>

        <section className={css.card} aria-live="polite" aria-busy={carregando}>
          <h4>Valor que vai ser congelado</h4>
          {!c && carregando && <div className={css.sk}><i /><i /><i /><i /></div>}
          {!c && !carregando && <p className={css.vazio}>{erro ?? 'Sem prévia.'}</p>}
          {c && (mei ? <ResumoMei m={c as PessoalLinhaMei} futuros={previa!.futurosCent} /> : <ResumoMot m={c as PessoalLinhaMot} futuros={previa!.futurosCent} />)}
          {c && previa!.futurosCent > 0 && (
            <p className={css.aviso}>No desligamento, as parcelas de débito que ainda iam cair ({brl(previa!.futurosCent)}) são descontadas agora. Para não descontar, ajuste o débito na aba Débitos antes de fechar.</p>
          )}
        </section>
      </div>
    </ModalPessoa>
  );
}

function L({ k, v, neg, tot }: { k: string; v: string; neg?: boolean; tot?: boolean }) {
  return <div className={`${css.lin} ${tot ? css.tot : ''} ${neg ? css.neg : ''}`}><span>{k}</span><span>{v}</span></div>;
}

function ResumoMei({ m, futuros }: { m: PessoalLinhaMei; futuros: number }) {
  const p = m.proporcional;
  return (
    <>
      <L k={p ? `Contrato · proporcional ${p.dias} de ${p.diasMes} dias` : 'Contrato · mês cheio'} v={brl(p ? p.contratoCent : m.valorCent)} />
      {m.heCent > 0 && <L k="Horas extras" v={`+ ${brl(m.heCent)}`} />}
      {m.feriadosCent > 0 && <L k="Feriados trabalhados" v={`+ ${brl(m.feriadosCent)}`} />}
      {m.faltasCent > 0 && <L k="Faltas" v={`− ${brl(m.faltasCent)}`} neg />}
      {m.lanc.metaCent > 0 && <L k="Meta" v={`+ ${brl(m.lanc.metaCent)}`} />}
      <L k="Débitos do mês" v={m.debitosCent - futuros > 0 ? `− ${brl(m.debitosCent - futuros)}` : '—'} neg={m.debitosCent - futuros > 0} />
      {futuros > 0 && <L k="· parcelas futuras de débito" v={`− ${brl(futuros)}`} neg />}
      {m.metaDescontadaCent > 0 && <L k="Meta já paga" v={`− ${brl(m.metaDescontadaCent)}`} neg />}
      <L k="Líquido a pagar" v={brl(m.liquidoCent)} tot />
    </>
  );
}

function ResumoMot({ m, futuros }: { m: PessoalLinhaMot; futuros: number }) {
  const sems = m.semanas.filter((s) => s.dias > 0);
  return (
    <>
      {sems.map((s) => <L key={s.inicio} k={`Semana ${dataBr(s.inicio).slice(0, 5)} · ${s.dias} ${s.dias === 1 ? 'dia' : 'dias'}`} v={brl(s.totalCent)} />)}
      {sems.length === 0 && <L k="Nenhum dia trabalhado no mês" v="—" />}
      <L k="Débitos do mês" v={m.debitosCent - futuros > 0 ? `− ${brl(m.debitosCent - futuros)}` : '—'} neg={m.debitosCent - futuros > 0} />
      {futuros > 0 && <L k="· parcelas futuras de débito" v={`− ${brl(futuros)}`} neg />}
      <L k="Líquido a pagar" v={brl(m.liquidoCent)} tot />
      {m.debitosCent > 0 && <p className={css.nota}>Os débitos saem das últimas semanas trabalhadas.</p>}
    </>
  );
}
