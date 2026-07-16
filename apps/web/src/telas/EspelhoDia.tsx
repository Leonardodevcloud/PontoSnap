import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { fmtDataCurta, fmtHora, hojeSP, minutosParaHhMm, rotuloMarcacao } from '../lib/formato';
import type { MinhasMarcacoes } from '../tipos';
import { Botao } from '../components/Botao';
import css from './EspelhoDia.module.css';

export function EspelhoDia() {
  const navegar = useNavigate();
  const [dados, setDados] = useState<MinhasMarcacoes | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try { setDados(await api.get<MinhasMarcacoes>(`/marcacao/minhas?data=${hojeSP()}`)); }
      catch (e) { setErro((e as Error).message); }
    })();
  }, []);

  const marcs = dados?.marcacoes ?? [];

  // Pareia E/S no cliente só para exibir o total trabalhado.
  let trabalhado = 0;
  for (let i = 0; i + 1 < marcs.length; i += 2) {
    trabalhado += Math.round((+new Date(marcs[i + 1].dtMarcacao) - +new Date(marcs[i].dtMarcacao)) / 60000);
  }
  const impar = marcs.length % 2 !== 0;
  const ultimoNsr = marcs.length ? marcs[marcs.length - 1].nsr : null;

  async function baixarComprovante(nsr: number) {
    try {
      const blob = await api.baixar(`/marcacao/${nsr}/comprovante`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `comprovante-${nsr}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setErro((e as Error).message); }
  }

  return (
    <div className="appshell">
      <div className={css.h}>Espelho do dia</div>
      <div className={css.d}>{fmtDataCurta()}</div>

      {erro && <p className={css.erro}>{erro}</p>}
      {marcs.length === 0 && !erro && <div className={css.vazio}>Nada por aqui ainda. Bate o primeiro ponto do dia?</div>}

      {marcs.map((m, i) => (
        <button key={m.nsr} className={css.row} onClick={() => baixarComprovante(m.nsr)} title="Baixar comprovante">
          <span className={`${css.dot} ${i % 2 === 0 ? css.e : css.s}`} />
          <span className={css.kk}>{rotuloMarcacao(i, marcs.length)}</span>
          <span className={css.tt}>{fmtHora(m.dtMarcacao)}</span>
          <span className={css.pdf}>PDF</span>
        </button>
      ))}

      {marcs.length > 0 && (
        <>
          <div className={css.saldo}>
            <span className={css.l}>Trabalhado hoje</span>
            <span className={css.v}>{minutosParaHhMm(trabalhado)}</span>
          </div>
          {impar
            ? <div className={css.aviso}>Já tem uma batida em aberto — falta bater a saída.</div>
            : <div className={css.afd}>NSR #{String(ultimoNsr).padStart(5, '0')} · <span className={css.ok}>●</span> registro íntegro</div>}
        </>
      )}

      <div className={css.espaco} />
      <Botao variante="ghost" onClick={() => navegar('/')}>Voltar</Botao>
    </div>
  );
}
