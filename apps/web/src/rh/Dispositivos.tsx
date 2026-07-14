import { useState } from 'react';
import { api } from '../lib/api';
import { Botao } from '../components/Botao';
import { Campo } from '../components/Campo';
import css from './Dispositivos.module.css';

interface RespDispositivo { token: string; dispositivoId: string; nome: string; }

export function Dispositivos() {
  const [nome, setNome] = useState('');
  const [criado, setCriado] = useState<RespDispositivo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  async function registrar() {
    setErro(null); setEnviando(true);
    try {
      setCriado(await api.post<RespDispositivo>('/kiosk/dispositivos', { nome: nome.trim() }));
      setNome('');
    } catch (e) { setErro((e as Error).message); }
    finally { setEnviando(false); }
  }

  function copiar() {
    if (!criado) return;
    navigator.clipboard.writeText(criado.token).then(() => {
      setCopiado(true); setTimeout(() => setCopiado(false), 1600);
    }).catch(() => {});
  }

  return (
    <div>
      <div className={css.head}><h2>Quiosques</h2><p>Tablets de chão de fábrica — matrícula + PIN, sem login pessoal</p></div>

      <div className={css.grid}>
        <div className={css.card}>
          <span className={css.kicker}>Novo dispositivo</span>
          <h3>Registrar um tablet</h3>
          <p>Dê um nome pro aparelho (ex.: "Portaria", "Galpão 2"). Você recebe um token pra colar no tablet uma vez.</p>
          <Campo rotulo="Nome do quiosque" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Portaria" />
          {erro && <p className={css.erro}>{erro}</p>}
          <Botao variante="coral" onClick={registrar} disabled={enviando || nome.trim().length < 2}>
            {enviando ? 'Registrando…' : 'Gerar token'}
          </Botao>
        </div>

        {criado && (
          <div className={css.tokenCard}>
            <span className={css.lbl}>● {criado.nome} registrado</span>
            <p className={css.aviso}>Copie agora — o token aparece uma vez só.</p>
            <div className={css.token}>{criado.token}</div>
            <div className={css.acoes}>
              <button className={css.copiar} onClick={copiar}>{copiado ? 'copiado ✓' : 'copiar token'}</button>
            </div>
            <p className={css.passo}>No tablet, abra <code>/quiosque</code> e cole o token pra parear.</p>
          </div>
        )}
      </div>
    </div>
  );
}
