import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { PainelLateral } from '../components/PainelLateral';
import { Avatar } from '../components/Avatar';
import css from './Inicio.module.css';

interface BatFalt { hora: string; nsr: number | null; id: string }
interface DiaFalt { data: string; batidas: BatFalt[]; esperadas: number; pares: { entrada: string; saida: string }[] }
interface Grupo { nome: string; empregadoId: string; dias: DiaFalt[] }
interface Resp { total: number; grupos: Grupo[] }

const ROTULOS = ['Entrada', 'Almoço', 'Volta', 'Saída'];
const DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const fmtDia = (iso: string) => `${DOW[new Date(`${iso}T12:00:00-0300`).getDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const min = (h: string) => { const m = /(\d{1,2})[h:](\d{2})/.exec(h); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };

/** Rótulo de cada horário previsto (entrada, almoço, volta, saída…). */
function rotuloSlot(i: number, total: number) {
  if (total === 4) return ROTULOS[i]!;
  if (i === 0) return 'Entrada';
  if (i === total - 1) return 'Saída';
  return i % 2 === 1 ? 'Saída intervalo' : 'Volta intervalo';
}

/**
 * Qual horário previsto ficou sem batida: casa cada batida com o horário
 * previsto mais próximo; o que sobra é o que falta.
 */
function slotFaltando(dia: DiaFalt): { idx: number; hora: string; total: number } {
  const slots = dia.pares.flatMap((p) => [p.entrada, p.saida]);
  if (slots.length === 0) return { idx: dia.batidas.length, hora: '', total: dia.batidas.length + 1 };
  const livres = new Set(slots.map((_, i) => i));
  for (const b of dia.batidas) {
    let melhor = -1, dist = Infinity;
    for (const i of livres) { const d = Math.abs(min(slots[i]!) - min(b.hora)); if (d < dist) { dist = d; melhor = i; } }
    if (melhor >= 0) livres.delete(melhor);
  }
  const idx = livres.size ? Math.min(...livres) : dia.batidas.length;
  return { idx, hora: slots[idx] ?? '', total: slots.length };
}

/** Completa as batidas em aberto sem sair do Início: lança um ajuste de inclusão por dia. */
export function CompletarBatidas({ aberto, onFechar, onSalvo }: { aberto: boolean; onFechar: () => void; onSalvo: (n: number) => void }) {
  const [dados, setDados] = useState<Resp | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [horas, setHoras] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState('Esqueceu de bater');
  const [outro, setOutro] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setDados(null); setErro(null); setHoras({});
    api.get<Resp>('/tratamento/batidas-faltando').then((r) => {
      setDados(r);
      const ini: Record<string, string> = {};
      for (const g of r.grupos) for (const d of g.dias) ini[`${g.empregadoId}|${d.data}`] = slotFaltando(d).hora;
      setHoras(ini);
    }).catch((e) => setErro((e as Error).message));
  }, [aberto]);

  const preenchidos = Object.entries(horas).filter(([, h]) => /^\d{2}:\d{2}$/.test(h));
  const texto = motivo === 'Outro' ? outro.trim() : motivo;

  async function salvar() {
    if (!dados) return;
    if (texto.length < 3) { setErro('Escreva o motivo do ajuste.'); return; }
    setSalvando(true); setErro(null);
    let feitos = 0;
    try {
      for (const g of dados.grupos) for (const d of g.dias) {
        const h = horas[`${g.empregadoId}|${d.data}`];
        if (!h || !/^\d{2}:\d{2}$/.test(h)) continue;
        const { idx } = slotFaltando(d);
        await api.post('/ajustes/lancar', {
          empregadoId: g.empregadoId, tipo: 'INCLUSAO', data: d.data, hora: h,
          tpMarc: idx % 2 === 0 ? 'E' : 'S', observacao: texto,
        });
        feitos++;
      }
      onSalvo(feitos);
    } catch (e) {
      setErro(`${feitos > 0 ? `${feitos} salvas. ` : ''}${(e as Error).message}`);
      if (feitos > 0) onSalvo(feitos);
    } finally { setSalvando(false); }
  }

  const totalDias = dados?.grupos.reduce((a, g) => a + g.dias.length, 0) ?? 0;
  return (
    <PainelLateral aberto={aberto} onFechar={onFechar} titulo="Completar batidas"
      subtitulo={dados ? `${totalDias} ${totalDias === 1 ? 'dia' : 'dias'} · confira o horário sugerido e salve` : 'Carregando…'}
      rodape={<>
        <button className={css.btnSec} onClick={onFechar}>Cancelar</button>
        <button className={css.btnPri} onClick={salvar} disabled={salvando || preenchidos.length === 0}>
          {salvando ? 'Salvando…' : `Salvar ${preenchidos.length} ${preenchidos.length === 1 ? 'batida' : 'batidas'}`}
        </button>
      </>}>
      {!dados && !erro && <p className={css.mudo}>Carregando os dias em aberto…</p>}
      {dados && dados.grupos.length === 0 && <p className={css.mudo}>Nenhuma batida faltando. Tudo em dia.</p>}
      {dados?.grupos.map((g) => (
        <section key={g.empregadoId} className={css.cbPessoa}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Avatar id={g.empregadoId} nome={g.nome} tamanho={32} />{g.nome}</h3>
          {g.dias.map((d) => {
            const k = `${g.empregadoId}|${d.data}`;
            const f = slotFaltando(d);
            const slots = d.pares.flatMap((p) => [p.entrada, p.saida]);
            const batidasOrdenadas = [...d.batidas].sort((a, b) => min(a.hora) - min(b.hora));
            return (
              <div key={d.data} className={css.cbDia}>
                <div className={css.cbDiaT}>
                  <b>{fmtDia(d.data)}</b>
                  {slots.length > 0 && <small>escala {d.pares.map((p) => `${p.entrada}–${p.saida}`).join(' · ')}</small>}
                </div>
                <div className={css.cbBat}>
                  {batidasOrdenadas.map((b) => <span key={b.id} className={css.cbChip}><small>batida</small>{b.hora}</span>)}
                  <label className={`${css.cbChip} ${css.cbFalta}`}>
                    <small>{rotuloSlot(f.idx, f.total)} · falta</small>
                    <input type="time" value={horas[k] ?? ''} aria-label={`${rotuloSlot(f.idx, f.total)} de ${g.nome} em ${fmtDia(d.data)}`}
                      onChange={(e) => setHoras((h) => ({ ...h, [k]: e.target.value }))} />
                  </label>
                </div>
              </div>
            );
          })}
        </section>
      ))}
      {dados && dados.grupos.length > 0 && (
        <div className={css.cbMotivo}>
          <label htmlFor="cb-motivo">Motivo (vai para a auditoria)</label>
          <select id="cb-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
            <option>Esqueceu de bater</option>
            <option>Celular sem bateria</option>
            <option>Problema no quiosque</option>
            <option>Sem internet na hora</option>
            <option>Outro</option>
          </select>
          {motivo === 'Outro' && (
            <input aria-label="Descreva o motivo" placeholder="Ex.: confirmou por mensagem que saiu 18h" value={outro} onChange={(e) => setOutro(e.target.value)} />
          )}
          <p>A batida original não é apagada: o ajuste fica registrado ao lado, como manda a Portaria 671.</p>
        </div>
      )}
      {erro && <p className={css.erro} role="alert">{erro}</p>}
    </PainelLateral>
  );
}
