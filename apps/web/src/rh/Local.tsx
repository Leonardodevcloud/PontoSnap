import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { capturarPosicao } from '../lib/geolocalizacao';
import { Campo } from '../components/Campo';
import { Botao } from '../components/Botao';
import css from './Local.module.css';

interface Local {
  localPrestacao: string | null;
  latitude: number | null;
  longitude: number | null;
  raioMetros: number | null;
}

export function Local() {
  const [endereco, setEndereco] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [raio, setRaio] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [buscando, setBuscando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const l = await api.get<Local>('/marcacao/local');
      setEndereco(l.localPrestacao ?? '');
      setLat(l.latitude != null ? String(l.latitude) : '');
      setLon(l.longitude != null ? String(l.longitude) : '');
      setRaio(l.raioMetros != null ? String(l.raioMetros) : '');
    } catch (e) { setErro((e as Error).message); }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  async function usarAqui() {
    setBuscando(true);
    setErro(null);
    const r = await capturarPosicao();
    setBuscando(false);
    if (r.estado !== 'ok') {
      setErro(r.estado === 'negada'
        ? 'Você precisa permitir a localização no navegador para usar este atalho.'
        : 'Não consegui obter a localização deste aparelho.');
      return;
    }
    setLat(r.posicao.latitude.toFixed(7));
    setLon(r.posicao.longitude.toFixed(7));
  }

  async function salvar() {
    setErro(null); setOk(false); setEnviando(true);
    try {
      const temGeo = lat.trim() !== '' && lon.trim() !== '';
      await api.post('/marcacao/local', {
        localPrestacao: endereco.trim() || undefined,
        latitude: temGeo ? Number(lat.replace(',', '.')) : null,
        longitude: temGeo ? Number(lon.replace(',', '.')) : null,
        raioMetros: raio.trim() ? Number(raio) : null,
      });
      setOk(true);
      setTimeout(() => setOk(false), 3000);
    } catch (e) { setErro((e as Error).message); }
    finally { setEnviando(false); }
  }

  function limpar() { setLat(''); setLon(''); setRaio(''); }

  return (
    <div className={css.tela}>
      <h2 className={css.h}>Local do estabelecimento</h2>
      <p className={css.sub}>
        Serve só para o app saber quando pedir uma observação ao funcionário.
        <strong> A batida nunca é bloqueada</strong> — a lei não permite restringir marcação.
      </p>

      <div className={css.bloco}>
        <Campo
          rotulo="Endereço" value={endereco}
          onChange={(e) => setEndereco(e.target.value)}
          placeholder="Av. Tancredo Neves, 1283 — Salvador/BA"
        />

        <div className={css.coords}>
          <Campo rotulo="Latitude" inputMode="decimal" value={lat}
            onChange={(e) => setLat(e.target.value)} placeholder="-12.9777000" />
          <Campo rotulo="Longitude" inputMode="decimal" value={lon}
            onChange={(e) => setLon(e.target.value)} placeholder="-38.5016000" />
        </div>

        <button className={css.aqui} onClick={usarAqui} disabled={buscando}>
          {buscando ? 'Buscando…' : 'Usar a localização deste aparelho'}
        </button>
        <p className={css.dica}>
          Abra esta tela no escritório e toque no botão acima — é o jeito mais fácil.
          Ou copie as coordenadas do Google Maps (clique com o botão direito no ponto → a primeira linha).
        </p>

        <Campo
          rotulo="Raio em metros" inputMode="numeric" value={raio}
          onChange={(e) => setRaio(e.target.value)} placeholder="200"
        />
        <p className={css.dica}>
          Fora desse raio, o app pede uma observação (home office, visita a cliente…).
          Entre 20 e 50000 metros. <strong>Deixe em branco se a empresa é remota</strong> — aí ninguém nunca vê o campo.
        </p>

        {erro && <p className={css.erro}>{erro}</p>}
        {ok && <p className={css.ok}>Local salvo.</p>}

        <div className={css.acoes}>
          <Botao variante="coral" onClick={salvar} disabled={enviando}>
            {enviando ? 'Salvando…' : 'Salvar'}
          </Botao>
          <Botao variante="ghost" onClick={limpar}>Não usar localização</Botao>
        </div>
      </div>

      <div className={css.lgpd}>
        <strong>Sobre privacidade:</strong> a localização é capturada só no instante da batida —
        nunca em segundo plano. Ela não vai para o arquivo fiscal (AFD), fica como contexto aqui
        no PontoSnap, visível para você e para o próprio funcionário. Informe isso à sua equipe
        no contrato ou em aditivo, e confira com seu advogado trabalhista antes de ativar.
      </div>
    </div>
  );
}
