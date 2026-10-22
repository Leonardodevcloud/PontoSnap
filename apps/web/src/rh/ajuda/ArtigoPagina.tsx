import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { ARTIGOS } from './artigos';
import css from './Ajuda.module.css';

/** Um artigo da Central de Ajuda em tela cheia, com índice ao lado. */
export function ArtigoPagina() {
  const { slug } = useParams();
  const { hash } = useLocation();
  const a = ARTIGOS.find((x) => x.slug === slug);
  const [ativa, setAtiva] = useState(a?.secoes[0]?.id ?? '');

  useEffect(() => {
    document.title = a ? `${a.titulo} · Ajuda · PontoSnap` : 'Ajuda · PontoSnap';
    if (hash) { setAtiva(hash.replace(/^#s-/, '')); setTimeout(() => document.querySelector(hash)?.scrollIntoView({ block: 'start' }), 50); }
    else window.scrollTo(0, 0);
  }, [a, hash]);
  useEffect(() => {
    if (!a?.secoes.length) return;
    const obs = new IntersectionObserver((es) => { const v = es.find((e) => e.isIntersecting); if (v) setAtiva(v.target.id.replace(/^s-/, '')); }, { rootMargin: '0px 0px -70% 0px' });
    a.secoes.forEach((s) => { const el = document.getElementById(`s-${s.id}`); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [a]);

  if (!a) return <Navigate to="/rh/ajuda" replace />;
  if (a.slug === 'assistente') return <Navigate to="/rh/ajuda/assistente" replace />;
  const { Corpo } = a;
  const outros = ARTIGOS.filter((x) => x.cat === a.cat && x.slug !== a.slug).slice(0, 4);
  return (
    <div className={css.pagina}>
      <nav className={css.migalha} aria-label="Caminho"><Link to="/rh/ajuda">Central de Ajuda</Link> › {a.titulo}</nav>
      <div className={css.art}>
        {a.secoes.length > 1 && (
          <nav className={css.toc} aria-label="Neste guia">
            <b>Neste guia</b>
            {a.secoes.map((s) => <a key={s.id} href={`#s-${s.id}`} className={ativa === s.id ? css.tocOn : ''}
              onClick={(e) => { e.preventDefault(); document.getElementById(`s-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setAtiva(s.id); }}>{s.titulo}</a>)}
          </nav>
        )}
        <article className={css.artigo}>
          <h2 className={css.artH}>{a.titulo}</h2>
          <p className={css.artMeta}>{a.minutos} min de leitura</p>
          <Corpo />
          {outros.length > 0 && (
            <aside className={css.relacionados} aria-label="Veja também">
              <b>Veja também</b>
              {outros.map((o) => <Link key={o.slug} to={`/rh/ajuda/${o.slug}`}>{o.titulo}</Link>)}
            </aside>
          )}
        </article>
      </div>
    </div>
  );
}
