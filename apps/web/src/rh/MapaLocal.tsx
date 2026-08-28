import { useEffect, useRef, useState } from 'react';
import { carregarMaps, type GMap, type GMarker, type GCircle, type GGeocoder } from '../lib/googleMaps';
import css from './MapaLocal.module.css';

interface Props {
  lat: number | null;
  lon: number | null;
  raio: number | null;         // em metros; 0/null = sem círculo
  onMover?: (lat: number, lon: number) => void; // pin arrastado ou clique
  onEndereco?: (endereco: string) => void;      // resultado da busca por endereço
  somenteLeitura?: boolean;    // modo "ver": pin fixo, sem busca
}

// Fallback quando não há coordenadas: centro de Salvador/BA.
const CENTRO_PADRAO = { lat: -12.9777, lng: -38.5016 };

/**
 * Mapa interativo do Google para escolher o local do estabelecimento.
 * Pin arrastável, clique pra reposicionar, círculo do raio ao vivo e busca
 * por endereço (Geocoding). Toda mudança de posição chama onMover.
 */
export function MapaLocal({ lat, lon, raio, onMover, onEndereco, somenteLeitura = false }: Props) {
  const div = useRef<HTMLDivElement | null>(null);
  const mapa = useRef<GMap | null>(null);
  const marca = useRef<GMarker | null>(null);
  const circ = useRef<GCircle | null>(null);
  const geo = useRef<GGeocoder | null>(null);
  const onMoverRef = useRef(onMover);
  onMoverRef.current = onMover;
  const mover = (la: number, lo: number) => onMoverRef.current?.(la, lo);

  const [pronto, setPronto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [buscando, setBuscando] = useState(false);

  // Inicializa o mapa uma vez.
  useEffect(() => {
    let vivo = true;
    carregarMaps().then((g) => {
      if (!vivo || !div.current) return;
      const centro = lat != null && lon != null ? { lat, lng: lon } : CENTRO_PADRAO;
      const map = new g.maps.Map(div.current, {
        center: centro, zoom: lat != null ? 16 : 12,
        mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
        gestureHandling: 'greedy',
      });
      const marker = new g.maps.Marker({
        position: centro, map, draggable: !somenteLeitura, animation: g.maps.Animation.DROP,
      });
      const circle = new g.maps.Circle({
        map: raio && raio > 0 ? map : null, center: centro, radius: raio ?? 0,
        fillColor: '#FF6B4A', fillOpacity: 0.12, strokeColor: '#FF6B4A', strokeWeight: 2,
      });
      geo.current = new g.maps.Geocoder();

      if (!somenteLeitura) {
        // Arrastar o pin → atualiza coords (e recentraliza o círculo).
        g.maps.event.addListener(marker, 'dragend', () => {
          const p = marker.getPosition();
          if (!p) return;
          const nlat = p.lat(), nlng = p.lng();
          (circle as unknown as { setCenter: (x: unknown) => void }).setCenter({ lat: nlat, lng: nlng });
          mover(nlat, nlng);
        });
        // Clicar no mapa → move o pin pra lá.
        g.maps.event.addListener(map, 'click', (e) => {
          if (!e.latLng) return;
          const nlat = e.latLng.lat(), nlng = e.latLng.lng();
          marker.setPosition({ lat: nlat, lng: nlng });
          (circle as unknown as { setCenter: (x: unknown) => void }).setCenter({ lat: nlat, lng: nlng });
          mover(nlat, nlng);
        });
      }

      mapa.current = map; marca.current = marker; circ.current = circle;
      setPronto(true);
    }).catch((e) => setErro((e as Error).message));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Coordenadas mudaram por fora (ex.: "usar este aparelho") → reposiciona.
  useEffect(() => {
    if (!pronto || lat == null || lon == null) return;
    const p = { lat, lng: lon };
    marca.current?.setPosition(p);
    (circ.current as unknown as { setCenter: (x: unknown) => void } | null)?.setCenter(p);
    mapa.current?.setCenter(p);
  }, [lat, lon, pronto]);

  // Raio mudou → atualiza o círculo (mostra/esconde conforme > 0).
  useEffect(() => {
    if (!pronto || !circ.current) return;
    circ.current.setRadius(raio ?? 0);
    circ.current.setMap(raio && raio > 0 ? mapa.current : null);
  }, [raio, pronto]);

  function buscarEndereco() {
    const q = busca.trim();
    if (!q || !geo.current) return;
    setBuscando(true);
    geo.current.geocode({ address: q }, (results, status) => {
      setBuscando(false);
      if (status !== 'OK' || !results || !results[0]) {
        setErro('Endereço não encontrado. Tente ser mais específico.');
        return;
      }
      setErro(null);
      const loc = results[0].geometry.location;
      const nlat = loc.lat(), nlng = loc.lng();
      mover(nlat, nlng);
      onEndereco?.(results[0].formatted_address);
    });
  }

  if (erro && !pronto) {
    // Falhou ao carregar o mapa (sem chave, sem rede, domínio não autorizado…).
    return <p className={css.erroMapa}>Não foi possível carregar o mapa ({erro}). Use os campos de coordenadas abaixo.</p>;
  }

  return (
    <div className={css.wrap}>
      {!somenteLeitura && (
        <div className={css.busca}>
          <input
            value={busca} onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && buscarEndereco()}
            placeholder="Buscar endereço no mapa…"
          />
          <button onClick={buscarEndereco} disabled={buscando || !busca.trim()}>
            {buscando ? '…' : 'Buscar'}
          </button>
        </div>
      )}
      <div ref={div} className={css.mapa} />
      {pronto && !somenteLeitura && <p className={css.dicaMapa}>Arraste o pino ou clique no mapa para ajustar o ponto exato.</p>}
      {erro && pronto && <p className={css.erroBusca}>{erro}</p>}
    </div>
  );
}
