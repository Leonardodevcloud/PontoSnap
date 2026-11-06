import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { salvarBlob } from '../lib/download';
import { Explica } from '../components/Explica';
import { GrupoEmpresa } from '../components/GrupoEmpresa';
import { paramVinculo, useVinculos, type Vinculo } from '../lib/vinculos';
import css from './MeusHolerites.module.css';

interface MeuHolerite {
  id: string; competencia: string; arquivoNome: string; arquivoBytes: number;
  liquidoCentavos: number | null; brutoCentavos?: number | null; enviadoEm: string;
  /** Empresa que emitiu (o funcionário pode ter passado por mais de uma do grupo). */
  tenantId?: string; empresa?: string; atual?: boolean;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const mesBonito = (c: string) => `${MESES[Number(c.slice(5, 7)) - 1] ?? c} de ${c.slice(0, 4)}`;
const reais = (c: number | null) => c == null ? '' : `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

/** Contracheques (recibos de pagamento) que o RH entregou ao funcionário, por competência. */
export function MeusHolerites() {
  const [lista, setLista] = useState<MeuHolerite[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);
  const vinculos = useVinculos();

  const carregar = useCallback(async () => {
    try { setLista(await api.get<MeuHolerite[]>('/holerites/meus')); setErro(null); }
    catch (e) { setErro((e as Error).message); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function baixar(h: MeuHolerite) {
    setBaixando(h.id); setErro(null);
    try {
      const blob = await api.baixar(`/holerites/${h.id}/arquivo${paramVinculo(h.tenantId ? { tenantId: h.tenantId, atual: h.atual !== false } : null)}`);
      salvarBlob(blob, `contracheque_${h.competencia}.pdf`);
    } catch (e) { setErro((e as Error).message); }
    finally { setBaixando(null); }
  }

  const grupos = lista ? agrupar(lista, vinculos) : null;

  return (
    <div className={`appshell ${css.pagina}`}>
      <h1 className={css.h}>Contracheques <Explica lado="dir">Seus recibos de pagamento, por mês. Toque em Baixar para abrir ou salvar o PDF.</Explica></h1>
      {erro && <p className={css.erro} role="alert">{erro}</p>}
      {!lista && !erro && <div className={css.sk} aria-busy="true"><i /><i /><i /></div>}
      {lista && !grupos && lista.length === 0 && <p className={css.vazio}>Nenhum contracheque ainda. Quando o RH enviar seu recibo de pagamento, ele aparece aqui.</p>}

      {lista && !grupos && lista.map((h) => <Card key={h.id} h={h} titulo={`Contracheque · ${mesBonito(h.competencia)}`} baixando={baixando === h.id} onBaixar={() => baixar(h)} />)}

      {/* Transferido entre empresas do grupo: um bloco por empresa, a atual primeiro. */}
      {lista && grupos && (
        <>
          {grupos.map(({ v, itens }) => (
            <section key={v.tenantId}>
              <GrupoEmpresa v={v} />
              {itens.length === 0 && (
                <p className={css.vazioGrupo}>{v.atual ? `Ainda nenhum nesta empresa.${v.inicio ? ` O primeiro será o de ${mesBonito(v.inicio.slice(0, 7))}.` : ''}` : 'Nenhum contracheque nesta empresa.'}</p>
              )}
              {itens.map((h) => <Card key={h.id} h={h} titulo={cap(mesBonito(h.competencia))} baixando={baixando === h.id} onBaixar={() => baixar(h)} />)}
            </section>
          ))}
          <p className={css.nota}>Os de empresas anteriores do grupo continuam guardados por elas. Você pode ver e baixar quando quiser.</p>
        </>
      )}
    </div>
  );
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function Card({ h, titulo, baixando, onBaixar }: { h: MeuHolerite; titulo: string; baixando: boolean; onBaixar: () => void }) {
  return (
    <div className={css.card}>
      <span className={css.ic} aria-hidden="true">PDF</span>
      <div className={css.corpo}>
        <b>{titulo}</b>
        <small>{h.liquidoCentavos != null ? `líquido ${reais(h.liquidoCentavos)}` : 'recibo de pagamento'}</small>
      </div>
      <button type="button" className={css.baixar} onClick={onBaixar} disabled={baixando}>
        {baixando ? '…' : 'Baixar'}
      </button>
    </div>
  );
}

/** Agrupa por empresa quando a pessoa tem mais de um vínculo no grupo. */
function agrupar(lista: MeuHolerite[], vs: Vinculo[] | null): { v: Vinculo; itens: MeuHolerite[] }[] | null {
  if (!vs || vs.length < 2) return null;
  return vs.map((v) => ({ v, itens: lista.filter((h) => (h.tenantId ?? vs[0]!.tenantId) === v.tenantId) }));
}
