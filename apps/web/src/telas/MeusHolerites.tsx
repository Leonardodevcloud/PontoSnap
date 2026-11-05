import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { salvarBlob } from '../lib/download';
import { Explica } from '../components/Explica';
import css from './MeusHolerites.module.css';

interface MeuHolerite {
  id: string; competencia: string; arquivoNome: string; arquivoBytes: number;
  liquidoCentavos: number | null; enviadoEm: string;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const mesBonito = (c: string) => `${MESES[Number(c.slice(5, 7)) - 1] ?? c} de ${c.slice(0, 4)}`;
const reais = (c: number | null) => c == null ? '' : `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

/** Holerites (recibos de pagamento) que o RH entregou ao funcionário, por competência. */
export function MeusHolerites() {
  const [lista, setLista] = useState<MeuHolerite[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try { setLista(await api.get<MeuHolerite[]>('/holerites/meus')); setErro(null); }
    catch (e) { setErro((e as Error).message); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function baixar(h: MeuHolerite) {
    setBaixando(h.id); setErro(null);
    try {
      const blob = await api.baixar(`/holerites/${h.id}/arquivo`);
      salvarBlob(blob, `holerite_${h.competencia}.pdf`);
    } catch (e) { setErro((e as Error).message); }
    finally { setBaixando(null); }
  }

  return (
    <div className={`appshell ${css.pagina}`}>
      <h1 className={css.h}>Holerites <Explica lado="dir">Seus recibos de pagamento, por mês. Toque em Baixar para abrir ou salvar o PDF.</Explica></h1>
      {erro && <p className={css.erro} role="alert">{erro}</p>}
      {!lista && !erro && <div className={css.sk} aria-busy="true"><i /><i /><i /></div>}
      {lista && lista.length === 0 && <p className={css.vazio}>Nenhum holerite ainda. Quando o RH enviar seu recibo de pagamento, ele aparece aqui.</p>}

      {lista?.map((h) => (
        <div key={h.id} className={css.card}>
          <span className={css.ic} aria-hidden="true">PDF</span>
          <div className={css.corpo}>
            <b>Holerite · {mesBonito(h.competencia)}</b>
            <small>{h.liquidoCentavos != null ? `líquido ${reais(h.liquidoCentavos)}` : 'recibo de pagamento'}</small>
          </div>
          <button type="button" className={css.baixar} onClick={() => baixar(h)} disabled={baixando === h.id}>
            {baixando === h.id ? '…' : 'Baixar'}
          </button>
        </div>
      ))}
    </div>
  );
}
