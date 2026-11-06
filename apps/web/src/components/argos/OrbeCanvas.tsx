import { useEffect, useRef } from 'react';

export type FaseOrbe = 'pronto' | 'ouvindo' | 'transcrevendo' | 'pensando' | 'falando' | 'erro';

const COR: Record<FaseOrbe, [number, number, number]> = {
  pronto: [91, 139, 255],
  ouvindo: [75, 212, 154],
  transcrevendo: [134, 169, 255],
  pensando: [124, 92, 255],
  falando: [91, 139, 255],
  erro: [255, 123, 112],
};

/** Pontos distribuídos numa esfera (espiral de Fibonacci). */
function pontosEsfera(n: number): [number, number, number][] {
  const pts: [number, number, number][] = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = phi * i;
    pts.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }
  return pts;
}

/** Esfera de partículas do Argos — reage ao estado e ao volume (voz/fala). */
export function OrbeCanvas({ size, fase, nivel }: { size: number; fase: FaseOrbe; nivel: () => number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const faseRef = useRef(fase); faseRef.current = fase;
  const nivelRef = useRef(nivel); nivelRef.current = nivel;

  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = size * dpr; cv.height = size * dpr;
    ctx.scale(dpr, dpr);
    const n = size >= 110 ? 520 : 240;
    const pts = pontosEsfera(n);
    const cx = size / 2, cy = size / 2;
    let raf = 0; let t = 0; let nivelSuave = 0;

    const frame = () => {
      t += 0.016;
      const f = faseRef.current;
      const alvo = f === 'ouvindo' || f === 'falando' ? Math.min(1, Math.max(0, nivelRef.current())) : 0;
      nivelSuave += (alvo - nivelSuave) * 0.2;
      const [r, g, b] = COR[f];
      const girar = f === 'pensando' ? 0.9 : f === 'falando' ? 0.5 : 0.28;
      const respira = 1 + Math.sin(t * 1.6) * 0.04;
      const R = size * 0.40 * respira * (1 + nivelSuave * 0.28);
      const ry = t * girar;
      const rx = 0.42 + Math.sin(t * 0.35) * 0.12;
      const cosY = Math.cos(ry), sinY = Math.sin(ry), cosX = Math.cos(rx), sinX = Math.sin(rx);

      ctx.clearRect(0, 0, size, size);
      ctx.globalCompositeOperation = 'lighter';
      for (const [px, py, pz] of pts) {
        // rotação Y
        let x = px * cosY - pz * sinY;
        let z = px * sinY + pz * cosY;
        let y = py;
        // inclinação X
        const y2 = y * cosX - z * sinX;
        const z2 = y * sinX + z * cosX;
        y = y2; z = z2;
        const persp = 1 / (2.2 - z);
        const sx = cx + x * R * persp;
        const sy = cy + y * R * persp;
        const prof = (z + 1) / 2;
        const alpha = (0.12 + prof * 0.6) * (f === 'pronto' ? 0.7 : 1);
        const rp = (size >= 110 ? 1.4 : 1.8) * persp * (1 + nivelSuave * 0.5);
        ctx.beginPath();
        ctx.arc(sx, sy, rp, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return <canvas ref={ref} width={size} height={size} style={{ width: size, height: size, display: 'block' }} aria-hidden="true" />;
}
