import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import css from './Perfis.module.css';

interface Config {
  extra?: { extraDiaUtilPct: number; extraDomingoFeriadoPct: number; extraLimiteDiarioMin: number } | null;
  tolerancia?: { toleranciaDiariaMin: number; toleranciaPorMarcacaoMin: number } | null;
  noturno?: { noturnoAdicionalPct: number; noturnoReduzida: boolean; noturnoInicioMin: number; noturnoFimMin: number } | null;
  jornada?: { jornadaSemanalMin: number; interjornadaMinimaMin: number; intervaloMaior6hMin: number } | null;
  banco?: { bancoModo: 'HERDA' | 'ATIVO' | 'INATIVO'; bancoTipoAcordo: 'INDIVIDUAL' | 'COLETIVO' | null; bancoPrazoMeses: number | null; formaCalculo: 'BANCO_HORAS' | 'INTRA_MES' } | null;
  destinacao?: { destinacaoFaltas: 'DESCONTA' | 'BANCO' | 'ABONA'; destinacaoAtrasos: 'DESCONTA' | 'BANCO' | 'TOLERA' } | null;
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
  : `${b.bancoTipoAcordo === 'COLETIVO' ? 'acordo coletivo' : 'acordo individual'} · ${b.bancoPrazoMeses}m`;
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
          <Num rot="A mais no período noturno (%)" v={cfg.noturno.noturnoAdicionalPct} on={(n) => setBloco('noturno', { ...cfg.noturno!, noturnoAdicionalPct: n })} />
        )}
      </Secao>

      <Secao titulo="Jornada semanal"
        ligado={!!cfg.jornada}
        aoLigar={(on) => setBloco('jornada', on ? { jornadaSemanalMin: 2640, interjornadaMinimaMin: 660, intervaloMaior6hMin: 60 } : null)}
        explicacao="Quantas horas por semana compõem a jornada normal. Acima disso vira hora extra. O padrão CLT é 44 horas semanais.">
        {cfg.jornada && (
          <Num rot="Horas por semana" v={Math.round(cfg.jornada.jornadaSemanalMin / 60 * 10) / 10}
            on={(n) => setBloco('jornada', { ...cfg.jornada!, jornadaSemanalMin: Math.round(n * 60) })} />
        )}
      </Secao>

      <Secao titulo="Banco de horas"
        ligado={!!cfg.banco && cfg.banco.bancoModo !== 'HERDA'}
        aoLigar={(on) => setBloco('banco', on ? { bancoModo: 'ATIVO', bancoTipoAcordo: 'INDIVIDUAL', bancoPrazoMeses: 6, formaCalculo: 'BANCO_HORAS' } : null)}
        explicacao="Em vez de pagar a hora extra, ela fica guardada para o funcionário folgar depois. Precisa de acordo — individual (com o funcionário) ou coletivo (com o sindicato).">
        {cfg.banco && cfg.banco.bancoModo !== 'HERDA' && (
          <>
            <label className={css.campo}>
              <span className={css.lb}>As horas extras vão para o banco?</span>
              <select className={css.inp} value={cfg.banco.bancoModo}
                onChange={(e) => setBloco('banco', { ...cfg.banco!, bancoModo: e.target.value as 'ATIVO' | 'INATIVO' })}>
                <option value="ATIVO">Sim — vão para o banco, para folgar depois</option>
                <option value="INATIVO">Não — hora extra é sempre paga</option>
              </select>
            </label>
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
                <Num rot="Prazo para compensar (meses)" v={cfg.banco.bancoPrazoMeses ?? 6}
                  on={(n) => setBloco('banco', { ...cfg.banco!, bancoPrazoMeses: n })} />
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
        <label className={css.toggle}>
          <input type="checkbox" checked={ligado} onChange={(e) => aoLigar(e.target.checked)} />
          <span>{ligado ? 'personalizado' : 'segue a CLT'}</span>
        </label>
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
