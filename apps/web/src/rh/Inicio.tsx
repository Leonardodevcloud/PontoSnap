import { useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { Icone, type NomeIcone } from '../components/Icone';
import { PainelRH } from './PainelRH';
import { Avatar } from '../components/Avatar';
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
  ASSINATURA: 'lapis', PADRAO_BENEFICIO: 'dinheiro', SEM_SALARIO: 'dinheiro', SEM_ESCALA: 'grade', SEM_BENEFICIO: 'dinheiro', REGRA_NOME: 'alerta', FOTO_REVISAR: 'pessoas',
};

function saudacao() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

/** Início do RH: o que precisa de atenção, e o resumo de hoje. */
export function Inicio() {
  const { atencao, recarregarAtencao } = useOutletContext<ContextoRH>();
  const navegar = useNavigate();
  const [filtro, setFiltro] = useState<GrupoAtencao | 'TODOS'>('TODOS');
  const [batidas, setBatidas] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const mes = atencao ? MESES[Number(atencao.competencia.slice(5, 7)) - 1]! : '';
  const hoje = atencao ? new Date(`${atencao.hoje}T12:00:00-0300`) : new Date();
  const itens = atencao?.itens ?? [];
  const t = atencao?.totais;

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
        <div className={`${css.num} ${t && t.bloqueia === 0 ? css.numOk : ''}`} aria-hidden="true">
          {!t ? '…' : t.bloqueia === 0 ? <Icone nome="check" tamanho={30} /> : t.bloqueia}
        </div>
        <div className={css.prTxt}>
          {!atencao && <p className={css.prT}>Conferindo pendências…</p>}
          {t && t.bloqueia > 0 && <p className={css.prT}>{t.bloqueia === 1 ? '1 coisa' : `${t.bloqueia} coisas`} para resolver antes de fechar {mes}</p>}
          {t && t.bloqueia === 0 && <p className={css.prT}>Nada impede o fechamento de {mes}</p>}
          {t && (
            <p className={css.prS}>
              {t.total === 0 ? 'Sem pendências no ponto, nos pedidos e no cadastro.'
                : [t.antes > 0 && `${t.antes} para deixar pronto antes de fechar`, t.cadastro > 0 && `${t.cadastro} de cadastro`].filter(Boolean).join(' · ') || 'O resto está em dia.'}
            </p>
          )}
        </div>
        <Link to={`/rh/pessoal?mes=${atencao?.competencia ?? ''}`} className={t && t.bloqueia === 0 ? css.btnPri : css.btnSec}>
          Ir para o fechamento
        </Link>
      </section>

      {itens.length > 0 && (
        <div className={css.filtros} role="group" aria-label="Filtrar pendências">
          {([['TODOS', 'Todos', t?.total], ['BLOQUEIA', 'Resolver antes de fechar', t?.bloqueia], ['ANTES', 'Antes de fechar', t?.antes], ['CADASTRO', 'Cadastro', t?.cadastro]] as const)
            .filter(([id, , n]) => id === 'TODOS' || (n ?? 0) > 0)
            .map(([id, rot, n]) => (
              <button key={id} className={`${css.fl} ${filtro === id ? css.flOn : ''}`} aria-pressed={filtro === id} onClick={() => setFiltro(id)}>
                {rot}<span>{n ?? 0}</span>
              </button>
            ))}
        </div>
      )}

      {GRUPOS.filter((g) => filtro === 'TODOS' || filtro === g.id).map((g) => {
        const lista = itens.filter((i) => i.grupo === g.id);
        if (lista.length === 0) return null;
        return (
          <section key={g.id} className={css.grupo} aria-labelledby={`g-${g.id}`}>
            <div className={css.gH}><h3 id={`g-${g.id}`}>{g.titulo(mes)}</h3><span>{g.sub}</span></div>
            <ul className={css.lista}>
              {lista.map((i) => (
                <li key={i.id} className={css.item}>
                  <span className={`${css.ic} ${css[`ic${g.id}`]}`} aria-hidden="true"><Icone nome={ICONE[i.tipo]} /></span>
                  <div className={css.itemTxt}>
                    <p className={css.itemT}>{i.titulo}</p>
                    <p className={css.itemS}>{i.texto}</p>
                    {i.pessoas.length > 0 && (
                      <ul className={css.pessoas} aria-label="Quem">
                        {i.pessoas.slice(0, 8).map((p, k) => (
                          <li key={k}>
                            {p.empregadoId
                              ? <Link to={`/rh/espelhos?emp=${p.empregadoId}`} className={css.comAv}><Avatar id={p.empregadoId} nome={p.nome} tamanho={22} />{p.nome}{p.detalhe ? ` · ${p.detalhe}` : ''}</Link>
                              : <span>{p.nome}{p.detalhe ? ` · ${p.detalhe}` : ''}</span>}
                          </li>
                        ))}
                        {i.pessoas.length > 8 && <li><span>+{i.pessoas.length - 8}</span></li>}
                      </ul>
                    )}
                  </div>
                  <div className={css.acoes}>
                    {i.acao2 && <Link to={i.acao2.rota} className={css.btnSec}>{i.acao2.rotulo}</Link>}
                    <button className={g.id === 'CADASTRO' ? css.btnSec : css.btnPri} onClick={() => agir(i)}>{i.acao.rotulo}</button>
                  </div>
                </li>
              ))}
            </ul>
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
        <div className={css.gH}><h3 id="hoje-t">Hoje</h3><span>quem bateu ponto e quem falta bater</span></div>
        <PainelRH embutido />
      </section>

      <CompletarBatidas aberto={batidas} onFechar={() => setBatidas(false)}
        onSalvo={(n) => { setBatidas(false); setAviso(`${n} ${n === 1 ? 'batida completada' : 'batidas completadas'}. O ponto já foi recalculado.`); void recarregarAtencao(); }} />
    </div>
  );
}
