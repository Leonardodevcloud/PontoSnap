// Carregador do Google Maps JavaScript API.
//
// A chave vem de VITE_GOOGLE_MAPS_KEY (definida no Vercel). É exposta ao
// navegador — isso é normal para a Maps JS API; a proteção real é a restrição
// de domínio/API configurada no Google Cloud Console. Sem a chave, temMapa()
// devolve false e a tela cai no modo manual (campos de lat/lon).

const KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined;

export function temMapa(): boolean {
  return typeof KEY === 'string' && KEY.length > 0;
}

// Tipos mínimos que usamos, sem puxar @types/google.maps.
type GMaps = {
  maps: {
    Map: new (el: HTMLElement, opts: unknown) => GMap;
    Marker: new (opts: unknown) => GMarker;
    Circle: new (opts: unknown) => GCircle;
    Geocoder: new () => GGeocoder;
    LatLng: new (lat: number, lng: number) => unknown;
    event: { addListener: (obj: unknown, ev: string, cb: (e: GMapMouseEvent) => void) => void };
    Animation: { DROP: unknown };
  };
};
export type GMapMouseEvent = { latLng?: { lat: () => number; lng: () => number } };
export type GMap = { setCenter: (p: unknown) => void; setZoom: (z: number) => void; getZoom: () => number };
export type GMarker = {
  setPosition: (p: { lat: number; lng: number }) => void;
  getPosition: () => { lat: () => number; lng: () => number } | undefined;
};
export type GCircle = {
  setcenter: (p: { lat: number; lng: number }) => void;
  setRadius: (m: number) => void;
  setMap: (m: GMap | null) => void;
};
export type GGeocoder = {
  geocode: (
    req: { address?: string; location?: { lat: number; lng: number } },
    cb: (results: GGeoResult[] | null, status: string) => void,
  ) => void;
};
export type GGeoResult = {
  formatted_address: string;
  geometry: { location: { lat: () => number; lng: () => number } };
};

declare global {
  interface Window { google?: GMaps; __gmapsPromise?: Promise<GMaps>; }
}

/** Carrega o script do Maps uma única vez e resolve quando pronto. */
export function carregarMaps(): Promise<GMaps> {
  if (!temMapa()) return Promise.reject(new Error('Sem chave do Google Maps'));
  if (window.google?.maps) return Promise.resolve(window.google);
  if (window.__gmapsPromise) return window.__gmapsPromise;

  window.__gmapsPromise = new Promise<GMaps>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY!)}&language=pt-BR&region=BR`;
    s.async = true;
    s.defer = true;
    s.onload = () => {
      if (window.google?.maps) resolve(window.google);
      else reject(new Error('Maps carregou mas google.maps não existe'));
    };
    s.onerror = () => reject(new Error('Falha ao carregar o Google Maps'));
    document.head.appendChild(s);
  });
  return window.__gmapsPromise;
}
