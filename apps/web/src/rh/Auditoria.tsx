import { useCallback, useEffect, useState } from 'react';
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
    [/POST \/banco\/lancar-competencia/, 'Fechou competência no banco de horas'],
    [/POST \/tratamento\/marcacoes/, 'Incluiu marcação'],
    [/DELETE \/tratamento/, 'Removeu tratamento'],
    [/POST \/tratamento\/ausencias/, 'Lançou ausência'],
    [/alterar-senha/, 'Trocou a própria senha'],
    [/POST \/marcacao\/local/, 'Definiu local do estabelecimento'],
  ];
  for (const [re, txt] of regras) if (re.test(acao)) return txt;
  return acao;
}

export function Auditoria() {
  const [linhas, setLinhas] = useState<LinhaAuditoria[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const qs = new URLSearchParams();
      if (inicio) qs.set('inicio', inicio);
      if (fim) qs.set('fim', fim);
      setLinhas(await api.get<LinhaAuditoria[]>(`/auditoria${qs.toString() ? `?${qs}` : ''}`));
    } catch (e) { setErro((e as Error).message); }
  }, [inicio, fim]);

  useEffect(() => { void carregar(); }, [carregar]);

  return (
    <div className={css.tela}>
      <h2 className={css.h}>Trilha de auditoria</h2>
      <p className={css.sub}>
        Toda ação que muda dados fica registrada aqui — quem fez, quando, de onde.
        A trilha é <strong>imutável</strong>: nem o administrador consegue apagar uma linha.
      </p>

      {erro && <p className={css.erro}>{erro}</p>}

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
            <span className={css.quem}>{l.usuarioEmail ?? 'sistema'}</span>
            {l.usuarioPerfil && <span className={css.perfil}>{l.usuarioPerfil}</span>}
            {l.statusHttp && l.statusHttp[0] === '4' && <span className={css.falhou}>recusada</span>}
            {l.ip && <span className={css.ip}>{l.ip}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
