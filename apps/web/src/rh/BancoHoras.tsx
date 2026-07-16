import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { hojeSP, minutosParaHhMm } from '../lib/formato';
import { Botao } from '../components/Botao';
import { Campo } from '../components/Campo';
import type { BancoResp, ConfigBanco, Empregado, TipoAcordoBanco } from '../tipos';
import css from './BancoHoras.module.css';

const fmtData = (d: string) => new Date(`${d}T12:00:00-0300`).toLocaleDateString('pt-BR');
const comSinal = (m: number) => `${m > 0 ? '+' : m < 0 ? '−' : ''}${minutosParaHhMm(Math.abs(m))}`;

const ACORDOS: { v: TipoAcordoBanco; t: string; d: string }[] = [
  { v: 'NENHUM', t: 'Não usamos', d: 'Hora extra é paga na folha. O funcionário nem vê a aba.' },
  { v: 'INDIVIDUAL', t: 'Acordo individual', d: 'Escrito com cada funcionário. Compensar em até 6 meses.' },
  { v: 'COLETIVO', t: 'Acordo coletivo', d: 'Via sindicato. Compensar em até 12 meses.' },
];

export function BancoHoras() {
  const [cfg, setCfg] = useState<ConfigBanco | null>(null);
  const [tipo, setTipo] = useState<TipoAcordoBanco>('NENHUM');
  const [prazo, setPrazo] = useState('');
  const [emps, setEmps] = useState<Empregado[]>([]);
  const [sel, setSel] = useState('');
  const [banco, setBanco] = useState<BancoResp | null>(null);
  const [comp, setComp] = useState(hojeSP().slice(0, 7));
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregarCfg = useCallback(async () => {
    try {
      const c = await api.get<ConfigBanco>('/banco/config');
      setCfg(c);
      setTipo(c.tipoAcordo);
      setPrazo(c.prazoMeses != null ? String(c.prazoMeses) : '');
    } catch (e) { setErro((e as Error).message); }
  }, []);

  useEffect(() => { void carregarCfg(); }, [carregarCfg]);
  useEffect(() => {
    (async () => {
      try { setEmps(await api.get<Empregado[]>('/empregados')); }
      catch { /* a lista é secundária aqui */ }
    })();
  }, []);

  const carregarBanco = useCallback(async (id: string) => {
    if (!id) { setBanco(null); return; }
    try { setBanco(await api.get<BancoResp>(`/banco/extrato?empregadoId=${id}&hoje=${hojeSP()}`)); }
    catch (e) { setErro((e as Error).message); }
  }, []);

  useEffect(() => { void carregarBanco(sel); }, [carregarBanco, sel]);

  async function salvarCfg() {
    setErro(null); setMsg(null); setSalvando(true);
    try {
      await api.post('/banco/config', {
        tipoAcordo: tipo,
        prazoMeses: tipo === 'NENHUM' ? null : (prazo.trim() ? Number(prazo) : undefined),
      });
      await carregarCfg();
      setMsg('Acordo salvo.');
      setTimeout(() => setMsg(null), 3000);
    } catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }

  async function lancar() {
    setErro(null); setMsg(null);
    try {
      const r = await api.post<{ lancados: number }>('/banco/lancar-competencia', {
        empregadoId: sel, competencia: comp,
      });
      setMsg(`${r.lancados} lançamento(s) de ${comp} no banco.`);
      await carregarBanco(sel);
      setTimeout(() => setMsg(null), 4000);
    } catch (e) { setErro((e as Error).message); }
  }

  async function pagarVencido() {
    if (!banco?.saldo || banco.saldo.vencidoMin <= 0) return;
    setErro(null);
    try {
      await api.post('/banco/movimento', {
        empregadoId: sel, data: hojeSP(), minutos: -banco.saldo.vencidoMin,
        tipo: 'PAGAMENTO', descricao: `Saldo vencido pago na folha`,
      });
      await carregarBanco(sel);
      setMsg('Saldo vencido baixado como pago.');
      setTimeout(() => setMsg(null), 3000);
    } catch (e) { setErro((e as Error).message); }
  }

  const s = banco?.saldo;

  return (
    <div className={css.tela}>
      <h2 className={css.h}>Banco de horas</h2>
      <p className={css.sub}>
        Banco de horas só existe com acordo. Sem ele, a hora extra é paga na folha —
        e é isso que a lei manda.
      </p>

      {erro && <p className={css.erro}>{erro}</p>}
      {msg && <p className={css.ok}>{msg}</p>}

      <div className={css.bloco}>
        <div className={css.blocoH}>Acordo da empresa</div>
        <div className={css.opcoes}>
          {ACORDOS.map((a) => (
            <button
              key={a.v}
              className={`${css.opcao} ${tipo === a.v ? css.opcaoOn : ''}`}
              onClick={() => {
                setTipo(a.v);
                setPrazo(a.v === 'INDIVIDUAL' ? '6' : a.v === 'COLETIVO' ? '12' : '');
              }}
            >
              <b>{a.t}</b>
              <span>{a.d}</span>
            </button>
          ))}
        </div>

        {tipo !== 'NENHUM' && (
          <>
            <Campo
              rotulo="Prazo para compensar (meses)" inputMode="numeric"
              value={prazo} onChange={(e) => setPrazo(e.target.value)} placeholder="6"
            />
            <p className={css.dica}>
              A CLT dá 6 meses no acordo individual escrito e 12 no coletivo.
              <strong> Se a convenção da sua categoria disser outra coisa, ela prevalece</strong> —
              ajuste aqui conforme o seu acordo.
            </p>
          </>
        )}

        <Botao variante="coral" onClick={salvarCfg} disabled={salvando}>
          {salvando ? 'Salvando…' : 'Salvar acordo'}
        </Botao>
      </div>

      {cfg?.ativo && (
        <div className={css.bloco}>
          <div className={css.blocoH}>Saldo por funcionário</div>

          <div className={css.linha}>
            <select className={css.select} value={sel} onChange={(e) => setSel(e.target.value)}>
              <option value="">Escolha o funcionário…</option>
              {emps.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
            <input
              className={css.mes} type="month" value={comp} max={hojeSP().slice(0, 7)}
              onChange={(e) => e.target.value && setComp(e.target.value)}
            />
            <Botao variante="lime" onClick={lancar} disabled={!sel}>Lançar competência</Botao>
          </div>
          <p className={css.dica}>
            "Lançar competência" leva o saldo de cada dia apurado do mês para o banco.
            Rodar de novo o mesmo mês <strong>substitui</strong> o que aquele mês tinha lançado —
            pagamentos e ajustes manuais não são tocados.
          </p>

          {s && (
            <>
              <div className={css.cards}>
                <div className={css.card}>
                  <div className={css.cL}>Saldo</div>
                  <div className={css.cV}>{comSinal(s.saldoMin)}</div>
                </div>
                <div className={css.card}>
                  <div className={css.cL}>Vence em 30 dias</div>
                  <div className={css.cV}>{s.aVencerMin > 0 ? minutosParaHhMm(s.aVencerMin) : '—'}</div>
                </div>
                <div className={`${css.card} ${s.vencidoMin > 0 ? css.cardAlerta : ''}`}>
                  <div className={css.cL}>Vencido</div>
                  <div className={css.cV}>{s.vencidoMin > 0 ? minutosParaHhMm(s.vencidoMin) : '—'}</div>
                </div>
              </div>

              {s.vencidoMin > 0 && (
                <div className={css.alerta}>
                  <div>
                    <b>{minutosParaHhMm(s.vencidoMin)} passaram do prazo.</b> Pela lei viraram hora extra
                    e precisam ser pagos em dinheiro, com adicional. Pague na folha e baixe aqui.
                  </div>
                  <Botao variante="coral" onClick={pagarVencido}>Baixar como pago</Botao>
                </div>
              )}

              <div className={css.blocoH} style={{ marginTop: 18 }}>Extrato</div>
              {banco!.extrato.length === 0 && <p className={css.vazio}>Nenhum movimento.</p>}
              {banco!.extrato.map((m, i) => (
                <div key={`${m.data}-${i}`} className={css.ext}>
                  <span className={css.extD}>{fmtData(m.data)}</span>
                  <span className={css.extE}>{m.descricao || m.tipo}</span>
                  <span className={`${css.extV} ${m.minutos > 0 ? '' : css.neg}`}>{comSinal(m.minutos)}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
