import { useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { Icone, type NomeIcone } from '../components/Icone';
import { PainelRH } from './PainelRH';
import { Explica } from '../components/Explica';
import { CompletarBatidas } from './CompletarBatidas';
import type { ContextoRH } from './LayoutRH';
import type { GrupoAtencao, ItemAtencao } from '../tipos';
import css from './Inicio.module.css';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

const GRUPOS: { id: GrupoAtencao; titulo: (mes: string) => string; sub: string }[] = [
  { id: 'BLOQUEIA', titulo: () => 'Resolva antes de fechar', sub: 'sem isso o mês sai errado' },
  { id: 'ANTES', titulo: (mes) => `Antes de fechar ${mes}`, sub: 'não muda o cálculo, mas o mês sai incompleto' },
  { id: 'CADASTRO', titulo: () => 'Cadastro', sub: 'não trava, mas o cálculo pode sair errado' },
];

const ICONE: Record<ItemAtencao['tipo'], NomeIcone> = {
  BATIDAS: 'relogio', SEMANA: 'calendario', ATESTADO: 'caixa', AJUSTE: 'lapis', MES_ANTERIOR: 'calendario', NF: 'documento',
  ASSINATURA: 'lapis', PADRAO_BENEFICIO: 'dinheiro', SEM_SALARIO: 'dinheiro', SEM_ESCALA: 'grade', SEM_BENEFICIO: 'dinheiro', REGRA_NOME: 'alerta', FOTO_REVISAR: 'pessoas', NAO_COMPENSA: 'relogio',
};

function saudacao() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

/** Início do RH: o que precisa de atenção, e o resumo de hoje. */
export function Inicio() {
  const { atencao, recarregarAtencao } = useOutletContext<ContextoRH>();
  const navegar = useNavigate();
  const [batidas, setBatidas] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const mes = atencao ? MESES[Number(atencao.competencia.slice(5, 7)) - 1]! : '';
  const hoje = atencao ? new Date(`${atencao.hoje}T12:00:00-0300`) : new Date();
  const itens = atencao?.itens ?? [];
  const t = atencao?.totais;
  const estado = !t ? null : t.bloqueia > 0 ? 'BLOQUEADO' : t.antes > 0 ? 'INCOMPLETO' : 'PRONTO';
  // No estado "incompleto", diz o que falta (ex.: "82 notas fiscais faltando").
  const antesResumo = estado === 'INCOMPLETO'
    ? itens.filter((i) => i.grupo === 'ANTES').map((i) => i.titulo.charAt(0).toLowerCase() + i.titulo.slice(1)).join(' · ').replace(/^./, (c) => c.toUpperCase())
    : null;

  function agir(i: ItemAtencao) {
    if (i.acao.abrir === 'BATIDAS') setBatidas(true);
    else if (i.acao.abrir === 'FOTOS') navegar('/rh/funcionarios?revisar=1');
    else if (i.acao.rota) navegar(i.acao.rota);
  }

  return (
    <div className={css.pagina}>
      <header className={css.cab}>
        <h2>{saudacao()}</h2>
        <p>{DIAS[hoje.getDay()]}, {hoje.getDate()} de {MESES[hoje.getMonth()]}</p>
      </header>

      {aviso && <div className={css.ok} role="status"><Icone nome="check" />{aviso}</div>}

      <section className={css.prontidao} aria-live="polite">
        {/* Três estados que não se contradizem: tem bloqueio / pode fechar mas falta
            coisa (sai incompleto) / tudo pronto. */}
        <div className={`${css.num} ${estado === 'PRONTO' ? css.numOk : estado === 'INCOMPLETO' ? css.numAviso : ''}`} aria-hidden="true">
          {!t ? '…' : estado === 'PRONTO' ? <Icone nome="check" tamanho={30} /> : estado === 'INCOMPLETO' ? <Icone nome="alerta" tamanho={28} /> : t.bloqueia}
        </div>
        <div className={css.prTxt}>
          {!atencao && <p className={css.prT}>Conferindo pendências…</p>}
          {estado === 'BLOQUEADO' && <p className={css.prT}>{t!.bloqueia === 1 ? '1 coisa' : `${t!.bloqueia} coisas`} para resolver antes de fechar {mes}</p>}
          {estado === 'INCOMPLETO' && <p className={css.prT}>{mes[0].toUpperCase() + mes.slice(1)} pode ser fechado, mas sai incompleto</p>}
          {estado === 'PRONTO' && <p className={css.prT}>Tudo pronto para fechar {mes}</p>}
          {t && (
            <p className={css.prS}>
              {estado === 'PRONTO' ? (t.cadastro > 0 ? `Só ${t.cadastro === 1 ? 'um ajuste' : `${t.cadastro} ajustes`} de cadastro, que não afeta o mês.` : 'Sem pendências no ponto, nos pedidos e no cadastro.')
                : [antesResumo, estado === 'BLOQUEADO' && t.antes > 0 && `${t.antes} para deixar pronto`, t.cadastro > 0 && `${t.cadastro} de cadastro`].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <Link to={`/rh/pessoal?mes=${atencao?.competencia ?? ''}`} className={estado === 'PRONTO' ? css.btnPri : css.btnSec}>
          Ir para o fechamento
        </Link>
      </section>

      {GRUPOS.map((g) => {
        const lista = itens.filter((i) => i.grupo === g.id);
        if (lista.length === 0) return null;
        const corpo = (
          <ul className={css.lista}>
            {lista.map((i) => {
              // O texto do ajuste é o motivo que a pessoa escreveu: fica à vista. Os demais são explicação → "?".
              const textoVisivel = i.tipo === 'AJUSTE';
              const extra = i.pessoas.length - 3;
              return (
                <li key={i.id} className={css.item}>
                  <span className={css.ic} aria-hidden="true"><Icone nome={ICONE[i.tipo]} /></span>
                  <div className={css.itemTxt}>
                    <p className={css.itemT}>
                      {i.titulo}
                      {!textoVisivel && i.texto && <> <Explica rotulo={`Por que "${i.titulo}" importa`}>{i.texto}</Explica></>}
                    </p>
                    {textoVisivel && i.texto && <p className={css.itemS}>{i.texto}</p>}
                    {i.pessoas.length > 0 && (
                      <p className={css.quem}>
                        {i.pessoas.slice(0, 3).map((p, k) => (
                          <span key={k}>
                            {k > 0 && ', '}
                            {p.empregadoId
                              ? <Link to={`/rh/espelhos?emp=${p.empregadoId}`}>{p.nome}{p.detalhe ? ` (${p.detalhe})` : ''}</Link>
                              : <>{p.nome}{p.detalhe ? ` (${p.detalhe})` : ''}</>}
                          </span>
                        ))}
                        {extra > 0 && <span> e mais {extra}</span>}
                      </p>
                    )}
                  </div>
                  <div className={css.acoes}>
                    {i.acao2 && <Link to={i.acao2.rota} className={css.lk}>{i.acao2.rotulo}</Link>}
                    <button className={g.id === 'BLOQUEIA' ? css.btnPri : css.btnSec} onClick={() => agir(i)}>{i.acao.rotulo}</button>
                  </div>
                </li>
              );
            })}
          </ul>
        );
        // Cadastro não trava o mês: começa fechado para não competir com o que importa.
        if (g.id === 'CADASTRO') {
          return (
            <details key={g.id} className={css.grupo}>
              <summary className={css.gH}><span className={`${css.ponto} ${css.pCADASTRO}`} aria-hidden="true" /><h3>{g.titulo(mes)}</h3><span className={css.cont}>{lista.length}</span><Explica>{g.sub}</Explica></summary>
              {corpo}
            </details>
          );
        }
        return (
          <section key={g.id} className={css.grupo} aria-labelledby={`g-${g.id}`}>
            <div className={css.gH}><span className={`${css.ponto} ${css[`p${g.id}`]}`} aria-hidden="true" /><h3 id={`g-${g.id}`}>{g.titulo(mes)}</h3><span className={css.cont}>{lista.length}</span><Explica>{g.sub}</Explica></div>
            {corpo}
          </section>
        );
      })}

      {atencao && itens.length === 0 && (
        <div className={css.vazio}>
          <span className={css.vazioIc}><Icone nome="check" tamanho={26} /></span>
          <div>
            <p className={css.itemT}>Tudo em dia</p>
            <p className={css.itemS}>Nenhuma batida em aberto, pedido esperando ou cadastro incompleto. Quando aparecer algo, fica aqui.</p>
          </div>
        </div>
      )}

      <section className={css.hoje} aria-labelledby="hoje-t">
        <div className={css.gH}><h3 id="hoje-t">Hoje</h3><Explica>Quem já bateu ponto hoje e quem ainda falta bater.</Explica></div>
        <PainelRH embutido />
      </section>

      <CompletarBatidas aberto={batidas} onFechar={() => setBatidas(false)}
        onSalvo={(n) => { setBatidas(false); setAviso(`${n} ${n === 1 ? 'batida completada' : 'batidas completadas'}. O ponto já foi recalculado.`); void recarregarAtencao(); }} />
    </div>
  );
}
