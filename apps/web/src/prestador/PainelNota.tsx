import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { brl, dataBr, dataIsoBr, diaMes, fmtCnpj, passoDe, reais, type Eu, type Nota } from '../lib/prestador';
import css from './Prestador.module.css';

async function paraAreaDeTransferencia(valor: string) {
  try { await navigator.clipboard.writeText(valor); }
  catch {
    const t = document.createElement('textarea'); t.value = valor; document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); } finally { t.remove(); }
  }
}

/** Copia com retorno visual ("✓ Copiado"). */
function Copiar({ rotulo, valor, mostrar }: { rotulo: string; valor: string; mostrar?: string }) {
  const [ok, setOk] = useState(false);
  async function copiar() {
    await paraAreaDeTransferencia(valor);
    setOk(true); setTimeout(() => setOk(false), 1800);
  }
  return (
    <div className={css.copiar}>
      <div><small>{rotulo}</small><span>{mostrar ?? valor}</span></div>
      <button type="button" className={`${css.btnCopiar} ${ok ? css.ok : ''}`} onClick={copiar} aria-label={`Copiar ${rotulo}`}>
        {ok ? '✓ Copiado' : 'Copiar'}
      </button>
      <span className="sr-only" aria-live="polite">{ok ? `${rotulo} copiado` : ''}</span>
    </div>
  );
}

/**
 * O valor de um período (mês do MEI ou semana do motorista): passos, ação
 * principal, confirmação do valor, como chegou no valor e dados para emitir.
 */
export function PainelNota({ eu, nota, onMudou }: { eu: Eu; nota: Nota; onMudou: () => void }) {
  const navegar = useNavigate();
  const passo = passoDe(nota);
  const recusada = nota.status === 'RECUSADA';
  const contestou = nota.confirmacao === 'CONTESTOU' && !nota.resposta;
  const precisaConfirmar = nota.pedirConfirmacao && !nota.confirmacao && nota.status === 'AGUARDANDO';
  const podeEnviar = (nota.status === 'AGUARDANDO' || nota.status === 'RECUSADA') && !contestou && !precisaConfirmar;
  const [contestar, setContestar] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [verDetalhe, setVerDetalhe] = useState(true);
  const mes = nota.periodo === 'MES';

  async function confirmar(confere: boolean) {
    setSalvando(true); setErro(null);
    try {
      await api.post(`/portal/eu/notas/${nota.id}/confirmar`, { confere, motivo: confere ? null : motivo });
      setContestar(false); setMotivo(''); onMudou();
    } catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }

  const passos = ['Fechado', recusada ? 'Recusada' : 'Nota enviada', 'Aprovada', 'Pago'];
  return (
    <>
      {recusada && nota.motivoRecusa && (
        <div className={css.alerta} role="status">
          <b>O RH pediu outra nota</b>{nota.motivoRecusa}
        </div>
      )}
      {nota.resposta && nota.confirmacao === 'CONTESTOU' && (
        <div className={`${css.alerta} ${css.alertaInfo}`}>
          <b>Resposta do RH sobre o valor</b>{nota.resposta}
        </div>
      )}

      <section className={css.hero} aria-label={`${nota.rotulo}: ${brl(nota.valorCent)}`}>
        <small>{nota.rotulo} · {mes ? 'fechado' : 'fechada'}</small>
        <span className={css.valor}>{brl(nota.valorCent)}</span>
        <div className={css.heroLin}>
          <span>Valor da sua nota</span>
          {nota.prazo && !nota.pago && nota.status !== 'APROVADA' && <span>prazo {diaMes(nota.prazo)}</span>}
        </div>
        <div className={css.passos} aria-hidden="true">
          {passos.map((_, i) => <i key={i} className={i < passo ? css.feito : i === 1 && recusada ? css.passoErro : ''} />)}
        </div>
        <div className={css.passosT} aria-hidden="true">{passos.map((p) => <span key={p}>{p}</span>)}</div>
        <span className="sr-only">Passo {passo} de 4: {passos[passo - 1]}</span>
        {podeEnviar && (
          <button type="button" className={css.acaoHero} onClick={() => navegar(`/notas/${nota.id}/enviar`)}>
            {recusada ? 'Enviar a nota corrigida' : mes ? 'Enviar minha nota' : 'Enviar nota desta semana'}
          </button>
        )}
        {nota.status === 'ENVIADA' && <div className={css.estadoHero}>Nota {nota.nf.numero ? `nº ${nota.nf.numero} ` : ''}enviada em {dataIsoBr(nota.enviadaEm)}. O RH confere e você recebe o aviso.</div>}
        {nota.status === 'APROVADA' && !nota.pago && <div className={css.estadoHero}>Nota aprovada. Agora é só aguardar o pagamento{eu.prestador.chavePix ? ` (Pix ${eu.prestador.chavePix})` : ''}.</div>}
        {nota.pago && <div className={css.estadoHero}>Pago em {dataIsoBr(nota.pagoEm)}{nota.valorPagoCent != null ? `: ${brl(nota.valorPagoCent)}` : ''}.</div>}
        {contestou && <div className={css.estadoHero}>Você contestou o valor. O RH vai responder aqui e no celular.</div>}
      </section>

      {precisaConfirmar && !contestar && (
        <div className={css.confirma}>
          <b>O valor confere?</b>
          <p>O RH pediu para você confirmar antes de emitir a nota.</p>
          {erro && <div className={css.erro}>{erro}</div>}
          <div className={css.duoBtn}>
            <button type="button" className={css.btn} disabled={salvando} onClick={() => confirmar(true)}>Confere</button>
            <button type="button" className={css.btn2} disabled={salvando} onClick={() => setContestar(true)}>Não confere</button>
          </div>
        </div>
      )}
      {contestar && (
        <div className={css.confirma}>
          <b>O que não confere?</b>
          <label className="sr-only" htmlFor="motivo">Motivo</label>
          <textarea id="motivo" className={css.area} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={1000}
            placeholder="Ex.: fiz 8h de extra, não 6h" autoFocus />
          {erro && <div className={css.erro}>{erro}</div>}
          <div className={css.duoBtn}>
            <button type="button" className={css.btn} disabled={salvando || motivo.trim().length < 3} onClick={() => confirmar(false)}>Mandar para o RH</button>
            <button type="button" className={css.btn2} onClick={() => setContestar(false)}>Voltar</button>
          </div>
        </div>
      )}

      <section className={css.card}>
        <h3>Como chegou nesse valor</h3>
        {verDetalhe && nota.detalhe.map((l, i) => (
          <div key={i} className={css.lin}>
            <span>{l.rotulo}</span>
            <span className={`${css.mono} ${l.tipo === 'MENOS' ? css.neg : l.tipo === 'MAIS' ? css.pos : ''}`}>
              {l.tipo === 'MENOS' ? '− ' : l.tipo === 'MAIS' ? '+ ' : ''}{brl(l.valorCent)}
            </span>
          </div>
        ))}
        <div className={css.total}><span>Valor da nota</span><span className={css.mono}>{brl(nota.valorCent)}</span></div>
        <div className={css.linksCard}>
          {nota.detalhe.length > 4 && (
            <button type="button" className={css.linkTexto} onClick={() => setVerDetalhe((v) => !v)} aria-expanded={verDetalhe}>{verDetalhe ? 'Esconder detalhes' : 'Ver detalhes'}</button>
          )}
          {!nota.pedirConfirmacao && !nota.confirmacao && nota.status === 'AGUARDANDO' && !contestar && (
            <button type="button" className={css.linkTexto} onClick={() => setContestar(true)}>Não concordo com o valor</button>
          )}
        </div>
      </section>

      {nota.status !== 'APROVADA' && !nota.pago && (
        nota.pedido ? <DadosPedido nota={nota} emissorUrl={eu.emissorUrl} /> : <section className={css.card}>
          <h3>Dados para emitir a nota</h3>
          <Copiar rotulo="Tomador" valor={eu.tomador.nome} />
          {eu.tomador.cnpj && <Copiar rotulo="CNPJ do tomador" valor={eu.tomador.cnpj} mostrar={fmtCnpj(eu.tomador.cnpj)} />}
          {nota.descricao && <Copiar rotulo="Descrição do serviço" valor={nota.descricao} />}
          <Copiar rotulo="Valor" valor={reais(nota.valorCent)} />
          <a className={css.emissor} href={eu.emissorUrl} target="_blank" rel="noopener noreferrer">Abrir o emissor de NFS-e ↗</a>
        </section>
      )}

      {nota.nf.numero && (nota.status === 'APROVADA' || nota.pago) && (
        <section className={css.card}>
          <h3>Sua nota</h3>
          <div className={css.lin}><span>Número</span><span className={css.mono}>{nota.nf.numero}</span></div>
          {nota.nf.data && <div className={css.lin}><span>Emitida em</span><span className={css.mono}>{dataBr(nota.nf.data)}</span></div>}
        </section>
      )}
    </>
  );
}

/** Tudo o que vai na nota (do modelo do RH), cada campo com copiar e o "Copiar tudo". */
function DadosPedido({ nota, emissorUrl }: { nota: Nota; emissorUrl: string }) {
  const p = nota.pedido!;
  const [tudo, setTudo] = useState(false);
  async function copiarTudo() {
    await paraAreaDeTransferencia(nota.textoPedido ?? '');
    setTudo(true); setTimeout(() => setTudo(false), 2200);
  }
  return (
    <section className={css.card}>
      <h3>Dados para emitir a nota</h3>
      <p className={css.dica}>Tudo já preenchido para {nota.periodo === 'MES' ? 'este mês' : 'esta semana'}. Copie cada campo para o emissor ou use "Copiar tudo".</p>
      <Copiar rotulo="CNPJ do tomador" valor={p.tomador.cnpj} mostrar={fmtCnpj(p.tomador.cnpj)} />
      <Copiar rotulo="Razão social" valor={p.tomador.razao} />
      {p.tomador.endereco && <Copiar rotulo="Endereço" valor={p.tomador.endereco} />}
      {p.tomador.telefone && <Copiar rotulo="Telefone" valor={p.tomador.telefone} />}
      {p.tomador.email && <Copiar rotulo="E-mail" valor={p.tomador.email} />}
      {p.codigoServico && <Copiar rotulo="Código do serviço" valor={p.codigoServico} mostrar={`${p.codigoServico}${p.codigoDescricao ? ` — ${p.codigoDescricao}` : ''}`} />}
      <Copiar rotulo="Valor" valor={reais(nota.valorCent)} mostrar={brl(nota.valorCent)} />
      <Copiar rotulo="Descrição" valor={p.descricao} />
      {p.observacao && <p className={css.obsPedido}>{p.observacao}</p>}
      {nota.textoPedido && (
        <button type="button" className={`${css.btn} ${css.btnTudo}`} onClick={copiarTudo}>{tudo ? '✓ Copiado' : 'Copiar tudo'}</button>
      )}
      <span className="sr-only" aria-live="polite">{tudo ? 'Dados da nota copiados' : ''}</span>
      <a className={css.emissor} href={emissorUrl} target="_blank" rel="noopener noreferrer">Abrir o Emissor Nacional ↗</a>
    </section>
  );
}
