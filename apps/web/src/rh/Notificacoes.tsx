import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { Avatar } from '../components/Avatar';
import css from './Notificacoes.module.css';

interface Aparelho { id: string; aparelho: string; criadoEm: string; ultimoSucessoEm: string | null; ultimoErro: string | null; ultimoErroEm: string | null }
interface Pessoa {
  empregadoId: string; nome: string; temApp: boolean; aparelhos: Aparelho[];
  preferencias: { lembretes: boolean; lembreteMinutos: number; esqueceu: boolean; personalizou: boolean };
}
interface Envio { id: string; empregadoId: string | null; nome: string; tipo: string; titulo: string; criadoEm: string; dispositivos: number; entregues: number; erro: string | null }
interface Painel { servidor: { ativo: boolean }; resumo: { ativos: number; comApp: number; comNotificacao: number }; pessoas: Pessoa[]; envios: Envio[] }

type Filtro = 'TODOS' | 'ATIVAS' | 'NAO_ATIVOU' | 'SEM_APP';
const TIPOS: Record<string, string> = {
  lembreteAntes: 'lembrete', esqueceuEntrada: 'esqueceu a entrada', esqueceuAlmoco: 'esqueceu o almoço', esqueceuSaida: 'esqueceu a saída',
  ajusteRespondido: 'ajuste respondido', atestadoAnalisado: 'atestado', resumoSemanal: 'resumo semanal', sempre: 'aviso do RH', teste: 'teste', comunicado: 'comunicado',
};
const quando = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso); const hoje = new Date();
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === hoje.toDateString() ? `hoje ${hora}` : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora}`;
};
const situacao = (p: Pessoa) => (!p.temApp ? 'SEM_APP' : p.aparelhos.length === 0 ? 'NAO_ATIVOU' : 'ATIVAS');

/** Quem recebe as notificações do app, em quais aparelhos, e o que foi enviado. */
export function Notificacoes() {
  const [d, setD] = useState<Painel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('TODOS');
  const [teste, setTeste] = useState<Record<string, string>>({});

  const carregar = useCallback(async () => {
    try { setD(await api.get<Painel>('/notificacao/painel')); setErro(null); }
    catch (e) { setErro((e as Error).message); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function enviarTeste(p: Pessoa) {
    setTeste((t) => ({ ...t, [p.empregadoId]: 'Enviando…' }));
    try {
      const r = await api.post<{ dispositivos: number; entregues: number }>(`/notificacao/teste/${p.empregadoId}`);
      setTeste((t) => ({ ...t, [p.empregadoId]: r.entregues > 0
        ? `Chegou em ${r.entregues} ${r.entregues === 1 ? 'aparelho' : 'aparelhos'}`
        : r.dispositivos === 0 ? 'Nenhum aparelho ativo' : 'Não chegou: o aparelho recusou' }));
      void carregar();
    } catch (e) { setTeste((t) => ({ ...t, [p.empregadoId]: (e as Error).message })); }
  }

  const lista = useMemo(() => (d?.pessoas ?? []).filter((p) => filtro === 'TODOS' || situacao(p) === filtro), [d, filtro]);
  const r = d?.resumo;
  const pct = r && r.ativos ? Math.round((r.comNotificacao / r.ativos) * 100) : 0;
  const nao = d ? d.pessoas.filter((p) => situacao(p) === 'NAO_ATIVOU').length : 0;
  const semApp = d ? d.pessoas.filter((p) => situacao(p) === 'SEM_APP').length : 0;

  return (
    <div className={css.pagina}>
      <div>
        <h2 className={css.h}>Notificações do app</h2>
        <p className={css.sub}>Quem recebe lembretes de ponto no celular, em quais aparelhos, e o que foi enviado.</p>
      </div>

      {erro && <p className={css.erro}>{erro}</p>}
      {d && !d.servidor.ativo && (
        <div className={css.alerta} role="alert">
          <b>O servidor está sem as chaves de notificação.</b> Nenhuma notificação sai até configurar as variáveis
          <code>VAPID_PUBLIC_KEY</code> e <code>VAPID_PRIVATE_KEY</code> na API.
        </div>
      )}

      {r && (
        <section className={css.resumo}>
          <div className={css.resumoTxt}>
            <b>{r.comNotificacao} de {r.ativos} recebem notificações</b>
            <div className={css.barra} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Com notificação ativa"><i style={{ width: `${pct}%` }} /></div>
            <small>{[nao > 0 && `${nao} ${nao === 1 ? 'tem' : 'têm'} o app mas não ativou`, semApp > 0 && `${semApp} sem acesso ao app`].filter(Boolean).join(' · ') || 'Todo mundo com notificação ativa.'}</small>
          </div>
          <div className={css.como}>
            <b>Como ativar no celular</b>
            <span>Android: abrir o app › menu › Notificações › Ativar.</span>
            <span>iPhone: instalar o app na tela de início (Compartilhar › Adicionar à Tela de Início) e ativar por lá. No Safari aberto direto não funciona.</span>
          </div>
        </section>
      )}

      {d && (
        <div className={css.filtros} role="group" aria-label="Filtrar">
          {([['TODOS', 'Todos', d.pessoas.length], ['ATIVAS', 'Recebem', r!.comNotificacao], ['NAO_ATIVOU', 'Não ativaram', nao], ['SEM_APP', 'Sem app', semApp]] as const).map(([k, rot, n]) => (
            <button key={k} className={`${css.fl} ${filtro === k ? css.flOn : ''}`} aria-pressed={filtro === k} onClick={() => setFiltro(k)}>{rot}<span>{n}</span></button>
          ))}
        </div>
      )}

      {d && (
        <div className={css.tab}><table className={css.tabela}>
          <thead><tr><th>Funcionário</th><th>Situação</th><th>Aparelhos</th><th>Última entrega</th><th>Preferências</th><th><span className={css.sr}>Teste</span></th></tr></thead>
          <tbody>
            {lista.length === 0 && <tr><td colSpan={6} className={css.vazio}>Ninguém neste filtro.</td></tr>}
            {lista.map((p) => {
              const s = situacao(p);
              const ultima = p.aparelhos.map((a) => a.ultimoSucessoEm).filter(Boolean).sort().at(-1) ?? null;
              const comErro = p.aparelhos.find((a) => a.ultimoErro);
              return (
                <tr key={p.empregadoId}>
                  <td><span className={css.pes}><Avatar id={p.empregadoId} nome={p.nome} tamanho={34} /><b>{p.nome}</b></span></td>
                  <td>
                    {s === 'ATIVAS' && <span className={`${css.chip} ${comErro ? css.chipAv : css.chipOk}`}>{comErro ? 'ativa · com erro' : 'recebe'}</span>}
                    {s === 'NAO_ATIVOU' && <span className={`${css.chip} ${css.chipAv}`}>não ativou</span>}
                    {s === 'SEM_APP' && <span className={css.chip}>sem acesso ao app</span>}
                  </td>
                  <td className={css.aparelhos}>
                    {p.aparelhos.length === 0 ? <span className={css.mudo}>—</span> : p.aparelhos.map((a) => (
                      <span key={a.id} title={a.ultimoErro ? `Último erro (${quando(a.ultimoErroEm)}): ${a.ultimoErro}` : `Ativado ${quando(a.criadoEm)}`}>
                        {a.aparelho}{a.ultimoErro && <em className={css.err}> · erro</em>}
                      </span>
                    ))}
                  </td>
                  <td className={css.mono}>{quando(ultima)}</td>
                  <td className={css.pref}>
                    {!p.temApp ? <span className={css.mudo}>—</span> : <>
                      <span>{p.preferencias.lembretes ? `lembra ${p.preferencias.lembreteMinutos} min antes` : 'lembrete desligado'}</span>
                      <span>{p.preferencias.esqueceu ? 'avisa se esquecer' : '"esqueceu" desligado'}</span>
                    </>}
                  </td>
                  <td className={css.acao}>
                    {p.temApp && <button className={css.btn} onClick={() => enviarTeste(p)} disabled={!d.servidor.ativo || teste[p.empregadoId] === 'Enviando…'}>Enviar teste</button>}
                    {teste[p.empregadoId] && <small role="status">{teste[p.empregadoId]}</small>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}

      {d && (
        <section className={css.envios}>
          <h3>Últimas notificações enviadas</h3>
          {d.envios.length === 0 && <p className={css.mudo}>Nenhuma notificação enviada ainda.</p>}
          <ul>
            {d.envios.map((v) => (
              <li key={v.id}>
                <span className={css.mono}>{quando(v.criadoEm)}</span>
                {v.empregadoId ? <Avatar id={v.empregadoId} nome={v.nome} tamanho={26} /> : <span className={css.semAv} />}
                <span className={css.envTxt}><b>{v.nome}</b> · {v.titulo} <em>{TIPOS[v.tipo] ?? v.tipo}</em></span>
                {v.entregues > 0
                  ? <span className={`${css.chip} ${css.chipOk}`}>entregue{v.entregues > 1 ? ` em ${v.entregues}` : ''}</span>
                  : <span className={`${css.chip} ${css.chipAv}`} title={v.erro ?? undefined}>não chegou{v.erro ? `: ${v.erro}` : ''}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
