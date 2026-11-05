import { useEffect, useMemo, useState } from 'react';
import { brl, dataIsoBr, diaMes, type LinhaRh, type PainelRh, type UnidadeRh } from '../lib/prestador';
import { normalizarChave } from '../lib/pix';
import { Rosto } from './Prestadores';
import css from './Prestadores.module.css';
import v from './PrestadoresVisoes.module.css';

const SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const dow = (d: string) => SEM[new Date(`${d}T12:00:00Z`).getUTCDay()]!;
const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;
const ROT_CHAVE = { CPF: 'CPF', CNPJ: 'CNPJ', TELEFONE: 'celular', EMAIL: 'e-mail', ALEATORIA: 'chave aleatória' } as const;

/** Liberada ao RH pagar: aprovada na conferência, ou nota que o próprio RH lançou. */
export const autorizada = (u: UnidadeRh) => !u.pago && (u.situacao === 'APROVADA' || u.situacao === 'RH');
const nfDe = (u: UnidadeRh) => u.nfCent ?? u.valorCent;

export type PassoEsteira = 'FECHAR' | 'NOTA' | 'CONFERIR' | 'PAGAR';

/**
 * Os 4 passos do fechamento de prestadores, com o que está parado em cada um.
 * Clicar leva para o lugar de resolver.
 */
export function Esteira({ d, tipo, onPasso }: { d: PainelRh; tipo: 'MEI' | 'MOTORISTA'; onPasso: (p: PassoEsteira) => void }) {
  const us = d.linhas.filter((l) => l.tipo === tipo).flatMap((l) => l.unidades);
  const semanasProntas = d.semanas.filter((s) => s.encerrada && !s.liberada && s.motoristas > 0);
  const proxima = d.semanas.find((s) => !s.encerrada && s.motoristas > 0);
  const faltam = us.filter((u) => u.nota && (u.situacao === 'FALTA' || u.situacao === 'RECUSADA'));
  const atrasadas = faltam.filter((u) => u.atrasada).length;
  const conferir = us.filter((u) => u.situacao === 'CONFERIR' || u.situacao === 'CONTESTOU');
  const pagar = us.filter(autorizada);

  const p1 = tipo === 'MOTORISTA'
    ? semanasProntas.length
      ? { v: plural(semanasProntas.length, 'semana', 'semanas'), s: semanasProntas.map((s) => `${diaMes(s.inicio)} a ${diaMes(s.fim)}`).join(' · '), ativo: true }
      : { v: 'em dia', s: proxima ? `próxima: ${diaMes(proxima.inicio)} a ${diaMes(proxima.fim)} termina ${dow(proxima.fim)}, ${diaMes(proxima.fim)}` : 'nenhuma semana pendente', ativo: false }
    : !d.fechado
      ? { v: 'feche o mês', s: 'na Folha CLT, para liberar o valor de cada MEI', ativo: true }
      : !d.meiLiberado ? { v: '1 mês', s: `liberar para ${plural(us.length, 'MEI', 'MEI')}`, ativo: true } : { v: 'em dia', s: `${d.rotulo.split('/')[0]} já liberado`, ativo: false };

  const passos: { id: PassoEsteira; n: number; k: string; v: string; s: string; ativo: boolean; ok?: boolean }[] = [
    { id: 'FECHAR', n: 1, k: tipo === 'MOTORISTA' ? 'Fechar e enviar a semana' : 'Fechar e enviar o mês', ...p1 },
    { id: 'NOTA', n: 2, k: 'Esperando a nota', v: faltam.length ? plural(faltam.length, 'nota', 'notas') : 'nenhuma',
      s: atrasadas ? `${atrasadas} ${atrasadas === 1 ? 'passou' : 'passaram'} do prazo` : faltam.length ? 'lembrete automático às 9h' : 'ninguém devendo nota', ativo: faltam.length > 0 },
    { id: 'CONFERIR', n: 3, k: 'Conferir nota', v: conferir.length ? plural(conferir.length, 'nota', 'notas') : 'nenhuma',
      s: conferir.length ? 'chegaram e esperam o RH' : 'nada para conferir', ativo: conferir.length > 0 },
    { id: 'PAGAR', n: 4, k: 'Aprovadas · liberadas para pagar', v: brl(pagar.reduce((a, u) => a + u.valorCent, 0)),
      s: pagar.length ? `${plural(pagar.length, 'pagamento', 'pagamentos')} · abrir Pagamentos` : 'nada esperando pagamento', ativo: pagar.length > 0, ok: true },
  ];
  return (
    <div className={v.esteira} role="list" aria-label="Passos do fechamento">
      {passos.map((p) => (
        <button key={p.id} type="button" role="listitem" className={`${v.et} ${p.ativo ? v.etAtivo : ''} ${p.ok && p.ativo ? v.etPagar : ''}`} onClick={() => onPasso(p.id)}>
          <span className={v.etK}><i aria-hidden="true">{p.n}</i>{p.k}</span>
          <span className={v.etV}>{p.v}</span>
          <span className={v.etS}>{p.s}</span>
        </button>
      ))}
    </div>
  );
}

type Item = { l: LinhaRh; u: UnidadeRh };

/** Motoristas por semana: cada semana com o próximo passo dela. */
export function SemanasMotoristas({ d, ocupado, onFecharEnviar, onConferir, onPagarSemana, onLembrar, onPix, onAbrir, onAjustar, abrirSemana }: {
  d: PainelRh; ocupado: boolean;
  onFecharEnviar: (semana: string) => void; onConferir: () => void; onPagarSemana: (semana: string) => void;
  onLembrar: (ids: string[]) => void; onPix: (l: LinhaRh, u: UnidadeRh) => void; onAbrir: (id: string) => void;
  /** Ajustar os dias de UMA semana (foco: motorista que pediu o ajuste). */
  onAjustar: (semana: { inicio: string; fim: string }, foco?: string) => void;
  /** Semana a manter aberta (a que acabou de ser ajustada ou enviada). */
  abrirSemana?: string | null;
}) {
  const mot = d.linhas.filter((l) => l.tipo === 'MOTORISTA');
  // Semanas do fim do mês para o começo: a mais recente no topo.
  const semanas = d.semanas.filter((s) => s.motoristas > 0).slice().sort((a, b) => b.inicio.localeCompare(a.inicio));
  const itensDe = (inicio: string): Item[] => mot.flatMap((l) => l.unidades.filter((u) => u.periodo === inicio).map((u) => ({ l, u })))
    .sort((a, b) => a.l.nome.localeCompare(b.l.nome, 'pt-BR'));
  // Todas as semanas começam fechadas; só reabre a que acabou de ser ajustada ou enviada.
  const [aberta, setAberta] = useState<string | null>(abrirSemana ?? null);
  useEffect(() => { if (abrirSemana) setAberta(abrirSemana); }, [abrirSemana]);

  if (semanas.length === 0) return <div className={css.vazio}><b>Nenhuma semana com motorista em {d.rotulo}</b><p>Cadastre motoristas pelo botão "Adicionar prestador".</p></div>;
  return (
    <>
      <div className={v.legenda} aria-hidden="true">
        <span className={v.lPg}>pago</span><span className={v.lAp}>aprovada (pode pagar)</span><span className={v.lCf}>nota para conferir</span>
        <span className={v.lEn}>enviada, sem nota</span><span className={v.lNa}>ainda não enviada</span>
      </div>
      <div className={v.lista}>
        {semanas.map((s) => {
          const it = itensDe(s.inicio);
          const c = {
            pago: it.filter(({ u }) => u.pago).length,
            aprov: it.filter(({ u }) => autorizada(u)).length,
            conf: it.filter(({ u }) => !u.pago && (u.situacao === 'CONFERIR' || u.situacao === 'CONTESTOU')).length,
            falta: it.filter(({ u }) => !u.pago && u.nota && (u.situacao === 'FALTA' || u.situacao === 'RECUSADA')).length,
          };
          const nao = it.length - c.pago - c.aprov - c.conf - c.falta;
          const total = it.reduce((a, { u }) => a + nfDe(u), 0);
          const notas = it.map(({ u }) => u.nota).filter((n): n is NonNullable<typeof n> => !!n);
          const enviadaEm = notas.map((n) => n.liberadoEm).sort()[0] ?? null;
          const prazo = notas.find((n) => n.prazo)?.prazo ?? null;
          const ultimoPago = it.map(({ u }) => u.pagoEm).filter((x): x is string => !!x).sort().pop() ?? null;
          const faltaIds = it.filter(({ u }) => u.nota && (u.situacao === 'FALTA' || u.situacao === 'RECUSADA')).map(({ u }) => u.nota!.id);
          const pronta = s.encerrada && !s.liberada;
          const andamento = !s.encerrada && !s.liberada;
          const tudoPago = it.length > 0 && c.pago === it.length;
          const sub = s.liberada ? `enviada em ${dataIsoBr(enviadaEm)}${prazo && !tudoPago ? ` · prazo ${diaMes(prazo)}` : ''}`
            : s.encerrada ? `terminou ${dow(s.fim)}, ${diaMes(s.fim)}` : `termina ${dow(s.fim)}, ${diaMes(s.fim)}`;
          const prog = !s.liberada ? (andamento ? 'Semana em andamento' : 'Ainda não enviada aos motoristas')
            : tudoPago ? `Tudo pago${ultimoPago ? ` em ${dataIsoBr(ultimoPago)}` : ''}` : null;
          const estaAberta = aberta === s.inicio;
          return (
            <div key={s.inicio} className={v.semBloco}>
              <div className={`${v.sem} ${estaAberta ? v.semAberta : ''}`}>
                <button type="button" className={v.semTit} onClick={() => setAberta(estaAberta ? null : s.inicio)} aria-expanded={estaAberta}>
                  <b>{diaMes(s.inicio)} a {diaMes(s.fim)}</b><small>{sub}</small>
                </button>
                <div className={v.semVal}><b>{brl(total)}</b><small>{plural(s.motoristas, 'motorista', 'motoristas')}</small></div>
                <div className={v.prog}>
                  <div className={v.bar} aria-hidden="true">
                    {c.pago > 0 && <i className={v.bPg} style={{ flex: c.pago }} />}
                    {c.aprov > 0 && <i className={v.bAp} style={{ flex: c.aprov }} />}
                    {c.conf > 0 && <i className={v.bCf} style={{ flex: c.conf }} />}
                    {c.falta > 0 && <i className={v.bEn} style={{ flex: c.falta }} />}
                    {nao > 0 && <i style={{ flex: nao }} />}
                  </div>
                  <small>{prog ?? <><b>{c.pago + c.aprov + c.conf}</b> de {plural(it.length, 'nota recebida', 'notas recebidas')} · <b>{c.pago + c.aprov}</b> {c.pago + c.aprov === 1 ? 'aprovada' : 'aprovadas'} · <b>{c.pago}</b> {c.pago === 1 ? 'paga' : 'pagas'}</>}</small>
                </div>
                <div className={v.semTag}>
                  {pronta ? <span className={`${css.tag} ${css['t-av']}`}>pronta para fechar</span>
                    : andamento ? <span className={css.txtMudo}>em andamento</span>
                    : c.conf ? <span className={`${css.tag} ${css['t-in']}`}>{c.conf} para conferir</span>
                    : c.aprov ? <span className={`${css.tag} ${css['t-ok']}`}>{c.aprov} para pagar</span>
                    : c.falta ? <span className={css.txtMudo}>{plural(c.falta, 'nota faltando', 'notas faltando')}</span>
                    : tudoPago ? <span className={css.txtMudo}>concluída</span> : null}
                </div>
                <div className={v.semAcao}>
                  {pronta ? <>
                    <button type="button" className={css.lk} onClick={() => { setAberta(s.inicio); onAjustar(s); }}>Ajustar dias</button>
                    <button type="button" className={css.btnPri} onClick={() => onFecharEnviar(s.inicio)}>Fechar e enviar</button>
                  </> : c.conf ? <button type="button" className={css.btnSec} onClick={onConferir}>Conferir {plural(c.conf, 'nota', 'notas')}</button>
                    : c.aprov ? <button type="button" className={css.btnSec} onClick={() => onPagarSemana(s.inicio)}>Pagar {c.aprov}</button>
                    : faltaIds.length ? <button type="button" className={css.btnSec} disabled={ocupado} onClick={() => onLembrar(faltaIds)}>Lembrar {faltaIds.length}</button>
                    : null}
                  <button type="button" className={css.lk} onClick={() => setAberta(estaAberta ? null : s.inicio)}>{estaAberta ? 'Esconder' : 'Abrir'}</button>
                </div>
              </div>
              {estaAberta && (
                <div className={v.det}>
                  <table>
                    <thead><tr><th>Motorista</th><th className={css.r}>Dias</th><th className={css.r}>Nota (bruto)</th><th className={css.r}>A pagar</th><th>Nota fiscal</th><th>Aprovação</th><th>Pagamento</th></tr></thead>
                    <tbody>
                      {it.map(({ l, u }) => {
                        const n = u.nota;
                        const conf = n?.conferencia;
                        const problema = u.situacao === 'CONFERIR' && conf && !conf.bate;
                        const desc = nfDe(u) - u.valorCent;
                        return (
                          <tr key={l.id} className={problema ? v.problema : u.pago ? v.pagoLinha : undefined}>
                            <td>
                              <button type="button" className={`${css.linhaBtn} ${css.pes}`} onClick={() => onAbrir(l.id)}>
                                <Rosto id={l.id} semente={l.avatarSemente} tamanho={30} />
                                <span className={css.pesTxt}><b title={l.nome}>{l.nome}</b><small>{l.empresa ?? 'Motorista'}</small></span>
                              </button>
                            </td>
                            <td className={css.r}>
                              {u.dias ?? '—'}
                              {u.dias != null && u.diasAuto != null && u.dias !== u.diasAuto && (
                                <small className={v.ajustado} title={`A escala prevê ${u.diasAuto} ${u.diasAuto === 1 ? 'dia' : 'dias'} nesta semana. Alguém salvou ${u.dias} à mão. Clique em "ajustar" para conferir.`}>previsto {u.diasAuto}</small>
                              )}
                              {!s.liberada && !d.fechado && !l.fechadoIndividual && <button type="button" className={v.ajustar} onClick={() => onAjustar(s, l.id)} title={`Ajustar os dias de ${l.nome}`}>ajustar</button>}
                            </td>
                            <td className={`${css.r} ${css.mono}`}>{brl(nfDe(u))}</td>
                            <td className={`${css.r} ${css.mono}`}>{brl(u.valorCent)}{desc > 0 && <small className={v.subVal}>−{brl(desc)} débito</small>}</td>
                            <td>
                              {u.nf.numero || n?.enviadaEm ? <>
                                <span>{u.nf.numero ? `NF ${u.nf.numero}` : 'nota'}{n?.enviadaEm ? ` · enviada ${dataIsoBr(n.enviadaEm)}` : ''}</span>
                                {conf?.valorBate === true && <small className={v.subOk}>valor confere ✓</small>}
                                {conf?.valorBate === false && <small className={v.subErro}>veio {brl(n!.nfValorCent ?? conf.lido?.valorCent ?? 0)} · certo {brl(nfDe(u))}</small>}
                              </> : n ? <span className={css.txtMudo}>sem nota{n.prazo ? ` · prazo ${diaMes(n.prazo)}` : ''}{u.atrasada ? ' · atrasada' : ''}</span>
                                : <span className={css.txtMudo}>—</span>}
                            </td>
                            <td>
                              {u.situacao === 'APROVADA' || (u.pago && n?.conferidaEm)
                                ? <span className={v.aprov}><i aria-hidden="true">✓</i>aprovada{n?.conferidaPor ? ` · ${n.conferidaPor}` : ''}{n?.conferidaEm ? `, ${dataIsoBr(n.conferidaEm)}` : ''}</span>
                                : u.situacao === 'RH' ? <span className={css.txtMudo}>nota lançada pelo RH</span>
                                : u.situacao === 'CONFERIR' ? <button type="button" className={`${css.tag} ${css['t-in']} ${v.tagBtn}`} onClick={onConferir}>conferir</button>
                                : u.situacao === 'CONTESTOU' ? <button type="button" className={`${css.tag} ${css['t-av']} ${v.tagBtn}`} onClick={() => onAbrir(l.id)}>contestou o valor</button>
                                : u.situacao === 'RECUSADA' ? <span className={`${css.tag} ${css['t-er']}`}>pediu outra nota</span>
                                : <span className={css.txtMudo}>—</span>}
                            </td>
                            <td>
                              {u.pago ? <span className={`${css.tag} ${css['t-ok']}`}>pago {dataIsoBr(u.pagoEm)}</span>
                                : autorizada(u) ? <button type="button" className={css.lk} onClick={() => onPix(l, u)}>Pagar {brl(u.valorCent)}</button>
                                : <span className={css.txtMudo}>—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * Pagamentos (o financeiro): só o que foi aprovado (= autorizado a pagar),
 * MEI e motorista juntos, com a chave Pix e o QR. Marca vários como pagos.
 */
export function Pagamentos({ d, ocupado, semana, tipo, onLimparSemana, onPagar, onPix, onAbrir, onConferir }: {
  d: PainelRh; ocupado: boolean; semana: string | null; tipo: '' | 'MEI' | 'MOTORISTA'; onLimparSemana: () => void;
  onPagar: (notaIds: string[]) => void; onPix: (l: LinhaRh, u: UnidadeRh) => void; onAbrir: (id: string) => void; onConferir: () => void;
}) {
  // Respeita o tipo ativo (Motoristas ou MEI) escolhido nas abas.
  const todos = useMemo(() => d.linhas.filter((l) => !tipo || l.tipo === tipo).flatMap((l) => l.unidades.map((u) => ({ l, u }))), [d, tipo]);
  const rotTipo = tipo === 'MEI' ? ' · MEI' : tipo === 'MOTORISTA' ? ' · motoristas' : '';
  const itens = todos.filter(({ u }) => autorizada(u) && (!semana || u.periodo === semana))
    .sort((a, b) => (a.u.nota?.conferidaEm ?? '9').localeCompare(b.u.nota?.conferidaEm ?? '9') || a.l.nome.localeCompare(b.l.nome, 'pt-BR'));
  const naoLib = todos.filter(({ u }) => !u.pago && (u.situacao === 'CONFERIR' || u.situacao === 'CONTESTOU'));
  const pagos = todos.filter(({ u }) => u.pago).sort((a, b) => (b.u.pagoEm ?? '').localeCompare(a.u.pagoEm ?? ''));
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [verPagos, setVerPagos] = useState(false);
  const marcaveis = itens.filter(({ u }) => u.nota);
  const marcados = marcaveis.filter(({ u }) => sel.has(u.nota!.id));
  const somaSel = marcados.reduce((a, { u }) => a + u.valorCent, 0);
  const total = itens.reduce((a, { u }) => a + u.valorCent, 0);
  const todosMarcados = marcaveis.length > 0 && marcados.length === marcaveis.length;
  const ref = (u: UnidadeRh) => (u.tipo === 'MEI' ? `${d.rotulo.split('/')[0]} (mês)` : u.rotulo);

  return (
    <>
      <div className={`${v.barraPag} ${marcados.length ? v.barraPagOn : ''}`} role="region" aria-label="Pagamento em lote">
        <div>
          <b>{marcados.length ? `${marcados.length} ${marcados.length === 1 ? 'selecionado' : 'selecionados'} · ${brl(somaSel)}` : `${plural(itens.length, 'pagamento liberado', 'pagamentos liberados')} · ${brl(total)}`}</b>
          <small>Só aparece aqui nota aprovada pelo RH: está autorizada para pagar.</small>
        </div>
        <span className={css.esp} />
        {semana && <button type="button" className={v.chipSem} onClick={onLimparSemana}>Semana {diaMes(semana)} ✕</button>}
        <button type="button" className={css.btnPri} disabled={ocupado || marcados.length === 0} onClick={() => { onPagar(marcados.map(({ u }) => u.nota!.id)); setSel(new Set()); }}>
          {marcados.length ? `Marcar ${marcados.length} como ${marcados.length === 1 ? 'pago' : 'pagos'}` : 'Marque quem já foi pago'}
        </button>
      </div>

      <div className={v.secT}><h3>Aprovadas · para pagar{rotTipo}</h3><span>{plural(itens.length, 'pagamento', 'pagamentos')} · {brl(total)}</span><span className={css.esp} /><span className={css.txtMudo}>aprovação mais antiga primeiro</span></div>
      {itens.length === 0 ? (
        <div className={css.vazio}><b>Nada esperando pagamento</b><p>{naoLib.length ? `${plural(naoLib.length, 'nota chegou', 'notas chegaram')} e ${naoLib.length === 1 ? 'espera' : 'esperam'} a conferência do RH.` : 'Quando o RH aprovar uma nota, ela aparece aqui.'}</p></div>
      ) : (
        <div className={css.tabela}>
          <table>
            <thead><tr>
              <th style={{ width: 36 }}><input type="checkbox" className={css.chk} aria-label="Selecionar todos" checked={todosMarcados}
                onChange={() => setSel(todosMarcados ? new Set() : new Set(marcaveis.map(({ u }) => u.nota!.id)))} /></th>
              <th>Prestador</th><th>Referente a</th><th>Nota fiscal</th><th>Aprovada</th><th className={css.r}>A pagar</th><th>Pix</th><th />
            </tr></thead>
            <tbody>
              {itens.map(({ l, u }) => {
                const n = u.nota;
                const ch = l.chavePix ? normalizarChave(l.chavePix) : null;
                const desc = nfDe(u) - u.valorCent;
                return (
                  <tr key={`${l.id}-${u.periodo}`} className={!ch ? v.problema : undefined}>
                    <td>{n ? <input type="checkbox" className={css.chk} checked={sel.has(n.id)} aria-label={`Selecionar ${l.nome}`}
                      onChange={() => setSel((x) => { const k = new Set(x); if (k.has(n.id)) k.delete(n.id); else k.add(n.id); return k; })} /> : null}</td>
                    <td>
                      <button type="button" className={`${css.linhaBtn} ${css.pes}`} onClick={() => onAbrir(l.id)}>
                        <Rosto id={l.id} semente={l.avatarSemente} tamanho={30} />
                        <span className={css.pesTxt}><b title={l.nome}>{l.nome}</b><small>{[l.tipo === 'MEI' ? 'MEI' : 'Motorista', l.empresa].filter(Boolean).join(' · ')}</small></span>
                      </button>
                    </td>
                    <td>{ref(u)}</td>
                    <td>{u.nf.numero ? `NF ${u.nf.numero} · ` : ''}{brl(nfDe(u))}{desc > 0 && <small className={v.subVal}>−{brl(desc)} de descontos</small>}</td>
                    <td>{n?.conferidaEm ? <span className={v.aprov}><i aria-hidden="true">✓</i>{n.conferidaPor ?? 'RH'} · {dataIsoBr(n.conferidaEm)}</span> : <span className={css.txtMudo}>nota do RH</span>}</td>
                    <td className={`${css.r} ${css.mono}`}><b>{brl(u.valorCent)}</b></td>
                    <td>{ch ? <><span className={v.pix} title={l.chavePix ?? ''}>{l.chavePix}</span><small className={v.subVal}>{ROT_CHAVE[ch.tipo]}</small></>
                      : <span className={`${css.tag} ${css['t-er']}`}>sem chave Pix</span>}</td>
                    <td className={css.r}>
                      <span className={v.miniAcoes}>
                        {ch && <button type="button" className={`${css.btnSec} ${css.pequeno}`} onClick={() => onPix(l, u)}>QR Pix</button>}
                        {n && <button type="button" className={`${css.btnSec} ${css.pequeno}`} disabled={ocupado} onClick={() => onPagar([n.id])} title={`Marcar ${brl(u.valorCent)} como pago`}>Pago</button>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className={v.secT}><h3 className={v.secMudo}>Ainda não liberadas</h3>
        <span>{naoLib.length ? `nota recebida, falta o RH aprovar · ${naoLib.length} · ${brl(naoLib.reduce((a, { u }) => a + u.valorCent, 0))}` : 'nenhuma nota esperando conferência'}</span>
        <span className={css.esp} />{naoLib.length > 0 && <button type="button" className={css.lk} onClick={onConferir}>Conferir agora</button>}</div>

      <div className={v.secT}><h3 className={v.secMudo}>Pagos em {d.rotulo.split('/')[0]!.toLowerCase()}</h3>
        <span>{plural(pagos.length, 'pagamento', 'pagamentos')} · {brl(pagos.reduce((a, { u }) => a + (u.valorPagoCent ?? u.valorCent), 0))}</span>
        <span className={css.esp} />{pagos.length > 0 && <button type="button" className={css.lk} onClick={() => setVerPagos((x) => !x)} aria-expanded={verPagos}>{verPagos ? 'Esconder' : 'Mostrar'}</button>}</div>
      {verPagos && pagos.length > 0 && (
        <div className={css.tabela}>
          <table>
            <thead><tr><th>Prestador</th><th>Referente a</th><th>Pago em</th><th className={css.r}>Valor pago</th></tr></thead>
            <tbody>
              {pagos.map(({ l, u }) => (
                <tr key={`${l.id}-${u.periodo}`}>
                  <td><button type="button" className={`${css.linhaBtn} ${css.pes}`} onClick={() => onAbrir(l.id)}><Rosto id={l.id} semente={l.avatarSemente} tamanho={30} />
                    <span className={css.pesTxt}><b title={l.nome}>{l.nome}</b><small>{l.tipo === 'MEI' ? 'MEI' : 'Motorista'}</small></span></button></td>
                  <td>{ref(u)}</td>
                  <td>{dataIsoBr(u.pagoEm)}</td>
                  <td className={`${css.r} ${css.mono}`}>{brl(u.valorPagoCent ?? u.valorCent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
