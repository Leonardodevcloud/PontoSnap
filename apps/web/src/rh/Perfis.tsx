import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import css from './Perfis.module.css';

interface Config {
  extra?: { extraDiaUtilPct: number; extraDomingoFeriadoPct: number; extraLimiteDiarioMin: number } | null;
  tolerancia?: { toleranciaDiariaMin: number; toleranciaPorMarcacaoMin: number } | null;
  noturno?: { noturnoAdicionalPct: number; noturnoReduzida: boolean; noturnoInicioMin: number; noturnoFimMin: number } | null;
  jornada?: { jornadaSemanalMin: number; interjornadaMinimaMin: number; intervaloMaior6hMin: number } | null;
  banco?: { bancoModo: 'HERDA' | 'ATIVO' | 'INATIVO'; bancoTipoAcordo: 'INDIVIDUAL' | 'COLETIVO' | null; bancoPrazoMeses: number | null; formaCalculo: 'BANCO_HORAS' | 'INTRA_MES'; negativoMes?: 'DESCONTA' | 'CARREGA' } | null;
  destinacao?: { destinacaoFaltas: 'DESCONTA' | 'BANCO' | 'ABONA'; destinacaoAtrasos: 'DESCONTA' | 'BANCO' | 'TOLERA' } | null;
  /** Tipo de jornada. Nulo = segue a escala (escalas antigas marcadas como flexíveis). */
  contrato?: { tipoJornada: 'FIXO' | 'CONTRATO_HORAS' } | null;
}
interface PerfilLista {
  id: string; nome: string; config: Config; padrao: boolean; usadoPor: number; temPdf: boolean;
  cctSindicato: string | null; cctVigencia: string | null;
}

const vazio = (): Config => ({});

export default function Perfis() {
  const [lista, setLista] = useState<PerfilLista[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<PerfilLista | 'novo' | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try { setLista(await api.get<PerfilLista[]>('/perfis-regra')); }
    catch (e) { setErro((e as Error).message); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  if (editando) {
    return <Editor
      inicial={editando === 'novo' ? null : editando}
      onFechar={() => setEditando(null)}
      onSalvo={() => { setEditando(null); void carregar(); }}
    />;
  }

  return (
    <div className={css.tela}>
      <div className={css.top}>
        <div>
          <h1 className={css.h}>Perfis de regra</h1>
          <p className={css.sub}>Um perfil é um pacote de regras pronto. Você cria uma vez, com tudo dentro — e no funcionário escolhe com um clique.</p>
        </div>
        <button className={css.btn} onClick={() => setEditando('novo')}>+ Novo perfil</button>
      </div>

      {erro && <p className={css.erro}>{erro}</p>}

      {lista.length === 0 ? (
        <div className={css.card}><p className={css.vazio}>Nenhum perfil ainda. Crie o primeiro — pode ser o "Padrão da empresa".</p></div>
      ) : lista.map((p) => (
        <div key={p.id} className={css.perfil}>
          <div className={css.perfilTop}>
            <span className={css.perfilNome}>
              {p.nome}
              {p.padrao && <span className={css.tagPadrao}>padrão</span>}
              <span className={css.tagUso}>{p.usadoPor === 0 ? 'ninguém usa' : p.usadoPor === 1 ? 'usado por 1' : `usado por ${p.usadoPor}`}</span>
            </span>
            <button className={css.btnG} onClick={() => setEditando(p)}>editar</button>
          </div>
          <div className={css.itens}>{resumo(p.config).map((r) => (
            <span key={r.lb} className={css.item}><span className={css.itemLb}>{r.lb}</span>{r.valor}</span>
          ))}</div>
          {p.cctSindicato && <p className={css.cct}>📄 Convenção: {p.cctSindicato}{p.cctVigencia ? ` · ${p.cctVigencia}` : ''}</p>}
        </div>
      ))}
    </div>
  );
}

function resumo(c: Config): { lb: string; valor: string }[] {
  const h = (min: number) => Math.round(min / 60);
  return [
    { lb: 'jornada do dia', valor: !c.contrato ? 'como a escala' : c.contrato.tipoJornada === 'CONTRATO_HORAS' ? 'contrato de horas' : 'horário fixo' },
    { lb: 'hora extra', valor: c.extra ? `${c.extra.extraDiaUtilPct}% / ${c.extra.extraDomingoFeriadoPct}%` : 'CLT' },
    { lb: 'tolerância', valor: c.tolerancia ? `${c.tolerancia.toleranciaDiariaMin} min/dia` : 'CLT' },
    { lb: 'noturno', valor: c.noturno ? `${c.noturno.noturnoAdicionalPct}%` : 'CLT' },
    { lb: 'jornada', valor: c.jornada ? `${h(c.jornada.jornadaSemanalMin)}h/semana` : 'CLT' },
    { lb: 'banco de horas', valor: bancoTxt(c.banco) },
    { lb: 'faltas', valor: c.destinacao ? faltaTxt(c.destinacao.destinacaoFaltas) : 'descontam' },
  ];
}
const bancoTxt = (b: Config['banco']) => !b || b.bancoModo === 'HERDA' ? 'como a empresa'
  : b.bancoModo === 'INATIVO' ? 'não usa'
  : b.formaCalculo === 'INTRA_MES' ? `paga a diferença no mês · devendo ${b.negativoMes === 'CARREGA' ? 'passa' : 'desconta'}`
  : `acumula · ${b.bancoTipoAcordo === 'COLETIVO' ? 'coletivo' : 'individual'} · ${b.bancoPrazoMeses}m`;

type ModoBanco = 'ACUMULA' | 'MES' | 'NAO';
const modoDe = (b: NonNullable<Config['banco']>): ModoBanco =>
  b.bancoModo === 'INATIVO' ? 'NAO' : b.formaCalculo === 'INTRA_MES' ? 'MES' : 'ACUMULA';
const OPCOES_BANCO: { k: ModoBanco; t: string; d: string; ex?: string }[] = [
  { k: 'ACUMULA', t: 'Acumula no banco, para folgar depois', d: 'O saldo passa de um mês para o outro até ser compensado com folga. O que passar do prazo vence e é pago.', ex: 'fez +10h em set → começa out com +10h' },
  { k: 'MES', t: 'Compensa no mês e paga a diferença', d: 'Extra e atraso do mês se compensam. Se o mês fechar positivo, a diferença é paga como hora extra na folha e o banco zera.', ex: '+8h extra −3h atraso → paga 5h' },
  { k: 'NAO', t: 'Não usa banco: toda hora extra é paga', d: 'Hora extra paga cheia; atraso e falta seguem a regra de desconto. Nada se compensa.' },
];
const OPCOES_JORNADA: { k: 'FIXO' | 'CONTRATO_HORAS'; t: string; d: string; ex: string }[] = [
  { k: 'FIXO', t: 'Horário fixo', d: 'Tem hora para entrar e sair. Chegar depois é atraso, sair depois é extra.', ex: 'escala 8h–18h · chegou 9h → 1h de atraso' },
  { k: 'CONTRATO_HORAS', t: 'Contrato de horas', d: 'Entra e sai na hora que quiser. Conta só se cumpriu a carga do dia da escala.', ex: 'carga 8h · fez das 12h às 21h → cumpriu' },
];
const faltaTxt = (f: string) => f === 'DESCONTA' ? 'descontam' : f === 'BANCO' ? 'abatem do banco' : 'abonadas';

// ---------------------------------------------------------------------------

function Editor({ inicial, onFechar, onSalvo }: { inicial: PerfilLista | null; onFechar: () => void; onSalvo: () => void }) {
  const [nome, setNome] = useState(inicial?.nome ?? '');
  const [padrao, setPadrao] = useState(inicial?.padrao ?? false);
  const [cfg, setCfg] = useState<Config>(inicial?.config ?? vazio());
  const [sindicato, setSindicato] = useState(inicial?.cctSindicato ?? '');
  const [vigencia, setVigencia] = useState(inicial?.cctVigencia ?? '');
  const [pdf, setPdf] = useState<{ nome: string; base64: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // helpers pra ligar/desligar cada bloco e editar campos
  const setBloco = <K extends keyof Config>(k: K, v: Config[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const [sugestao, setSugestao] = useState<string | null>(null);

  /** Contrato de horas costuma compensar no mês: ajusta o banco junto (dá pra mudar). */
  function escolherJornada(k: 'FIXO' | 'CONTRATO_HORAS') {
    setSugestao(null);
    setCfg((c) => {
      const novo: Config = { ...c, contrato: { tipoJornada: k } };
      const b = c.banco;
      const acumulaOuHerda = !b || b.bancoModo === 'HERDA' || (b.bancoModo === 'ATIVO' && b.formaCalculo !== 'INTRA_MES');
      if (k === 'CONTRATO_HORAS' && acumulaOuHerda) {
        novo.banco = { bancoModo: 'ATIVO', bancoTipoAcordo: b?.bancoTipoAcordo ?? 'INDIVIDUAL', bancoPrazoMeses: b?.bancoPrazoMeses ?? 6, formaCalculo: 'INTRA_MES', negativoMes: 'CARREGA' };
        setSugestao('Contrato de horas costuma compensar no mês: o banco de horas abaixo foi ajustado para “compensa no mês · devendo passa para o mês seguinte”. Pode mudar.');
      }
      return novo;
    });
  }

  async function salvar() {
    if (nome.trim().length < 2) { setErro('Dê um nome ao perfil.'); return; }
    setErro(null); setSalvando(true);
    const corpo = {
      nome: nome.trim(), config: cfg, padrao,
      cctSindicato: sindicato.trim() || undefined, cctVigencia: vigencia.trim() || undefined,
      ...(pdf ? { cctPdfNome: pdf.nome, cctPdfBase64: pdf.base64 } : {}),
    };
    try {
      if (inicial) await api.patch(`/perfis-regra/${inicial.id}`, corpo);
      else await api.post('/perfis-regra', corpo);
      onSalvo();
    } catch (e) { setErro((e as Error).message); setSalvando(false); }
  }

  async function escolherPdf(f: File) {
    const b64 = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res((r.result as string).split(',')[1] ?? '');
      r.onerror = rej; r.readAsDataURL(f);
    });
    setPdf({ nome: f.name, base64: b64 });
  }

  return (
    <div className={css.tela}>
      <div className={css.top}>
        <div>
          <h1 className={css.h}>{inicial ? `Editar “${inicial.nome}”` : 'Novo perfil de regra'}</h1>
          <p className={css.sub}>Preencha só o que difere da CLT. O que deixar em branco segue a lei automaticamente.</p>
        </div>
      </div>
      {erro && <p className={css.erro}>{erro}</p>}

      <div className={css.card}>
        <label className={css.campo}>
          <span className={css.lb}>Nome do perfil</span>
          <input className={css.inp} placeholder="Ex.: Padrão da empresa, Motoristas…" value={nome} onChange={(e) => setNome(e.target.value)} />
        </label>
        <label className={css.check}>
          <input type="checkbox" checked={padrao} onChange={(e) => setPadrao(e.target.checked)} />
          <span>Usar este perfil para quem não tiver perfil escolhido</span>
        </label>
      </div>

      <div className={css.card}>
        <p className={css.secaoTit}>Tipo de jornada</p>
        <p className={css.exp}>Como o dia de trabalho é contado. A carga de cada dia vem da escala do funcionário.</p>
        <div className={`${css.opBanco} ${css.opDuas}`} role="radiogroup" aria-label="Tipo de jornada">
          {OPCOES_JORNADA.map((o) => {
            const on = cfg.contrato?.tipoJornada === o.k;
            return (
              <button key={o.k} type="button" role="radio" aria-checked={on}
                className={`${css.opB} ${on ? css.opBOn : ''}`} onClick={() => escolherJornada(o.k)}>
                <i className={css.opRd} aria-hidden />
                <span><b>{o.t}</b><span>{o.d}</span><em className={css.opEx}>{o.ex}</em></span>
              </button>
            );
          })}
        </div>
        {!cfg.contrato && (
          <p className={css.exp} style={{ marginTop: 10 }}>
            Ainda não definido: vale o que a <strong>escala</strong> de cada funcionário diz (escalas antigas marcadas como “horário flexível” contam como contrato de horas). Escolha uma opção para o perfil mandar.
          </p>
        )}
        {sugestao && <p className={css.sugestao}>{sugestao}</p>}
      </div>

      <Secao titulo="Horas extras"
        ligado={!!cfg.extra}
        aoLigar={(on) => setBloco('extra', on ? { extraDiaUtilPct: 50, extraDomingoFeriadoPct: 100, extraLimiteDiarioMin: 120 } : null)}
        explicacao="Quanto a mais você paga pelas horas que passam da jornada do dia. Pela CLT: 50% a mais em dia útil, 100% em domingo e feriado.">
        {cfg.extra && (
          <div className={css.dupla}>
            <Num rot="A mais em dia útil (%)" v={cfg.extra.extraDiaUtilPct} on={(n) => setBloco('extra', { ...cfg.extra!, extraDiaUtilPct: n })} />
            <Num rot="A mais em domingo/feriado (%)" v={cfg.extra.extraDomingoFeriadoPct} on={(n) => setBloco('extra', { ...cfg.extra!, extraDomingoFeriadoPct: n })} />
          </div>
        )}
      </Secao>

      <Secao titulo="Tolerância de atraso"
        ligado={!!cfg.tolerancia}
        aoLigar={(on) => setBloco('tolerancia', on ? { toleranciaDiariaMin: 10, toleranciaPorMarcacaoMin: 5 } : null)}
        explicacao="Pequenos atrasos ou saídas adiantadas que não são descontados. A CLT permite até 10 minutos por dia, sendo no máximo 5 de cada vez.">
        {cfg.tolerancia && (
          <div className={css.dupla}>
            <Num rot="Perdoado por dia (min)" v={cfg.tolerancia.toleranciaDiariaMin} on={(n) => setBloco('tolerancia', { ...cfg.tolerancia!, toleranciaDiariaMin: n })} />
            <Num rot="Perdoado por marcação (min)" v={cfg.tolerancia.toleranciaPorMarcacaoMin} on={(n) => setBloco('tolerancia', { ...cfg.tolerancia!, toleranciaPorMarcacaoMin: n })} />
          </div>
        )}
      </Secao>

      <Secao titulo="Adicional noturno"
        ligado={!!cfg.noturno}
        aoLigar={(on) => setBloco('noturno', on ? { noturnoAdicionalPct: 20, noturnoReduzida: true, noturnoInicioMin: 1320, noturnoFimMin: 300 } : null)}
        explicacao="Percentual a mais pago pelas horas trabalhadas de madrugada. A CLT define 20% a mais, das 22h às 5h.">
        {cfg.noturno && (
          <div className={css.dupla}>
            <Num rot="A mais no período noturno (%)" v={cfg.noturno.noturnoAdicionalPct} on={(n) => setBloco('noturno', { ...cfg.noturno!, noturnoAdicionalPct: n })} />
          </div>
        )}
      </Secao>

      <Secao titulo="Jornada semanal"
        ligado={!!cfg.jornada}
        aoLigar={(on) => setBloco('jornada', on ? { jornadaSemanalMin: 2640, interjornadaMinimaMin: 660, intervaloMaior6hMin: 60 } : null)}
        explicacao="Quantas horas por semana compõem a jornada normal. Acima disso vira hora extra. O padrão CLT é 44 horas semanais.">
        {cfg.jornada && (
          <div className={css.dupla}>
            <Num rot="Horas por semana" v={Math.round(cfg.jornada.jornadaSemanalMin / 60 * 10) / 10}
              on={(n) => setBloco('jornada', { ...cfg.jornada!, jornadaSemanalMin: Math.round(n * 60) })} />
          </div>
        )}
      </Secao>

      <Secao titulo="Banco de horas"
        ligado={!!cfg.banco && cfg.banco.bancoModo !== 'HERDA'}
        aoLigar={(on) => setBloco('banco', on ? { bancoModo: 'ATIVO', bancoTipoAcordo: 'INDIVIDUAL', bancoPrazoMeses: 6, formaCalculo: 'BANCO_HORAS' } : null)}
        explicacao="Em vez de pagar a hora extra, ela fica guardada para o funcionário folgar depois. Precisa de acordo — individual (com o funcionário) ou coletivo (com o sindicato).">
        {cfg.banco && cfg.banco.bancoModo !== 'HERDA' && (
          <>
            <div className={css.lb} id="lb-modo-banco">O que acontece com a hora a mais (e a hora a menos)</div>
            <div className={css.opBanco} role="radiogroup" aria-labelledby="lb-modo-banco">
              {OPCOES_BANCO.map((o) => {
                const on = modoDe(cfg.banco!) === o.k;
                return (
                  <div key={o.k}>
                    <button type="button" role="radio" aria-checked={on}
                      className={`${css.opB} ${on ? css.opBOn : ''}`}
                      onClick={() => setBloco('banco', {
                        ...cfg.banco!,
                        bancoModo: o.k === 'NAO' ? 'INATIVO' : 'ATIVO',
                        formaCalculo: o.k === 'MES' ? 'INTRA_MES' : 'BANCO_HORAS',
                        negativoMes: o.k === 'MES' ? (cfg.banco!.negativoMes ?? 'DESCONTA') : cfg.banco!.negativoMes,
                      })}>
                      <i className={css.opRd} aria-hidden />
                      <span><b>{o.t}</b><span>{o.d}</span>{o.ex && <em className={css.opEx}>{o.ex}</em>}</span>
                    </button>
                    {o.k === 'MES' && on && (
                      <div className={css.opSub}>
                        <div className={css.opSubLb} id="lb-negativo">E se o mês fechar devendo horas?</div>
                        <div className={css.pills} role="radiogroup" aria-labelledby="lb-negativo">
                          {([['DESCONTA', 'Desconta na folha'], ['CARREGA', 'Passa para o mês seguinte']] as const).map(([k, t]) => (
                            <button key={k} type="button" role="radio" aria-checked={(cfg.banco!.negativoMes ?? 'DESCONTA') === k}
                              className={`${css.pill} ${(cfg.banco!.negativoMes ?? 'DESCONTA') === k ? css.pillOn : ''}`}
                              onClick={() => setBloco('banco', { ...cfg.banco!, negativoMes: k })}>{t}</button>
                          ))}
                        </div>
                        <p className={css.exp} style={{ marginTop: 8 }}>
                          {(cfg.banco!.negativoMes ?? 'DESCONTA') === 'DESCONTA'
                            ? 'Fechou com −3h → desconta 3h na folha e o banco zera.'
                            : 'Fechou com −3h → começa o mês seguinte devendo 3h. Se fechar positivo depois, abate antes de pagar.'}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {cfg.banco.bancoModo === 'ATIVO' && (
              <div className={css.dupla}>
                <label className={css.campo}>
                  <span className={css.lb}>Tipo de acordo</span>
                  <select className={css.inp} value={cfg.banco.bancoTipoAcordo ?? 'INDIVIDUAL'}
                    onChange={(e) => setBloco('banco', { ...cfg.banco!, bancoTipoAcordo: e.target.value as 'INDIVIDUAL' | 'COLETIVO' })}>
                    <option value="INDIVIDUAL">Individual (com o funcionário)</option>
                    <option value="COLETIVO">Coletivo (com o sindicato)</option>
                  </select>
                </label>
                {cfg.banco.formaCalculo !== 'INTRA_MES' && (
                  <Num rot="Prazo para compensar (meses)" v={cfg.banco.bancoPrazoMeses ?? 6}
                    on={(n) => setBloco('banco', { ...cfg.banco!, bancoPrazoMeses: n })} />
                )}
              </div>
            )}
          </>
        )}
      </Secao>

      <Secao titulo="Faltas não justificadas"
        ligado={!!cfg.destinacao}
        aoLigar={(on) => setBloco('destinacao', on ? { destinacaoFaltas: 'DESCONTA', destinacaoAtrasos: 'BANCO' } : null)}
        explicacao="O que fazer quando o funcionário falta sem justificativa. O padrão é descontar da folha (incluindo o reflexo no descanso semanal).">
        {cfg.destinacao && (
          <label className={css.campo}>
            <span className={css.lb}>Quando falta sem justificar…</span>
            <select className={css.inp} value={cfg.destinacao.destinacaoFaltas}
              onChange={(e) => setBloco('destinacao', { ...cfg.destinacao!, destinacaoFaltas: e.target.value as 'DESCONTA' | 'BANCO' | 'ABONA' })}>
              <option value="DESCONTA">Descontar da folha</option>
              <option value="BANCO">Abater do banco de horas</option>
              <option value="ABONA">Abonar (não descontar)</option>
            </select>
          </label>
        )}
      </Secao>

      <div className={css.card}>
        <p className={css.secaoTit}>Convenção coletiva <span className={css.opcional}>opcional</span></p>
        <p className={css.exp}>Se este perfil segue uma CCT/ACT, você pode anexar o documento do sindicato aqui para deixar registrado.</p>
        <div className={css.dupla}>
          <label className={css.campo}><span className={css.lb}>Sindicato</span><input className={css.inp} value={sindicato} onChange={(e) => setSindicato(e.target.value)} placeholder="Ex.: SINDIMOTO-BA" /></label>
          <label className={css.campo}><span className={css.lb}>Vigência</span><input className={css.inp} value={vigencia} onChange={(e) => setVigencia(e.target.value)} placeholder="Ex.: 2026/2027" /></label>
        </div>
        <label className={css.arquivo}>
          {pdf ? `📄 ${pdf.nome}` : inicial?.temPdf ? '📄 PDF já anexado — envie outro para trocar' : 'Anexar PDF da convenção'}
          <input type="file" accept="application/pdf" hidden onChange={(e) => e.target.files?.[0] && escolherPdf(e.target.files[0])} />
        </label>
      </div>

      <div className={css.acoes}>
        <button className={css.btn} disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar perfil'}</button>
        <button className={css.btnG} onClick={onFechar}>Cancelar</button>
      </div>
    </div>
  );
}

function Secao({ titulo, explicacao, ligado, aoLigar, children }: {
  titulo: string; explicacao: string; ligado: boolean; aoLigar: (on: boolean) => void; children?: React.ReactNode;
}) {
  return (
    <div className={css.card}>
      <div className={css.secaoTop}>
        <div>
          <p className={css.secaoTit}>{titulo}</p>
          <p className={css.exp}>{explicacao}</p>
        </div>
        <div className={css.seg} role="group" aria-label={`${titulo}: seguir a CLT ou personalizar`}>
          <button
            type="button"
            className={`${css.segBtn} ${!ligado ? css.segOnClt : ''}`}
            aria-pressed={!ligado}
            onClick={() => aoLigar(false)}
          >Segue a CLT</button>
          <button
            type="button"
            className={`${css.segBtn} ${ligado ? css.segOnCustom : ''}`}
            aria-pressed={ligado}
            onClick={() => aoLigar(true)}
          >Personalizado</button>
        </div>
      </div>
      {children}
    </div>
  );
}

function Num({ rot, v, on }: { rot: string; v: number; on: (n: number) => void }) {
  return (
    <label className={css.campo}>
      <span className={css.lb}>{rot}</span>
      <input className={css.inp} type="number" value={v} onChange={(e) => on(Number(e.target.value) || 0)} />
    </label>
  );
}
