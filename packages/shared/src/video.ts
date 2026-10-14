/**
 * Vídeo por link na comunicação interna: reconhece YouTube, Vimeo e Google
 * Drive e devolve o endereço do player embutido (toca dentro do app).
 */
export type ProvedorVideo = 'YOUTUBE' | 'VIMEO' | 'DRIVE';
export interface VideoReconhecido { provedor: ProvedorVideo; videoId: string; embed: string; miniatura: string | null }

export function reconhecerVideo(urlBruta: string): VideoReconhecido | null {
  const texto = (urlBruta ?? '').trim();
  if (!texto) return null;
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(texto) ? texto : `https://${texto}`); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, '').toLowerCase();
  const partes = u.pathname.split('/').filter(Boolean);

  let yt: string | null = null;
  if (host === 'youtu.be') yt = partes[0] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
    if (u.searchParams.get('v')) yt = u.searchParams.get('v');
    else if (['shorts', 'embed', 'live', 'v'].includes(partes[0] ?? '')) yt = partes[1] ?? null;
  }
  if (yt && /^[\w-]{6,20}$/.test(yt)) {
    return { provedor: 'YOUTUBE', videoId: yt, embed: `https://www.youtube-nocookie.com/embed/${yt}?rel=0&playsinline=1`, miniatura: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` };
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = partes.find((p) => /^\d{5,}$/.test(p));
    if (id) return { provedor: 'VIMEO', videoId: id, embed: `https://player.vimeo.com/video/${id}?playsinline=1`, miniatura: null };
  }

  if (host === 'drive.google.com') {
    const i = partes.indexOf('d');
    const id = (i >= 0 ? partes[i + 1] : null) ?? u.searchParams.get('id');
    if (id && /^[\w-]{10,}$/.test(id)) return { provedor: 'DRIVE', videoId: id, embed: `https://drive.google.com/file/d/${id}/preview`, miniatura: null };
  }
  return null;
}

/** Endereço do player a partir do que ficou salvo no bloco. */
export function embedDoVideo(provedor: ProvedorVideo, videoId: string): string {
  if (provedor === 'YOUTUBE') return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&playsinline=1`;
  if (provedor === 'VIMEO') return `https://player.vimeo.com/video/${videoId}?playsinline=1`;
  return `https://drive.google.com/file/d/${videoId}/preview`;
}
