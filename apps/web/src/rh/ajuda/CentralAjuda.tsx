import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { ARTIGOS, buscarArtigos, type Categoria } from './artigos';
import css from './Ajuda.module.css';

interface Passo { id: string; titulo: string; ok: boolean; detalhe: string; rota: string; artigo: string }
interface Implantacao { passos: Passo[]; feitos: number; atencao: number; semEscala: number }

const CATS: { k: Categoria; t: string; ic: string }[] = [
  { k: 'CONFIGURAR', t: 'Configurar', ic: '⚙' }, { k: 'PESSOAS', t: 'Funcionários', ic: '👤' }, { k: 'MES', t: 'Dia a dia e fechamento', ic: '📅' },
];
const SUGESTOES = ['As horas não estão compensando', 'Contrato de horas', 'Banco de horas', 'Cadastrar funcionário', 'Fechar o mês'];
const SUG_SLUG: Record<string, string> = {
  'As horas não estão compensando': 'compensar-horas', 'Contrato de horas': 'escalas', 'Banco de horas': 'banco-de-horas',
  'Cadastrar funcionário': 'cadastrar-funcionario', 'Fechar o mês': 'fechar-mes',
};

/** Central de Ajuda: busca, a dúvida nº 1, "Comece aqui" (lê o cadastro real) e os guias por assunto. */
export function CentralAjuda() {
  const navegar = useNavigate();
  const [q, setQ] = useState('');
  const [imp, setImp] = useState<Implantacao | null>(null);
  useEffect(() => { api.get<Implantacao>('/ajuda/implantacao').then(setImp).catch(() => {}); }, []);
  const achados = useMemo(() => buscarArtigos(q), [q]);
  const pct = imp ? Math.round((imp.feitos / imp.passos.length) * 100) : 0;

  return (
    <div className={css.pagina}>
      <section className={css.hero} aria-labelledby="aj-h">
        <h2 id="aj-h">Como podemos ajudar?</h2>
        <p>Guias passo a passo, com a tela do sistema e exemplos de cálculo.</p>
        <div className={css.buscaG}>
          <span aria-hidden="true">🔍</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar na ajuda"
            placeholder='Ex.: "horas não compensam", "contrato de horas", "fechar o mês"'
            onKeyDown={(e) => { if (e.key === 'Enter' && achados[0]) navegar(`/rh/ajuda/${achados[0].slug}`); }} />
        </div>
        {!q && <div className={css.sug}>{SUGESTOES.map((s) => <Link key={s} to={`/rh/ajuda/${SUG_SLUG[s]}`}>{s}</Link>)}</div>}
        {q && (
          <ul className={css.resultados} aria-live="polite">
            {achados.length === 0 && <li className={css.nada}>Nada encontrado para "{q}". Tente outra palavra, como "banco", "escala" ou "falta".</li>}
            {achados.map((a) => <li key={a.slug}><Link to={`/rh/ajuda/${a.slug}`}><b>{a.titulo}</b><small>{a.resumo}</small></Link></li>)}
          </ul>
        )}
      </section>

      <div className={css.grid2}>
        <section className={css.destaque} aria-labelledby="aj-d">
          <span className={css.tagAviso}>dúvida nº 1</span>
          <h3 id="aj-d">As horas de um dia devem compensar as de outro?</h3>
          <p>Escala e regra de cálculo trabalham juntas. Se uma das duas não estiver certa, a hora extra é paga e o atraso é descontado separado. Veja os 4 níveis de compensação e qual usar.</p>
          <div className={css.botoes}>
            <Link className={css.b1} to="/rh/ajuda/compensar-horas">Ler o guia (5 min)</Link>
            <Link className={css.b2} to="/rh/ajuda/assistente">Assistente: o que meu funcionário precisa?</Link>
          </div>
          {imp && imp.atencao > 0 && (
            <p className={css.alertaD}><b>{imp.atencao} {imp.atencao === 1 ? 'funcionário está' : 'funcionários estão'}</b> com horas que <b>não compensam</b> entre dias (contrato de horas sem banco nem semana). <Link to="/rh/funcionarios?comp=NAO_COMPENSA">Ver quem é →</Link></p>
          )}
        </section>

        <section className={css.card} aria-labelledby="aj-c">
          <h4 id="aj-c" className={css.cardH}>Comece aqui · implantação</h4>
          {!imp && <div className={css.sk}><i /><i /><i /></div>}
          {imp && (
            <>
              <div className={css.prog} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${imp.feitos} de ${imp.passos.length} passos`}><i style={{ width: `${pct}%` }} /></div>
              <ol className={css.chk}>
                {imp.passos.map((p, i) => (
                  <li key={p.id} className={p.ok ? css.chkOk : css.chkPend}>
                    <span className={css.chkN} aria-hidden="true">{p.ok ? '✓' : i + 1}</span>
                    <div><b>{p.titulo}</b><small>{p.detalhe}</small></div>
                    {!p.ok ? <Link to={p.rota}>Resolver</Link> : <Link to={`/rh/ajuda/${p.artigo}`} className={css.chkGuia}>guia</Link>}
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      </div>

      <div className={css.cats}>
        {CATS.map((c) => (
          <section key={c.k} className={css.cat} aria-labelledby={`cat-${c.k}`}>
            <h3 id={`cat-${c.k}`}><span aria-hidden="true">{c.ic}</span> {c.t}</h3>
            <ul>{ARTIGOS.filter((a) => a.cat === c.k).map((a) => <li key={a.slug}><Link to={`/rh/ajuda/${a.slug}`}>{a.titulo}</Link></li>)}</ul>
          </section>
        ))}
      </div>
    </div>
  );
}
