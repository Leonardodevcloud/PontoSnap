import { useEffect, useRef, useState } from 'react';
import { salvarBlob } from '../lib/download';
import { Botao } from './Botao';
import css from './VisorPdf.module.css';

/**
 * Pré-visualização de um PDF gerado na hora (espelho, relatório…), com
 * "Baixar". O arquivo vem de `carregar` e fica só na memória do navegador.
 */
export function VisorPdf({ titulo, sub, nomeArquivo, carregar, onFechar }: {
  titulo: string; sub?: string; nomeArquivo: string; carregar: () => Promise<Blob>; onFechar: () => void;
}) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const fechar = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let vivo = true;
    let u = '';
    carregar().then((b) => {
      if (!vivo) return;
      const pdf = new Blob([b], { type: 'application/pdf' });
      u = URL.createObjectURL(pdf);
      setBlob(pdf); setUrl(u);
    }).catch((e) => { if (vivo) setErro((e as Error).message); });
    return () => { vivo = false; if (u) URL.revokeObjectURL(u); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const voltar = document.activeElement as HTMLElement | null;
    fechar.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('keydown', esc); voltar?.focus?.(); };
  }, [onFechar]);
  return (
    <div className={css.fundo} onClick={onFechar} data-dialogo>
      <div className={css.visor} role="dialog" aria-modal="true" aria-labelledby="visor-pdf-titulo" onClick={(e) => e.stopPropagation()}>
        <div className={css.topo}>
          <div><h3 id="visor-pdf-titulo">{titulo}</h3>{sub && <p>{sub}</p>}</div>
          <div className={css.acoes}>
            <Botao variante="lime" className={css.btn} disabled={!blob} onClick={() => blob && salvarBlob(blob, nomeArquivo)}>Baixar PDF</Botao>
            <button ref={fechar} type="button" className={css.x} onClick={onFechar} aria-label="Fechar">✕</button>
          </div>
        </div>
        <div className={css.corpo}>
          {erro ? <p className={css.erro}>Não deu pra gerar o PDF: {erro}</p>
            : !url ? <p className={css.carregando}>Gerando o espelho…</p>
            : <iframe title={titulo} src={url} className={css.pdf} />}
        </div>
      </div>
    </div>
  );
}
