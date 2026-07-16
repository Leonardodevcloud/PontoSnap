/**
 * Comprime a foto no aparelho antes de enviar.
 *
 * É isto que torna guardar arquivo no Postgres uma boa ideia: foto de celular
 * hoje sai com 4–8 MB; reduzida para 1600px e JPEG 82% cai para ~300 KB sem
 * perder a legibilidade de um atestado. Cem vezes menos banco, menos backup,
 * e upload que funciona no 3G do vestiário.
 *
 * PDF passa direto — já vem pequeno e comprimir quebraria o arquivo.
 */
const LADO_MAX = 1600;
const QUALIDADE = 0.82;

export interface ArquivoPronto {
  base64: string;
  nome: string;
  mime: string;
  bytes: number;
}

const paraBase64 = (blob: Blob): Promise<string> =>
  new Promise((ok, erro) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] ?? '');
    r.onerror = () => erro(new Error('Não consegui ler o arquivo'));
    r.readAsDataURL(blob);
  });

export async function prepararArquivo(file: File): Promise<ArquivoPronto> {
  if (file.type === 'application/pdf') {
    return { base64: await paraBase64(file), nome: file.name, mime: file.type, bytes: file.size };
  }
  if (!file.type.startsWith('image/')) {
    throw new Error('Envie uma foto ou um PDF');
  }

  const bitmap = await createImageBitmap(file);
  const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * escala);
  const h = Math.round(bitmap.height * escala);

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Não consegui processar a imagem');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', QUALIDADE));
  if (!blob) throw new Error('Não consegui comprimir a imagem');

  const nome = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return { base64: await paraBase64(blob), nome, mime: 'image/jpeg', bytes: blob.size };
}
