/** Ponto geográfico em graus decimais. */
export interface Coordenada {
  latitude: number;
  longitude: number;
}

/**
 * Distância em metros entre duas coordenadas (fórmula de haversine).
 *
 * Precisão de sobra para o uso aqui: decidir se a batida saiu de perto do
 * estabelecimento. Não serve para navegação.
 */
export function distanciaMetros(a: Coordenada, b: Coordenada): number {
  const R = 6_371_000; // raio médio da Terra, em metros
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const lat1 = rad(a.latitude);
  const lat2 = rad(b.latitude);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * Diz se a batida saiu de fora do raio do estabelecimento.
 * Sem local cadastrado ou sem raio, nunca é "fora" — a empresa pode ser
 * 100% remota, e nesse caso a pergunta não faz sentido.
 */
export function foraDoRaio(
  local: (Coordenada & { raioMetros: number | null }) | null,
  batida: Coordenada | null,
): { fora: boolean; distancia: number | null } {
  if (!local || local.raioMetros == null || !batida) return { fora: false, distancia: null };
  const d = distanciaMetros(local, batida);
  return { fora: d > local.raioMetros, distancia: d };
}
