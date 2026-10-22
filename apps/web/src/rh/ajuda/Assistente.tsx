import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { Avatar } from '../../components/Avatar';
import { NIVEL, temAtencao, type RespCompensacao } from '../../lib/compensacao';
import type { Horario } from '../../tipos';
import { escalaAlvo, perfilAlvo, resultadoExemplo, ROT_COMP, type Comp, type PerfilCfg, type Respostas } from './plano';
import cssP from '../Prestadores.module.css';
import css from './Ajuda.module.css';

const hoje = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function Op<T extends string>({ nome, v, atual, set, titulo, sub }: { nome: string; v: T; atual: T; set: (v: T) => void; titulo: string; sub?: string }) {
  return (
    <label className={`${cssP.opc} ${css.op}`}>
      <input type="radio" name={nome} checked={atual === v} onChange={() => set(v)} />
      <span><b>{titulo}</b>{sub && <small>{sub}</small>}</span>
    </label>
  );
}

/**
 * "O que esse funcionário precisa?": 4 perguntas sobre o combinado com a
 * pessoa → escala e perfil de regra certos (reaproveita ou cria) → aplica.
 */
export function Assistente() {
  const [params] = useSearchParams();
  const [r, setR] = useState<Respostas>({ jornada: 'CARGA', comp: 'MES', faltas: 'BANCO', negativo: 'DESCONTA', acordo: 'INDIVIDUAL', prazo: 6 });
  const set = <K extends keyof Respostas>(k: K) => (v: Respostas[K]) => setR((x) => ({ ...x, [k]: v }));
  const [comp, setComp] = useState<RespCompensacao | null>(null);
  const [horarios, setHorarios] = useState<Horario[]>([]);
  const [perfis, setPerfis] = useState<PerfilCfg[]>([]);
  const [sel, setSel] = useState<string[]>(() => params.get('emp') ? [params.get('emp')!] : []);
  const [busca, setBusca] = useState('');
  const [baseSemEscala, setBaseSemEscala] = useState('');
  const [modo, setModo] = useState<'DATA' | 'SEMPRE'>('DATA');
  const [desde, setDesde] = useState(`${hoje().slice(0, 7)}-01`);
  const [erro, setErro] = useState<string | null>(null);
  const [aplicando, setAplicando] = useState<string | null>(null);
  const [feito, setFeito] = useState<{ nome: string; antes: string; depois: string }[] | null>(null);

  const carregar = async () => {
    const [c, h, p] = await Promise.all([
      api.get<RespCompensacao>('/ajuda/compensacao'), api.get<Horario[]>('/tratamento/horarios'), api.get<PerfilCfg[]>('/perfis-regra'),
    ]);
    setComp(c); setHorarios(h); setPerfis(p);
    return c;
  };
  useEffect(() => { carregar().catch((e) => setErro((e as Error).message)); }, []);

  // Quem está sel. e o plano de cada um.
  const pessoas = useMemo(() => (comp?.linhas ?? []).filter((l) => sel.includes(l.empregadoId)), [comp, sel]);
  const padrao = perfis.find((p) => p.padrao) ?? null;
  const plano = useMemo(() => pessoas.map((l) => {
    const base = l.escala ? horarios.find((h) => h.id === l.escala!.id) : horarios.find((h) => h.id === baseSemEscala);
    const esc = base ? escalaAlvo(base, r, horarios) : null;
    const efetivo = l.perfil ? perfis.find((p) => p.id === l.perfil!.id) ?? null : null;
    const per = perfilAlvo(efetivo, r, perfis);
    return { l, base, esc, efetivo, per };
  }), [pessoas, horarios, perfis, r, baseSemEscala]);
  const faltaBase = plano.some((p) => !p.base);
  const doze = plano.filter((p) => p.esc && 'doze' in p.esc);
  const semHorario = plano.filter((p) => p.esc && 'semHorario' in p.esc);

  const sugestoes = useMemo(() => {
    const b = semAcento(busca.trim());
    return (comp?.linhas ?? []).filter((l) => !sel.includes(l.empregadoId) && (!b || semAcento(l.nome).includes(b)))
      .sort((a, z) => Number(temAtencao(z)) - Number(temAtencao(a))).slice(0, 8);
  }, [comp, sel, busca]);

  async function aplicar() {
    setErro(null); setFeito(null);
    const criadasEsc = new Map<string, string>(); // codigo -> id
    const criadosPer = new Map<string, string>(); // nome -> id
    const antes = new Map(pessoas.map((l) => [l.empregadoId, NIVEL[l.nivel].rot]));
    try {
      for (const [i, p] of plano.entries()) {
        setAplicando(`${i + 1} de ${plano.length}: ${p.l.nome}`);
        // escala
        if (p.esc && ('existente' in p.esc || 'nova' in p.esc)) {
          let id: string;
          if ('existente' in p.esc) id = p.esc.existente.id;
          else {
            id = criadasEsc.get(p.esc.nova.codigo) ?? (await api.post<Horario>('/tratamento/horarios', p.esc.nova)).id;
            criadasEsc.set(p.esc.nova.codigo, id);
          }
          if (id !== p.l.escala?.id) {
            if (modo === 'DATA' && p.l.escala) await api.post(`/tratamento/empregados/${p.l.empregadoId}/mudar-escala`, { horarioContratualId: id, dataInicio: desde });
            else await api.patch(`/empregados/${p.l.empregadoId}/horario`, { horarioContratualId: id });
          }
        }
        // perfil
        let pid: string;
        if ('existente' in p.per) pid = p.per.existente.id;
        else {
          pid = criadosPer.get(p.per.novo.nome) ?? (await api.post<{ id: string }>('/perfis-regra', { nome: p.per.novo.nome, config: p.per.novo.config, padrao: false })).id;
          criadosPer.set(p.per.novo.nome, pid);
        }
        const usaPadraoIgual = p.l.origemPerfil === 'PADRAO' && pid === padrao?.id;
        if (!usaPadraoIgual && pid !== (p.l.origemPerfil === 'PROPRIO' ? p.l.perfil?.id : null)) {
          await api.patch(`/empregados/${p.l.empregadoId}/perfil`, { perfilRegraId: pid });
        }
      }
      const novo = await carregar();
      setFeito(pessoas.map((l) => {
        const d = novo.linhas.find((x) => x.empregadoId === l.empregadoId);
        return { nome: l.nome, antes: antes.get(l.empregadoId) ?? '', depois: d ? NIVEL[d.nivel].rot : '?' };
      }));
    } catch (e) { setErro((e as Error).message); await carregar().catch(() => {}); }
    finally { setAplicando(null); }
  }

  const comBanco = r.comp === 'MES' || r.comp === 'ACUMULA';
  return (
    <div className={css.pagina}>
      <nav className={css.migalha} aria-label="Caminho"><Link to="/rh/ajuda">Central de Ajuda</Link> › Assistente</nav>
      <div className={cssP.cab}><div><h2>O que esse funcionário precisa?</h2><p>Responda como foi combinado com ele. O assistente escolhe a escala e a regra de cálculo certas e aplica.</p></div></div>
      {erro && <p className={cssP.erro} role="alert">{erro}</p>}

      <div className={css.wiz}>
        <div className={css.wizQ}>
          <fieldset className={css.grupo}>
            <legend><small>Pergunta 1 de 4</small>Ele tem horário fixo para entrar e sair?</legend>
            <Op nome="j" v="FIXO" atual={r.jornada} set={set('jornada')} titulo="Sim, horário fixo" sub="Ex.: 8h às 17h. Chegar depois é atraso." />
            <Op nome="j" v="CARGA" atual={r.jornada} set={set('jornada')} titulo="Não, cumpre uma carga de horas" sub="Ex.: 8h por dia, entra quando quiser (contrato de horas)." />
          </fieldset>
          <fieldset className={css.grupo}>
            <legend><small>Pergunta 2 de 4</small>Hora a mais num dia pode cobrir hora a menos em outro?</legend>
            <Op<Comp> nome="c" v="NAO" atual={r.comp} set={set('comp')} titulo="Não: extra paga, atraso descontado" />
            <Op<Comp> nome="c" v="SEMANA" atual={r.comp} set={set('comp')} titulo="Sim, dentro da mesma semana" sub="Sem banco de horas. Conta o total de seg a dom." />
            <Op<Comp> nome="c" v="MES" atual={r.comp} set={set('comp')} titulo="Sim, dentro do mês" sub="No fim do mês, paga o que sobrar." />
            <Op<Comp> nome="c" v="ACUMULA" atual={r.comp} set={set('comp')} titulo="Sim, e o saldo acumula para folgar depois" sub="Banco de horas: precisa de acordo escrito." />
          </fieldset>
          {comBanco && (
            <fieldset className={css.grupo}>
              <legend><small>Pergunta 3 de 4</small>Falta de um dia inteiro também abate das horas?</legend>
              <div className={cssP.seg} role="radiogroup">
                <button type="button" role="radio" aria-pressed={r.faltas === 'BANCO'} aria-checked={r.faltas === 'BANCO'} onClick={() => set('faltas')('BANCO')}>Sim, abate</button>
                <button type="button" role="radio" aria-pressed={r.faltas === 'DESCONTA'} aria-checked={r.faltas === 'DESCONTA'} onClick={() => set('faltas')('DESCONTA')}>Não, desconta com DSR</button>
              </div>
            </fieldset>
          )}
          {r.comp === 'MES' && (
            <fieldset className={css.grupo}>
              <legend><small>Pergunta 4 de 4</small>Se o mês fechar devendo horas?</legend>
              <div className={cssP.seg} role="radiogroup">
                <button type="button" role="radio" aria-pressed={r.negativo === 'DESCONTA'} aria-checked={r.negativo === 'DESCONTA'} onClick={() => set('negativo')('DESCONTA')}>Desconta na folha</button>
                <button type="button" role="radio" aria-pressed={r.negativo === 'CARREGA'} aria-checked={r.negativo === 'CARREGA'} onClick={() => set('negativo')('CARREGA')}>Passa para o mês seguinte</button>
              </div>
            </fieldset>
          )}
          {r.comp === 'ACUMULA' && (
            <fieldset className={css.grupo}>
              <legend><small>Pergunta 4 de 4</small>Qual é o acordo?</legend>
              <div className={cssP.campos}>
                <div className={cssP.campo}><label htmlFor="as-ac">Tipo de acordo</label>
                  <select id="as-ac" value={r.acordo} onChange={(e) => { const v = e.target.value as Respostas['acordo']; setR((x) => ({ ...x, acordo: v, prazo: v === 'COLETIVO' ? 12 : 6 })); }}>
                    <option value="INDIVIDUAL">Individual (com o funcionário) · até 6 meses</option><option value="COLETIVO">Coletivo (sindicato) · até 12 meses</option>
                  </select></div>
                <div className={cssP.campo}><label htmlFor="as-pr">Prazo para compensar (meses)</label>
                  <input id="as-pr" type="number" min={1} max={r.acordo === 'COLETIVO' ? 12 : 6} value={r.prazo} onChange={(e) => set('prazo')(Math.max(1, Math.min(r.acordo === 'COLETIVO' ? 12 : 6, Number(e.target.value) || 1)))} /></div>
              </div>
            </fieldset>
          )}
        </div>

        <div className={css.wizR}>
          <section className={css.rec} aria-live="polite">
            <h3>Configuração recomendada</h3>
            <div className={css.recL}><i>Escala</i><div><b>{r.jornada === 'CARGA' ? 'Contrato de horas' : 'Horário fixo'}{r.comp === 'SEMANA' ? ' · compensa na semana' : ''}</b><small>Mesma carga e dias que a pessoa já tem.</small></div></div>
            <div className={css.recL}><i>Regra</i><div><b>Banco: {ROT_COMP[r.comp]}{r.comp === 'MES' ? ` · devendo ${r.negativo === 'CARREGA' ? 'passa' : 'desconta'}` : r.comp === 'ACUMULA' ? ` · ${r.prazo} meses` : ''}</b><small>{comBanco ? (r.faltas === 'BANCO' ? 'Faltas e atrasos abatem das horas.' : 'Atrasos abatem; falta inteira é descontada com DSR.') : 'Extra paga; atraso e falta descontados (fora a compensação da semana).'}</small></div></div>
            <div className={css.recL}><i>Exemplo</i><div><b>Semana 9h · 7h · 8h30 · 7h30 · 8h</b><small>{resultadoExemplo(r)}</small></div></div>
          </section>

          <section className={css.aplicar}>
            <h4>Aplicar em</h4>
            <div className={css.chipsSel}>
              {pessoas.map((l) => (
                <button key={l.empregadoId} type="button" className={css.chipSel} onClick={() => setSel((s) => s.filter((x) => x !== l.empregadoId))} aria-label={`Tirar ${l.nome}`}>
                  <Avatar id={l.empregadoId} nome={l.nome} tamanho={22} />{l.nome.split(' ').slice(0, 2).join(' ')} <span aria-hidden="true">✕</span>
                </button>
              ))}
              {!pessoas.length && <span className={cssP.hint}>Ninguém escolhido ainda.</span>}
            </div>
            <input className={css.buscaPes} type="search" placeholder="Buscar funcionário para adicionar" aria-label="Buscar funcionário para adicionar" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <ul className={css.sugest}>
              {sugestoes.map((l) => (
                <li key={l.empregadoId}><button type="button" onClick={() => { setSel((s) => [...s, l.empregadoId]); setBusca(''); }}>
                  <Avatar id={l.empregadoId} nome={l.nome} tamanho={26} /><span>{l.nome}</span>
                  <span className={`${cssP.tag} ${cssP[`t-${temAtencao(l) ? 'er' : NIVEL[l.nivel].tom}`]}`}>{NIVEL[l.nivel].rot}</span>
                </button></li>
              ))}
            </ul>
            {comp && comp.totais.atencao > 0 && (
              <button type="button" className={cssP.btnTxt} onClick={() => setSel((s) => [...new Set([...s, ...comp.linhas.filter(temAtencao).map((l) => l.empregadoId)])])}>
                + todos que precisam de atenção ({comp.totais.atencao})
              </button>
            )}

            {faltaBase && (
              <div className={cssP.campo}>
                <label htmlFor="as-base">Quem não tem escala vai usar a carga de</label>
                <select id="as-base" value={baseSemEscala} onChange={(e) => setBaseSemEscala(e.target.value)}>
                  <option value="">Escolha uma escala…</option>
                  {horarios.filter((h) => h.regime !== 'r12x36').map((h) => <option key={h.id} value={h.id}>{h.codigo}</option>)}
                </select>
              </div>
            )}

            {plano.length > 0 && (
              <ul className={css.planoLista}>
                {plano.map((p) => (
                  <li key={p.l.empregadoId}>
                    <b>{p.l.nome.split(' ').slice(0, 2).join(' ')}</b>
                    <span>Escala: {!p.esc ? '—' : 'doze' in p.esc ? `${p.esc.doze.codigo} (12x36, não muda)` : 'semHorario' in p.esc ? <b className={css.erroTxt}>falta um horário fixo com essa carga</b> : 'existente' in p.esc ? (p.esc.existente.id === p.l.escala?.id ? `${p.esc.existente.codigo} (já está certa)` : p.esc.existente.codigo) : <>nova <b>{p.esc.nova.codigo}</b></>}</span>
                    <span>Regra: {'existente' in p.per ? (p.per.existente.id === p.l.perfil?.id ? `${p.per.existente.nome} (já está certa)` : p.per.existente.nome) : <>nova <b>{p.per.novo.nome}</b></>}</span>
                  </li>
                ))}
              </ul>
            )}
            {doze.length > 0 && <p className={cssP.hint}>12x36 não muda de tipo; só a regra de cálculo é aplicada.</p>}
            {semHorario.length > 0 && <p className={cssP.erro}>Para horário fixo é preciso dizer a hora de entrar e sair. Crie em <Link to="/rh/escalas">Escalas</Link> uma escala de horário fixo com a mesma carga e dias ({semHorario.map((p) => p.base!.codigo).filter((v, i, a) => a.indexOf(v) === i).join(', ')}) e volte aqui.</p>}

            <fieldset className={css.grupo}>
              <legend className={css.legendaPeq}>A partir de quando?</legend>
              <label className={`${cssP.opc} ${css.op}`}><input type="radio" name="md" checked={modo === 'DATA'} onChange={() => setModo('DATA')} />
                <span><b>A partir de uma data</b><small>A escala muda nessa data; os dias antes continuam com a escala antiga.</small></span></label>
              {modo === 'DATA' && <input type="date" className={css.data} value={desde} onChange={(e) => setDesde(e.target.value)} aria-label="Data de início da nova escala" />}
              <label className={`${cssP.opc} ${css.op}`}><input type="radio" name="md" checked={modo === 'SEMPRE'} onChange={() => setModo('SEMPRE')} />
                <span><b>Desde sempre (corrigir cadastro)</b><small>Estava errado desde o começo: vale para toda a apuração.</small></span></label>
            </fieldset>
            <p className={cssP.hint}>A regra de cálculo vale para o cálculo a partir de agora, inclusive meses abertos. Meses já fechados não mudam sozinhos.</p>
            <button type="button" className={cssP.btnPri} disabled={!plano.length || !!aplicando || semHorario.length > 0 || (faltaBase && !baseSemEscala) || (modo === 'DATA' && !desde)} onClick={aplicar}>
              {aplicando ? `Aplicando ${aplicando}…` : `Aplicar em ${plano.length} ${plano.length === 1 ? 'funcionário' : 'funcionários'}`}
            </button>
            {feito && (
              <div className={cssP.okMsg} role="status">
                Pronto. {feito.map((f) => `${f.nome.split(' ')[0]}: ${f.antes} → ${f.depois}`).join(' · ')}
                <div><Link className={cssP.btnTxt} to="/rh/funcionarios">Ver em Funcionários</Link></div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
