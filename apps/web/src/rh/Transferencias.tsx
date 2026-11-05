import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { Empregado } from '../tipos';
import { Avatar } from '../components/Avatar';
import css from './Transferencias.module.css';

type Aba = 'CLT' | 'PRESTADOR';
interface PessoaLista { id: string; nome: string; tipo: 'CLT' | 'MEI' | 'MOTORISTA' }

interface Info {
  origem: { razaoSocial: string };
  destinos: { tenantId: string; razaoSocial: string; cnpj: string | null }[];
  pessoa: {
    tipo: 'CLT' | 'MEI' | 'MOTORISTA'; nome: string; documento: string | null;
    cargo?: string | null; salarioMensal?: string | null; dataAdmissao?: string | null;
    valorMensal?: string | null; baseDias?: string | null; chavePix?: string | null; empresa?: string | null;
    debitosAbertos: number; batidasApos?: number;
  };
}

const hoje = () => new Date().toISOString().slice(0, 10);
const mesHoje = () => new Date().toISOString().slice(0, 7);
const reais = (v?: string | null) => v == null ? '—' : `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
const dataBR = (d?: string | null) => d ? d.split('-').reverse().join('/') : '—';
const iniciais = (n: string) => n.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

/** Transferência de pessoas (CLT e prestadores) entre CNPJs do grupo. */
export function Transferencias() {
  const [aba, setAba] = useState<Aba>('CLT');
  const [busca, setBusca] = useState('');
  const [clt, setClt] = useState<PessoaLista[]>([]);
  const [prest, setPrest] = useState<PessoaLista[]>([]);
  const [sel, setSel] = useState<PessoaLista | null>(null);
  const [info, setInfo] = useState<Info | null>(null);

  const [destino, setDestino] = useState('');
  const [data, setData] = useState(hoje());
  const [competencia, setCompetencia] = useState(mesHoje());
  const [preservar, setPreservar] = useState(true);
  const [novaAdmissao, setNovaAdmissao] = useState(hoje());
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Carrega as listas (CLT e prestadores ativos da empresa atual).
  const carregar = useCallback(async () => {
    try {
      const emps = await api.get<Empregado[]>('/empregados');
      setClt(emps.filter((e) => e.ativo).map((e) => ({ id: e.id, nome: e.nome, tipo: 'CLT' as const })));
    } catch (e) { setErro((e as Error).message); }
    try {
      const pc = await api.get<{ mei?: { empregadoId?: string; id?: string; nome: string }[]; motoristas?: { empregadoId?: string; id?: string; nome: string }[] }>(`/pessoal/competencia?comp=${mesHoje()}`);
      const mp = (arr: { empregadoId?: string; id?: string; nome: string }[] | undefined, tipo: 'MEI' | 'MOTORISTA') =>
        (arr ?? []).map((m) => ({ id: (m.id ?? m.empregadoId)!, nome: m.nome, tipo }));
      setPrest([...mp(pc.mei, 'MEI'), ...mp(pc.motoristas, 'MOTORISTA')]);
    } catch { /* prestadores opcional */ }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  // Busca o detalhe da pessoa (e as batidas após a data, no caso CLT).
  useEffect(() => {
    if (!sel) { setInfo(null); return; }
    const tipo = sel.tipo === 'CLT' ? 'CLT' : 'PRESTADOR';
    const q = `tipo=${tipo}&id=${sel.id}${sel.tipo === 'CLT' ? `&data=${data}` : ''}`;
    let vivo = true;
    api.get<Info>(`/transferencias/info?${q}`).then((r) => { if (vivo) { setInfo(r); setDestino((d) => d || (r.destinos[0]?.tenantId ?? '')); } }).catch((e) => setErro((e as Error).message));
    return () => { vivo = false; };
  }, [sel, data]);

  function escolher(p: PessoaLista) {
    setSel(p); setInfo(null); setDestino(''); setErro(null); setOk(null);
    setData(hoje()); setCompetencia(mesHoje()); setPreservar(true); setNovaAdmissao(hoje());
  }

  async function transferir() {
    if (!sel || !destino) { setErro('Escolha a empresa de destino.'); return; }
    setEnviando(true); setErro(null);
    try {
      if (sel.tipo === 'CLT') {
        await api.post(`/transferencias/clt/${sel.id}`, { destinoTenantId: destino, data, preservarAdmissao: preservar, novaAdmissao: preservar ? null : novaAdmissao, motivo: preservar ? 'TRANSFERENCIA' : 'DESLIGAMENTO' });
      } else {
        await api.post(`/transferencias/prestador/${sel.id}`, { destinoTenantId: destino, competencia });
      }
      const nome = sel.nome;
      setOk(`${nome} transferido para ${info?.destinos.find((d) => d.tenantId === destino)?.razaoSocial ?? 'o destino'}.`);
      setSel(null); setInfo(null);
      await carregar();
    } catch (e) { setErro((e as Error).message); }
    finally { setEnviando(false); }
  }

  const lista = aba === 'CLT' ? clt : prest;
  const filtrada = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return b ? lista.filter((p) => p.nome.toLowerCase().includes(b)) : lista;
  }, [lista, busca]);

  const ehClt = sel?.tipo === 'CLT';

  return (
    <div className={css.pagina}>
      <header className={css.cab}>
        <h1>Transferências de empresa</h1>
        <p>Mover alguém de um CNPJ do grupo para outro, mantendo o histórico na empresa de origem. Sem recadastrar.</p>
      </header>

      {ok && <p className={css.ok} role="status">{ok}</p>}
      {erro && <p className={css.erro} role="alert">{erro}</p>}

      <div className={css.grid}>
        <aside className={css.picker}>
          <div className={css.seg}>
            <button className={aba === 'CLT' ? css.on : ''} onClick={() => { setAba('CLT'); }}>CLT</button>
            <button className={aba === 'PRESTADOR' ? css.on : ''} onClick={() => { setAba('PRESTADOR'); }}>Prestadores</button>
          </div>
          <input className={css.busca} placeholder="Buscar pessoa..." value={busca} onChange={(e) => setBusca(e.target.value)} />
          <div className={css.lista}>
            {filtrada.length === 0 && <p className={css.vazio}>Ninguém {aba === 'CLT' ? 'CLT' : 'prestador'} ativo aqui.</p>}
            {filtrada.map((p) => (
              <button key={`${p.tipo}-${p.id}`} className={`${css.pess} ${sel?.id === p.id ? css.pessOn : ''}`} onClick={() => escolher(p)}>
                {p.tipo === 'CLT' ? <Avatar id={p.id} nome={p.nome} tamanho={30} /> : <span className={css.av}>{iniciais(p.nome)}</span>}
                <span className={css.pNome}>{p.nome}</span>
                <span className={css.tag}>{p.tipo}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className={css.form}>
          {!sel && <div className={css.placeholder}>Escolha uma pessoa à esquerda para transferir.</div>}
          {sel && !info && <div className={css.placeholder} aria-busy="true">Carregando…</div>}
          {sel && info && (
            <>
              <div className={css.fHead}>
                {ehClt ? <Avatar id={sel.id} nome={sel.nome} tamanho={42} /> : <span className={`${css.av} ${css.avBig}`}>{iniciais(sel.nome)}</span>}
                <div><h2>{info.pessoa.nome}</h2><div className={css.sub}>{info.pessoa.documento ?? ''}{info.pessoa.tipo !== 'CLT' ? ` · ${info.pessoa.tipo.toLowerCase()}` : ''}</div></div>
                <span className={css.badge}>{info.pessoa.tipo}</span>
              </div>

              <div className={css.fBody}>
                <div className={css.sec}>
                  <span className={css.lb}>Rota</span>
                  <div className={css.rota}>
                    <div className={css.emp}><small>De</small><b>{info.origem.razaoSocial}</b></div>
                    <span className={css.seta}>→</span>
                    <div className={`${css.emp} ${css.empDest}`}><small>Para</small>
                      <select value={destino} onChange={(e) => setDestino(e.target.value)}>
                        <option value="">Escolher empresa…</option>
                        {info.destinos.map((d) => <option key={d.tenantId} value={d.tenantId}>{d.razaoSocial}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {ehClt ? (
                  <>
                    <div className={css.sec}>
                      <span className={css.lb}>Data da transferência</span>
                      <input type="date" className={css.inp} value={data} onChange={(e) => setData(e.target.value)} />
                      <p className={css.aviso}>A partir desta data o ponto, a escala e a folha passam a ser da empresa destino. Antes dela, tudo fica guardado na origem.</p>
                    </div>
                    <div className={css.sec}>
                      <span className={css.lb}>Tipo de vínculo</span>
                      <button type="button" className={`${css.opt} ${preservar ? css.optOn : ''}`} onClick={() => setPreservar(true)}>
                        <span className={css.dot} /><span><b>Continuidade — preserva a admissão</b><small>Mantém admissão {dataBR(info.pessoa.dataAdmissao)}, férias e 13º. Transferência de grupo, sem rescisão.</small></span>
                      </button>
                      <button type="button" className={`${css.opt} ${!preservar ? css.optOn : ''}`} onClick={() => setPreservar(false)}>
                        <span className={css.dot} /><span><b>Nova admissão (ruptura)</b><small>Entra com nova data de admissão no destino.</small></span>
                      </button>
                      {!preservar && <input type="date" className={css.inp} value={novaAdmissao} onChange={(e) => setNovaAdmissao(e.target.value)} aria-label="Nova admissão" />}
                    </div>
                    <div className={css.sec}>
                      <span className={css.lb}>O que vai junto</span>
                      <div className={css.chips}>
                        <span className={css.chip}>Salário <b>{reais(info.pessoa.salarioMensal)}</b></span>
                        {info.pessoa.cargo && <span className={css.chip}>{info.pessoa.cargo}</span>}
                        <span className={css.chip}>VR/VT</span>
                        {info.pessoa.chavePix && <span className={css.chip}>Chave Pix</span>}
                        <span className={css.chip}>Escala</span>
                        <span className={css.chip}>Regras de ponto</span>
                        {info.pessoa.debitosAbertos > 0 && <span className={css.chip}>Débitos <b>{info.pessoa.debitosAbertos}</b></span>}
                      </div>
                    </div>
                    {(info.pessoa.batidasApos ?? 0) > 0 && (
                      <div className={css.sec}>
                        <span className={css.lb}>Batidas após {dataBR(data)} na origem</span>
                        <div className={css.warn}>{info.pessoa.batidasApos} batida{info.pessoa.batidasApos === 1 ? '' : 's'} ficam na origem (registro imutável, por lei). No destino a pessoa começa limpa a partir de {dataBR(data)}.</div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className={css.sec}>
                      <span className={css.lb}>A partir da competência</span>
                      <input type="month" className={css.inp} value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
                      <p className={css.aviso}>A partir deste mês some da folha da origem e entra na folha do destino. Os meses já fechados ficam na origem.</p>
                    </div>
                    <div className={css.sec}>
                      <span className={css.lb}>O que vai junto</span>
                      <div className={css.chips}>
                        <span className={css.chip}>Valor mensal <b>{reais(info.pessoa.valorMensal)}</b></span>
                        <span className={css.chip}>Base {info.pessoa.baseDias === 'SEG_SEX' ? 'SEG–SEX' : 'SEG–SAB'}</span>
                        {info.pessoa.chavePix && <span className={css.chip}>Chave Pix</span>}
                        {info.pessoa.empresa && <span className={css.chip}>Tomador</span>}
                        {info.pessoa.debitosAbertos > 0 && <span className={css.chip}>Débitos <b>{info.pessoa.debitosAbertos}</b></span>}
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className={css.foot}>
                <button className={css.btnSec} onClick={() => setSel(null)}>Cancelar</button>
                <button className={css.btnPri} onClick={transferir} disabled={enviando || !destino}>{enviando ? 'Transferindo…' : 'Transferir'}</button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
