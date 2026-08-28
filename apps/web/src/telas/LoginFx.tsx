import { useEffect, useRef } from 'react';

// Cores da marca usadas nas estrelas/partículas/confete.
const CORAL = '#FF6B4A';
const LIME = '#CBF54D';
const PEACH = '#FFE2D1';

function prefereMenosMovimento() {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// Desenha uma estrela de 5 pontas centrada na origem do contexto.
function estrela5(g: CanvasRenderingContext2D, s: number) {
  g.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (i * 4 * Math.PI) / 5 - Math.PI / 2;
    g.lineTo(Math.cos(a) * s, Math.sin(a) * s);
  }
  g.closePath();
}

/**
 * Campo de estrelas flutuando no painel escuro, com leve parallax seguindo o
 * mouse. Puro canvas, sem dependências. Respeita prefers-reduced-motion (fica
 * estático). O componente pai deve ser position:relative.
 */
export function EstrelasCanvas() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const mouse = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pai = canvas.parentElement;
    if (!pai) return;

    const reduz = prefereMenosMovimento();
    type E = { x: number; y: number; s: number; vx: number; vy: number; r: number; vr: number; o: number; d: number; cor: string };
    let estrelas: E[] = [];
    let raf = 0;

    function dimensionar() {
      const r = pai!.getBoundingClientRect();
      canvas!.width = r.width;
      canvas!.height = r.height;
    }
    function popular() {
      const n = Math.min(28, Math.round((canvas!.width * canvas!.height) / 14000));
      estrelas = Array.from({ length: n }, () => ({
        x: Math.random() * canvas!.width,
        y: Math.random() * canvas!.height,
        s: Math.random() * 9 + 4,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r: Math.random() * 6.28,
        vr: (Math.random() - 0.5) * 0.018,
        o: Math.random() * 0.45 + 0.12,
        d: Math.random() * 2 + 1,
        cor: Math.random() > 0.5 ? CORAL : LIME,
      }));
    }

    function desenhar() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      for (const e of estrelas) {
        if (!reduz) {
          e.x += e.vx + mouse.current.x * e.d * 0.006;
          e.y += e.vy + mouse.current.y * e.d * 0.006;
          e.r += e.vr;
        }
        if (e.x < -24) e.x = canvas!.width + 24;
        if (e.x > canvas!.width + 24) e.x = -24;
        if (e.y < -24) e.y = canvas!.height + 24;
        if (e.y > canvas!.height + 24) e.y = -24;
        ctx!.save();
        ctx!.translate(e.x, e.y);
        ctx!.rotate(e.r);
        ctx!.globalAlpha = e.o;
        ctx!.fillStyle = e.cor;
        estrela5(ctx!, e.s);
        ctx!.fill();
        ctx!.restore();
      }
      if (!reduz) raf = requestAnimationFrame(desenhar);
    }

    function moverMouse(ev: MouseEvent) {
      const r = pai!.getBoundingClientRect();
      mouse.current.x = (ev.clientX - r.left - r.width / 2) / 20;
      mouse.current.y = (ev.clientY - r.top - r.height / 2) / 20;
    }

    dimensionar();
    popular();
    desenhar();
    pai.addEventListener('mousemove', moverMouse);
    const onResize = () => { dimensionar(); popular(); if (reduz) desenhar(); };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      pai.removeEventListener('mousemove', moverMouse);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: 0 }} />;
}

/**
 * Explosão de estrelinhas a partir de um ponto (x,y relativos ao canvas), usada
 * ao clicar em Entrar. Exponho um `dispararRef` que o pai chama com as coords.
 */
export function ParticulasCanvas({ dispararRef }: { dispararRef: React.MutableRefObject<((x: number, y: number) => void) | null> }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pai = canvas.parentElement;
    if (!pai) return;
    const reduz = prefereMenosMovimento();

    type P = { x: number; y: number; vx: number; vy: number; life: number; s: number; r: number; vr: number; c: string };
    let parts: P[] = [];
    let raf = 0;

    function dimensionar() {
      const r = pai!.getBoundingClientRect();
      canvas!.width = r.width;
      canvas!.height = r.height;
    }
    dimensionar();
    window.addEventListener('resize', dimensionar);

    function tick() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      parts = parts.filter((p) => p.life > 0);
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.18; p.life -= 0.02; p.r += p.vr;
        ctx!.save();
        ctx!.translate(p.x, p.y);
        ctx!.rotate(p.r);
        ctx!.globalAlpha = Math.max(0, p.life);
        ctx!.fillStyle = p.c;
        estrela5(ctx!, p.s);
        ctx!.fill();
        ctx!.restore();
      }
      raf = requestAnimationFrame(tick);
    }
    tick();

    dispararRef.current = (x: number, y: number) => {
      if (reduz) return;
      for (let i = 0; i < 24; i++) {
        const a = Math.random() * 6.28;
        const v = Math.random() * 5 + 2;
        parts.push({
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, life: 1,
          s: Math.random() * 7 + 3, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
          c: Math.random() > 0.5 ? CORAL : LIME,
        });
      }
    };

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', dimensionar);
      dispararRef.current = null;
    };
  }, [dispararRef]);

  return <canvas ref={ref} aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 50 }} />;
}

/** Confete caindo no overlay de sucesso. Roda enquanto `ativo` for true. */
export function ConfeteCanvas({ ativo }: { ativo: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!ativo) return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (prefereMenosMovimento()) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const cores = [CORAL, LIME, PEACH, '#FFFFFF'];
    type C = { x: number; y: number; vx: number; vy: number; s: number; r: number; vr: number; c: string };
    const confetes: C[] = Array.from({ length: 90 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * -canvas.height,
      vx: (Math.random() - 0.5) * 3,
      vy: Math.random() * 3 + 2,
      s: Math.random() * 8 + 4,
      r: Math.random() * 6,
      vr: (Math.random() - 0.5) * 0.4,
      c: cores[Math.floor(Math.random() * cores.length)]!,
    }));
    let raf = 0;
    function tick() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      for (const p of confetes) {
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx!.save();
        ctx!.translate(p.x, p.y);
        ctx!.rotate(p.r);
        ctx!.fillStyle = p.c;
        ctx!.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
        ctx!.restore();
      }
      raf = requestAnimationFrame(tick);
    }
    tick();
    return () => cancelAnimationFrame(raf);
  }, [ativo]);

  return <canvas ref={ref} aria-hidden="true" style={{ position: 'absolute', inset: 0 }} />;
}
