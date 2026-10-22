import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { LinhaAuditoria } from '../tipos';
import css from './Auditoria.module.css';

const fmtQuando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });

/** Traduz o verbo+rota técnico para algo que o RH entende. */
function legivel(acao: string): string {
  const regras: [RegExp, string][] = [
    [/POST \/empregados$/, 'Cadastrou funcionário'],
    [/PATCH \/empregados\/.*\/horario/, 'Vinculou horário a funcionário'],
    [/PATCH \/empregados\/.*\/pin/, 'Definiu PIN de funcionário'],
    [/PATCH \/empregados\/.*\/ativo/, 'Ativou/desativou funcionário'],
    [/POST \/empregados\/.*\/acesso/, 'Criou acesso de funcionário'],
    [/POST \/documentos\/.*\/decidir/, 'Decidiu sobre atestado'],
    [/POST \/documentos/, 'Enviou atestado'],
    [/POST \/afastamentos/, 'Lançou férias/afastamento'],
    [/DELETE \/afastamentos/, 'Removeu férias/afastamento'],
    [/POST \/banco\/config/, 'Alterou acordo de banco de horas'],
    [/POST \/banco\/movimento/, 'Lançou movimento no banco de horas'],
    [/POST \/banco\/baixa-abertura/, 'Baixou saldos de abertura pagos na folha'],
    [/POST \/banco\/lancar-competencia/, 'Fechou competência no banco de horas'],
    [/POST \/tratamento\/marcacoes/, 'Incluiu marcação'],
    [/DELETE \/tratamento/, 'Removeu tratamento'],
    [/POST \/tratamento\/ausencias/, 'Lançou ausência'],
    [/alterar-senha/, 'Trocou a própria senha'],
    [/POST \/marcacao\/local/, 'Definiu local do estabelecimento'],
    [/POST \/portal\/eu\/notas\/.*\/enviar/, 'Enviou a nota fiscal'],
    [/POST \/portal\/eu\/notas\/.*\/ler/, 'Conferiu a nota antes de enviar'],
    [/POST \/portal\/eu\/notas\/.*\/visto/, 'Abriu o valor liberado'],
    [/POST \/portal\/eu\/notas\/.*\/confirmar/, 'Confirmou ou contestou o valor'],
    [/POST \/usuarios\/.*\/senha/, 'Gerou senha nova de um usuário'],
    [/PATCH \/usuarios\/.*\/ativo/, 'Ativou/desativou um usuário'],
    [/PATCH \/usuarios\/.*\/email/, 'Trocou o e-mail de um usuário'],
    [/PATCH \/usuarios\//, 'Editou um usuário (papel/empresas)'],
    [/POST \/usuarios$/, 'Criou um usuário'],
    [/POST \/portal\/rh\/liberar/, 'Liberou valores para os prestadores'],
    [/POST \/portal\/rh\/aprovar/, 'Aprovou nota de prestador'],
    [/POST \/portal\/rh\/notas\/.*\/recusar/, 'Recusou nota de prestador'],
    [/POST \/portal\/rh\/pagar/, 'Registrou pagamento de prestador'],
    [/modelos-nota/, 'Alterou modelo de nota fiscal'],
    [/PUT \/pessoal\/lancamento/, 'Lançou valores na Folha e benefícios'],
    [/POST \/pessoal\/fechar/, 'Fechou o mês na Folha e benefícios'],
    [/POST \/pessoal\/reabrir/, 'Reabriu o mês na Folha e benefícios'],
  ];
  for (const [re, txt] of regras) if (re.test(acao)) return txt;
  return acao;
}

export function Auditoria() {
  const [linhas, setLinhas] = useState<LinhaAuditoria[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [params, setParams] = useSearchParams();
  const pessoa = params.get('pessoa');
  const [pessoas, setPessoas] = useState<{ id: string; nome: string; email: string; ativo: boolean; saiu: boolean; acoes: number }[]>([]);
  const [outros, setOutros] = useState(0);
  const escolher = (id: string | null) => { const p = new URLSearchParams(params); if (id) p.set('pessoa', id); else p.delete('pessoa'); setParams(p, { replace: true }); };

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const qs = new URLSearchParams();
      if (inicio) qs.set('inicio', inicio);
      if (fim) qs.set('fim', fim);
      const [ls, ps] = await Promise.all([
        api.get<LinhaAuditoria[]>(`/auditoria?${new URLSearchParams([...qs, ...(pessoa === 'OUTROS' ? [['outros', '1']] : pessoa ? [['usuarioId', pessoa]] : [])])}`),
        api.get<{ pessoas: typeof pessoas; outros: number }>(`/auditoria/pessoas${qs.toString() ? `?${qs}` : ''}`),
      ]);
      setLinhas(ls); setPessoas(ps.pessoas); setOutros(ps.outros);
    } catch (e) { setErro((e as Error).message); }
  }, [inicio, fim, pessoa]);

  useEffect(() => { void carregar(); }, [carregar]);

  return (
    <div className={css.tela}>
      <h2 className={css.h}>Trilha de auditoria</h2>
      <p className={css.sub}>
        Toda ação que muda dados fica registrada aqui — quem fez, quando, de onde.
        A trilha é <strong>imutável</strong>: nem o administrador consegue apagar uma linha.
      </p>

      {erro && <p className={css.erro}>{erro}</p>}

      {pessoas.length > 0 && (
        <div className={css.pessoas} role="group" aria-label="Filtrar por pessoa">
          <span>Pessoa:</span>
          <button type="button" className={`${css.pessoa} ${!pessoa ? css.pessoaOn : ''}`} aria-pressed={!pessoa} onClick={() => escolher(null)}>Todas</button>
          {pessoas.map((p) => (
            <button key={p.id} type="button" className={`${css.pessoa} ${pessoa === p.id ? css.pessoaOn : ''} ${p.ativo ? '' : css.pessoaInativa}`} aria-pressed={pessoa === p.id}
              title={`${p.nome}${p.email ? ` · ${p.email}` : ''}${p.saiu ? ' · não acessa mais esta empresa' : p.ativo ? '' : ' · desativado'}`} onClick={() => escolher(p.id)}>
              {p.nome.split(' ')[0]}{p.nome.split(' ').length > 1 ? ` ${p.nome.split(' ').slice(-1)[0]![0]}.` : ''} · {p.acoes}{p.saiu ? ' · saiu' : !p.ativo ? ' · desativado' : ''}
            </button>
          ))}
          {outros > 0 && (
            <button type="button" className={`${css.pessoa} ${css.pessoaOutros} ${pessoa === 'OUTROS' ? css.pessoaOn : ''}`} aria-pressed={pessoa === 'OUTROS'}
              title="Ações feitas pelo app: batidas, pedidos, notas enviadas…" onClick={() => escolher('OUTROS')}>Funcionários e prestadores · {outros}</button>
          )}
        </div>
      )}

      <div className={css.filtros}>
        <label>De <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} /></label>
        <label>até <input type="date" value={fim} onChange={(e) => setFim(e.target.value)} /></label>
        {(inicio || fim) && (
          <button className={css.limpar} onClick={() => { setInicio(''); setFim(''); }}>limpar</button>
        )}
      </div>

      {linhas.length === 0 && <p className={css.vazio}>Nenhum registro no período.</p>}

      {linhas.map((l) => (
        <div key={l.id} className={css.linha}>
          <div className={css.linhaTop}>
            <span className={css.acao}>{legivel(l.acao)}</span>
            <span className={css.quando}>{fmtQuando(l.em)}</span>
          </div>
          <div className={css.meta}>
            <span className={css.quem}>{l.usuarioNome ? <><b>{l.usuarioNome}</b>{l.usuarioEmail && !l.usuarioEmail.includes('@portal.') ? ` · ${l.usuarioEmail}` : ''}</> : l.usuarioEmail ?? 'sistema'}</span>
            {l.usuarioPerfil && <span className={css.perfil}>{l.usuarioPerfil}</span>}
            {l.statusHttp && l.statusHttp[0] === '4' && <span className={css.falhou}>recusada</span>}
            {l.ip && <span className={css.ip}>{l.ip}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
