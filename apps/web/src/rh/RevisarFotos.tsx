import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { PainelLateral } from '../components/PainelLateral';
import { useAvatares } from '../components/Avatar';
import type { Empregado } from '../tipos';
import css from './RevisarFotos.module.css';

const MOTIVOS = ['Foto escura', 'Óculos escuros ou boné', 'Rosto cortado ou longe', 'Mais de uma pessoa', 'Não é a pessoa'];

/** Foto grande de um funcionário (vem com o token, vira URL local). */
function FotoGrande({ id, nome }: { id: string; nome: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null; let vivo = true;
    api.baixar(`/cadastro/${id}/foto`).then((b) => { if (!vivo) return; u = URL.createObjectURL(b); setUrl(u); }).catch(() => setUrl(null));
    return () => { vivo = false; if (u) URL.revokeObjectURL(u); };
  }, [id]);
  return url ? <img src={url} alt={`Foto de ${nome}`} className={css.foto} /> : <span className={css.foto} aria-hidden="true" />;
}

/**
 * Revisão das fotos enviadas. A foto já vale quando a pessoa salva; aqui o RH
 * aprova ou recusa com motivo. Recusada, o app pede outra no próximo acesso.
 */
export function RevisarFotos({ aberto, onFechar, emps }: { aberto: boolean; onFechar: () => void; emps: Empregado[] }) {
  const { dados, recarregar } = useAvatares();
  const [recusando, setRecusando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [feitos, setFeitos] = useState<Record<string, 'APROVADA' | 'RECUSADA'>>({});

  useEffect(() => { if (aberto) { setFeitos({}); setErro(null); setRecusando(null); } }, [aberto]);

  const pendentes = emps.filter((e) => e.ativo && (dados?.empregados[e.id]?.status === 'REVISAR' || feitos[e.id]));

  async function decidir(id: string, aprovar: boolean) {
    if (!aprovar && !motivo.trim()) { setErro('Escolha ou escreva o motivo: ele aparece para o funcionário.'); return; }
    setSalvando(id); setErro(null);
    try {
      await api.post(`/cadastro/${id}/foto/${aprovar ? 'aprovar' : 'recusar'}`, aprovar ? {} : { motivo: motivo.trim() });
      setFeitos((f) => ({ ...f, [id]: aprovar ? 'APROVADA' : 'RECUSADA' }));
      setRecusando(null); setMotivo('');
      void recarregar();
    } catch (e) { setErro((e as Error).message); }
    finally { setSalvando(null); }
  }

  const quando = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <PainelLateral aberto={aberto} onFechar={onFechar} titulo="Fotos para revisar" largura={520}
      subtitulo="A foto já aparece no sistema. Recuse com o motivo se não estiver boa: o app pede outra."
      rodape={<button className={css.sec} onClick={onFechar}>Fechar</button>}>
      {pendentes.length === 0 && <p className={css.mudo}>Nenhuma foto esperando revisão.</p>}
      {erro && <p className={css.erro} role="alert">{erro}</p>}
      <ul className={css.lista}>
        {pendentes.map((e) => {
          const info = dados?.empregados[e.id];
          const feito = feitos[e.id];
          return (
            <li key={e.id} className={css.item}>
              <FotoGrande id={e.id} nome={e.nome} />
              <div className={css.txt}>
                <b>{e.nome}</b>
                <span>{info?.origem === 'GALERIA' ? 'da galeria' : 'tirada na câmera'}{info?.enviadaEm ? ` · ${quando(info.enviadaEm)}` : ''}</span>
                {feito ? <span className={feito === 'APROVADA' ? css.ok : css.rec}>{feito === 'APROVADA' ? '✓ Aprovada' : 'Recusada: o app vai pedir outra'}</span>
                  : recusando === e.id ? (
                    <div className={css.recusa}>
                      <div className={css.motivos} role="group" aria-label="Motivo">
                        {MOTIVOS.map((m) => <button key={m} type="button" aria-pressed={motivo === m} className={motivo === m ? css.mOn : ''} onClick={() => setMotivo(m)}>{m}</button>)}
                      </div>
                      <input aria-label="Outro motivo" placeholder="Ou escreva o motivo" value={MOTIVOS.includes(motivo) ? '' : motivo} onChange={(ev) => setMotivo(ev.target.value)} />
                      <div className={css.acoes}>
                        <button className={css.sec} onClick={() => { setRecusando(null); setMotivo(''); }}>Cancelar</button>
                        <button className={css.pri} disabled={salvando === e.id} onClick={() => decidir(e.id, false)}>{salvando === e.id ? 'Salvando…' : 'Recusar e pedir outra'}</button>
                      </div>
                    </div>
                  ) : (
                    <div className={css.acoes}>
                      <button className={css.pri} disabled={salvando === e.id} onClick={() => decidir(e.id, true)}>Aprovar</button>
                      <button className={css.sec} onClick={() => { setRecusando(e.id); setMotivo(''); }}>Recusar</button>
                    </div>
                  )}
              </div>
            </li>
          );
        })}
      </ul>
    </PainelLateral>
  );
}
