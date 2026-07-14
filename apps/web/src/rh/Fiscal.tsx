import { useState } from 'react';
import { api } from '../lib/api';
import { salvarBlob } from '../lib/download';
import css from './Fiscal.module.css';

function mesAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function Fiscal() {
  const [competencia, setCompetencia] = useState(mesAtual());
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);

  const [ano, mes] = competencia.split('-').map(Number);
  const ultimoDia = new Date(ano!, mes!, 0).getDate();
  const inicio = `${competencia}-01T00:00:00-03:00`;
  const fim = `${competencia}-${String(ultimoDia).padStart(2, '0')}T23:59:59-03:00`;

  async function baixar(tipo: 'afd' | 'aej', assinado: boolean) {
    const chave = `${tipo}${assinado ? '-p7s' : ''}`;
    setErro(null); setOk(null); setBaixando(chave);
    try {
      const sub = assinado ? '/p7s' : '';
      const q = `?inicio=${encodeURIComponent(inicio)}&fim=${encodeURIComponent(fim)}`;
      const blob = await api.baixar(`/fiscal/${tipo}${sub}${q}`);
      salvarBlob(blob, `${tipo}-${competencia}${assinado ? '.txt.p7s' : '.txt'}`);
      setOk(`${tipo.toUpperCase()}${assinado ? ' assinado' : ''} gerado`);
    } catch (e) { setErro((e as Error).message); }
    finally { setBaixando(null); }
  }

  return (
    <div>
      <div className={css.head}><h2>Arquivos fiscais</h2><p>Exportar e assinar AFD e AEJ da competência</p></div>

      <div className={css.filtro}>
        <label className={css.selpill}>
          <span className={css.cal}>competência</span>
          <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} className={css.mesInput} />
        </label>
      </div>

      {erro && <p className={css.erro}>{erro}</p>}
      {ok && <p className={css.ok}>● {ok}</p>}

      <div className={css.duo}>
        <div className={css.card}>
          <span className={css.kicker}>AFD · Portaria 671</span>
          <h3>Arquivo Fonte de Dados</h3>
          <p>Todas as marcações do período, com hash SHA-256 encadeado e trailer conferido. É o que a fiscalização pede primeiro.</p>
          <div className={css.acts}>
            <button className={`${css.btn} ${css.coral}`} disabled={!!baixando} onClick={() => baixar('afd', false)}>
              {baixando === 'afd' ? 'Gerando…' : 'Baixar AFD (.txt)'}
            </button>
            <button className={`${css.btn} ${css.ghost}`} disabled={!!baixando} onClick={() => baixar('afd', true)}>
              {baixando === 'afd-p7s' ? 'Assinando…' : 'Assinado (.p7s)'}
            </button>
          </div>
        </div>
        <div className={css.card}>
          <span className={css.kicker}>AEJ · Portaria 671</span>
          <h3>Arquivo Eletrônico de Jornada</h3>
          <p>As jornadas já tratadas — entradas, saídas, horários contratuais e ausências, prontas para auditoria.</p>
          <div className={css.acts}>
            <button className={`${css.btn} ${css.coral}`} disabled={!!baixando} onClick={() => baixar('aej', false)}>
              {baixando === 'aej' ? 'Gerando…' : 'Baixar AEJ (.txt)'}
            </button>
            <button className={`${css.btn} ${css.ghost}`} disabled={!!baixando} onClick={() => baixar('aej', true)}>
              {baixando === 'aej-p7s' ? 'Assinando…' : 'Assinado (.p7s)'}
            </button>
          </div>
        </div>
      </div>
      <p className={css.nota}>Os arquivos assinados usam o certificado ICP-Brasil cadastrado em <strong>Certificado</strong>.</p>
    </div>
  );
}
