/**
 * Captura a posição no momento da batida — e só nisso.
 *
 * Nunca em segundo plano, nunca em watch. Negar a permissão é cenário normal:
 * devolve null e o ponto é registrado do mesmo jeito. O direito de bater ponto
 * não depende de GPS.
 */
export interface Posicao {
  latitude: number;
  longitude: number;
  precisao: number;
}

export type ResultadoGeo =
  | { estado: 'ok'; posicao: Posicao }
  | { estado: 'negada' }
  | { estado: 'indisponivel' };

export async function capturarPosicao(timeoutMs = 8000): Promise<ResultadoGeo> {
  if (!('geolocation' in navigator)) return { estado: 'indisponivel' };

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({
        estado: 'ok',
        posicao: {
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          precisao: Math.round(p.coords.accuracy),
        },
      }),
      (e) => resolve(e.code === e.PERMISSION_DENIED ? { estado: 'negada' } : { estado: 'indisponivel' }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}
