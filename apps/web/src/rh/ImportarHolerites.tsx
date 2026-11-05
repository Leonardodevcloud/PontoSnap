import { useRef, useState } from 'react';
import { api } from '../lib/api';
import css from './ImportarHolerites.module.css';

type Status = 'CPF' | 'NOME' | 'NAO_ENCONTRADO';
interface ItemPrevia {
  paginas: number[]; cpf: string | null; nomePdf: string | null; liquidoCentavos: number | null;
  status: Status; empregadoId?: string; tenantId?: string; nomeCadastro?: string; empresa?: string;
}
interface Previa {
  competencia: string | null; totalPaginas: number;
  itens: ItemPrevia[]; semHolerite: Array<{ id: string; nome: string; tenantId: string }>;
}

const reais = (c: number | null) => c == null ? '' : `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
const mesBonito = (c: string | null) => {
  if (!c) return '';
  const [a, m] = c.split('-');
  const nomes = ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return `${nomes[Number(m)] ?? m}/${a}`;
};
const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve((r.result as string).split(',')[1] ?? '');
  r.onerror = () => reject(new Error('Não consegui ler o arquivo'));
  r.readAsDataURL(file);
});

export function ImportarHolerites({ aoFechar }: { aoFechar: (enviou: boolean) => void }) {
  const [arquivoBase64, setArquivoBase64] = useState('');
  const [arquivoNome, setArquivoNome] = useState('');
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [carregando, setCarregando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [feito, setFeito] = useState<number | null>(null);
  const [erro, setErro] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function escolher(file: File | undefined) {
    if (!file) return;
    setErro('');
    if (file.type !== 'application/pdf') { setErro('Envie um arquivo PDF.'); return; }
    setCarregando(true);
    try {
      const b64 = await toBase64(file);
      setArquivoBase64(b64); setArquivoNome(file.name);
      const p = await api.post<Previa>('/holerites/importar', { arquivoBase64: b64 });
      setPrevia(p);
      const init: Record<number, string> = {};
      p.itens.forEach((it, i) => { init[i] = it.status === 'NAO_ENCONTRADO' ? '' : (it.empregadoId ?? ''); });
      setOverrides(init);
    } catch (e) { setErro((e as Error).message); setPrevia(null); }
    finally { setCarregando(false); }
  }

  // empregadoId -> tenantId, para montar o envio
  const tenantDe: Record<string, string> = {};
  previa?.itens.forEach((it) => { if (it.empregadoId && it.tenantId) tenantDe[it.empregadoId] = it.tenantId; });
  previa?.semHolerite.forEach((e) => { tenantDe[e.id] = e.tenantId; });

  const aEnviar = previa ? previa.itens.filter((_, i) => overrides[i]) : [];

  async function confirmar() {
    if (!previa || !previa.competencia) { setErro('Não detectei a competência no PDF.'); return; }
    setEnviando(true); setErro('');
    try {
      const itens = previa.itens
        .map((it, i) => ({ it, emp: overrides[i] }))
        .filter((x) => x.emp)
        .map((x) => ({ paginas: x.it.paginas, empregadoId: x.emp!, tenantId: tenantDe[x.emp!]!, liquidoCentavos: x.it.liquidoCentavos }));
      const r = await api.post<{ enviados: number }>('/holerites/confirmar', { arquivoBase64, competencia: previa.competencia, itens });
      setFeito(r.enviados);
    } catch (e) { setErro((e as Error).message); }
    finally { setEnviando(false); }
  }

  const casados = previa ? previa.itens.filter((it) => it.status !== 'NAO_ENCONTRADO').length : 0;
  const naoEnc = previa ? previa.itens.filter((it) => it.status === 'NAO_ENCONTRADO').length : 0;

  return (
    <div className={css.veu} onClick={() => aoFechar(false)}>
      <div className={css.card} onClick={(e) => e.stopPropagation()}>
        <div className={css.head}>
          <div>
            <h1>Importar holerites</h1>
            <div className={css.sub}>A contabilidade manda tudo junto — o PontoSnap recorta por página e entrega o certo pra cada um.</div>
          </div>
          <button className={css.fechar} onClick={() => aoFechar(feito != null)} aria-label="Fechar">×</button>
        </div>

        <input ref={inputRef} type="file" accept="application/pdf" style={{ display: 'none' }}
          onChange={(e) => escolher(e.target.files?.[0])} />

        {erro && <div className={css.erro}>{erro}</div>}

        {feito != null ? (
          <div className={css.feito}>
            <div className={css.big}>✅</div>
            <h2>{feito} holerite{feito === 1 ? '' : 's'} enviado{feito === 1 ? '' : 's'}</h2>
            <p>Cada funcionário recebeu o aviso e já pode ver na aba Holerites.</p>
            <div className={css.acoes} style={{ justifyContent: 'center', marginTop: 16 }}>
              <button className={css.btn} onClick={() => aoFechar(true)}>Fechar</button>
            </div>
          </div>
        ) : !previa ? (
          <div className={css.drop} onClick={() => inputRef.current?.click()}>
            {carregando ? <b>Lendo o PDF…</b> : <><b>Clique para escolher o PDF</b> da folha<div className={css.hint}>Um arquivo com todos os holerites juntos (como a contabilidade manda)</div></>}
          </div>
        ) : (
          <>
            <div className={css.arq}>
              <div className={css.ic}>PDF</div>
              <div>
                <div className={css.nm}>{arquivoNome}</div>
                <div className={css.dt}>{previa.totalPaginas} páginas · {previa.itens.length} holerites · competência {mesBonito(previa.competencia) || '— não detectada —'}</div>
              </div>
              <button className={css.troca} onClick={() => { setPrevia(null); setArquivoBase64(''); }}>Trocar arquivo</button>
            </div>

            <div className={css.stats}>
              <div className={css.ok}><div className={css.n}>{aEnviar.length}</div><div className={css.l}>prontos pra enviar</div></div>
              <div className={css.er}><div className={css.n}>{naoEnc}</div><div className={css.l}>não encontrados</div></div>
              <div className={css.av}><div className={css.n}>{previa.semHolerite.length}</div><div className={css.l}>sem holerite no PDF</div></div>
            </div>

            <div className={css.secTit}>Holerites do arquivo ({previa.itens.length})</div>
            <div className={css.lista}>
              {previa.itens.map((it, i) => {
                const incluido = !!overrides[i];
                return (
                  <div key={i} className={`${css.row} ${incluido ? '' : css.off}`}>
                    <div className={css.pg}>p.{it.paginas.join(',')}</div>
                    <div className={css.pessoa}>
                      <div className={css.nmp}>{it.nomePdf ?? '(sem nome)'}</div>
                      <div className={css.dd}>{it.cpf ? `CPF ${it.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')}` : 'sem CPF'}{it.liquidoCentavos != null ? ` · líq. ${reais(it.liquidoCentavos)}` : ''}</div>
                    </div>
                    <div className={css.seta}>→</div>
                    <div className={css.match}>
                      {it.status === 'CPF' ? (
                        <><span className={css.alvo}>{it.nomeCadastro}</span><span className={`${css.chip} ${css.ok}`}>CPF confere</span></>
                      ) : (
                        <>
                          {it.status === 'NOME'
                            ? <span className={`${css.chip} ${css.av}`}>só o nome bate</span>
                            : <span className={`${css.chip} ${css.er}`}>não encontrado</span>}
                          <select className={css.sel} value={overrides[i] ?? ''} onChange={(e) => setOverrides({ ...overrides, [i]: e.target.value })}>
                            <option value="">— ignorar —</option>
                            {it.status === 'NOME' && it.empregadoId && <option value={it.empregadoId}>{it.nomeCadastro} (pelo nome)</option>}
                            {previa.semHolerite.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                          </select>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {previa.semHolerite.length > 0 && (
              <div className={css.semfol}>
                <b>{previa.semHolerite.length} funcionário(s) da folha sem holerite neste arquivo:</b> {previa.semHolerite.map((e) => e.nome).join(', ')}. Se vierem em outro PDF, é só importar de novo.
              </div>
            )}

            <div className={css.rodape}>
              <div className={css.obs}>{casados} casado(s) por CPF/nome · {naoEnc} de fora até você atribuir.</div>
              <div className={css.acoes}>
                <button className={`${css.btn} ${css.ghost}`} onClick={() => aoFechar(false)}>Cancelar</button>
                <button className={css.btn} disabled={enviando || aEnviar.length === 0 || !previa.competencia} onClick={confirmar}>
                  {enviando ? 'Enviando…' : `Enviar ${aEnviar.length} holerite${aEnviar.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
