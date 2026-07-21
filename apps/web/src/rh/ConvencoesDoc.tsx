import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Convencao } from '../tipos';
import css from './Convencoes.module.css';

const VAZIA = { nome: '', sindicato: '', uf: '', vigencia: '', numeroRegistroMte: '', categoria: '', observacoes: '', pdfBase64: null as string | null, pdfNome: null as string | null };

export default function ConvencoesDoc() {
  const [lista, setLista] = useState<Convencao[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [editando, setEditando] = useState<(typeof VAZIA & { id?: string }) | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [gerando, setGerando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<{ campo: string; texto: string }[] | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try { setLista(await api.get<Convencao[]>('/convencoes')); }
    catch (e) { setErro((e as Error).message); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const set = (patch: Partial<typeof VAZIA>) => setEditando((c) => c ? { ...c, ...patch } : c);

  function novo() { setRascunho(null); setEditando({ ...VAZIA }); }
  function editar(c: Convencao) {
    setRascunho(null);
    setEditando({ id: c.id, nome: c.nome, sindicato: c.sindicato ?? '', uf: c.uf ?? '', vigencia: c.vigencia ?? '', numeroRegistroMte: c.numeroRegistroMte ?? '', categoria: c.categoria ?? '', observacoes: c.observacoes ?? '', pdfBase64: null, pdfNome: c.pdfNome ?? null });
  }

  async function anexarPdf(file: File) {
    if (file.type !== 'application/pdf') { setErro('Envie um PDF'); return; }
    const base64 = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1] ?? '');
      r.onerror = () => rej(new Error('Falha ao ler o arquivo'));
      r.readAsDataURL(file);
    });
    set({ pdfBase64: base64, pdfNome: file.name });
  }

  async function salvar() {
    if (!editando) return;
    if (!editando.nome.trim()) { setErro('Dê um nome à convenção'); return; }
    setErro(null); setSalvando(true);
    const { id, ...corpo } = editando;
    try {
      if (id) await api.patch(`/convencoes/${id}`, corpo);
      else await api.post('/convencoes', corpo);
      setEditando(null);
      await carregar();
    } catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }

  async function remover(c: Convencao) {
    if (!confirm(`Remover a convenção "${c.nome}"?`)) return;
    setErro(null);
    try { await api.del(`/convencoes/${c.id}`); await carregar(); }
    catch (e) { setErro((e as Error).message); }
  }

  async function gerarRegra(c: Convencao) {
    setErro(null); setMsg(null); setRascunho(null); setGerando(c.id);
    try {
      const out = await api.post<{ itens: number; citacoes: { campo: string; texto: string }[] }>(`/convencoes/${c.id}/gerar-regra`, {});
      setRascunho(out.citacoes);
      setMsg(`${out.itens} itens de regra criados a partir de "${c.nome}". Revise em Regras por item; no funcionário, use o atalho "aplicar convenção".`);
    } catch (e) { setErro((e as Error).message); }
    finally { setGerando(null); }
  }

  const e = editando;

  return (
    <div className={css.tela}>
      <div className={css.top}>
        <div>
          <h1 className={css.h}>Convenções (CCT/ACT)</h1>
          <p className={css.sub}>O documento da convenção: sindicato, abrangência, vigência e o PDF. A IA lê o PDF e cria uma Regra pra você revisar.</p>
        </div>
        {!e && <button className={css.novo} onClick={novo}>+ Nova convenção</button>}
      </div>

      {erro && <p className={css.erro}>{erro}</p>}
      {msg && <p className={css.ok}>{msg}</p>}

      {!e && (
        <div className={css.card}>
          {lista.length === 0 ? (
            <p className={css.vazio}>Nenhuma convenção cadastrada. Cadastre o documento da CCT/ACT aqui.</p>
          ) : (
            <table className={css.tab}>
              <thead><tr><th>Convenção</th><th>Sindicato</th><th>UF</th><th>Vigência</th><th>PDF</th><th>Func.</th><th></th></tr></thead>
              <tbody>
                {lista.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.nome}</strong>{c.categoria && <div className={css.esc}>{c.categoria}</div>}</td>
                    <td>{c.sindicato ?? '—'}</td>
                    <td className={css.mono}>{c.uf ?? '—'}</td>
                    <td className={css.mono}>{c.vigencia ?? '—'}</td>
                    <td>{c.temPdf ? <span className={css.pdfSim}>📄 anexado</span> : <span className={css.esc}>—</span>}</td>
                    <td><span className={css.pill}>{c.funcionarios ?? 0}</span></td>
                    <td className={css.acoesCell}>
                      {c.temPdf && <button className={css.link} disabled={gerando === c.id} onClick={() => gerarRegra(c)}>{gerando === c.id ? 'Lendo…' : 'gerar regra IA'}</button>}
                      <button className={css.link} onClick={() => editar(c)}>editar</button>
                      <button className={css.linkNo} onClick={() => remover(c)}>remover</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {rascunho && rascunho.length > 0 && (
            <div className={css.iaBox} style={{ marginTop: 14 }}>
              <strong>A IA baseou a Regra nestas cláusulas — confira na aba Regras:</strong>
              <ul className={css.cit}>{rascunho.map((c, i) => <li key={i}><b>{c.campo}:</b> {c.texto}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      {e && (
        <div className={css.card}>
          <h2 className={css.h2}>{e.id ? 'Editar convenção' : 'Nova convenção'}</h2>
          <p className={css.sub}>Guarde o documento. O cálculo você define (ou gera por IA) na aba Regras.</p>

          <div className={css.row}>
            <div><span className={css.lb}>Nome</span><input className={css.inp} value={e.nome} onChange={(x) => set({ nome: x.target.value })} placeholder="Ex.: CCT Rodoviários RS 2025/26" /></div>
            <div><span className={css.lb}>Sindicato</span><input className={css.inp} value={e.sindicato} onChange={(x) => set({ sindicato: x.target.value })} placeholder="Ex.: SINDICARGA-RS" /></div>
          </div>
          <div className={css.row3}>
            <div><span className={css.lb}>UF</span><input className={css.inp} maxLength={2} value={e.uf} onChange={(x) => set({ uf: x.target.value.toUpperCase() })} /></div>
            <div><span className={css.lb}>Vigência</span><input className={css.inp} value={e.vigencia} onChange={(x) => set({ vigencia: x.target.value })} placeholder="05/2025 a 04/2026" /></div>
            <div><span className={css.lb}>Nº registro MTE</span><input className={css.inp} value={e.numeroRegistroMte} onChange={(x) => set({ numeroRegistroMte: x.target.value })} placeholder="opcional" /></div>
          </div>
          <div className={css.row}>
            <div><span className={css.lb}>Categoria</span><input className={css.inp} value={e.categoria} onChange={(x) => set({ categoria: x.target.value })} placeholder="Ex.: Motoristas de carga" /></div>
            <div><span className={css.lb}>Observações</span><input className={css.inp} value={e.observacoes} onChange={(x) => set({ observacoes: x.target.value })} placeholder="opcional" /></div>
          </div>

          <span className={css.grupoLb}>Documento (PDF)</span>
          <div className={css.upload}>
            <label className={css.uploadBtn}>
              {e.pdfNome ? '📄 Trocar PDF' : '📄 Anexar PDF'}
              <input type="file" accept="application/pdf" hidden onChange={(x) => { const f = x.target.files?.[0]; if (f) void anexarPdf(f); x.target.value = ''; }} />
            </label>
            <span className={css.uploadDica}>{e.pdfNome ? e.pdfNome : 'Guarde a CCT em PDF — é dela que a IA gera a Regra.'}</span>
          </div>

          <div className={css.acoes}>
            <button className={css.salvar} onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar convenção'}</button>
            <button className={css.cancelar} onClick={() => { setEditando(null); setErro(null); }}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
