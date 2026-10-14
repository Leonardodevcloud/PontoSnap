import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Caricatura, hash } from '../components/Avatar';
import css from './AtualizacaoCadastral.module.css';

/** O que o app sabe do cadastro do funcionário (GET /cadastro/meu). */
export interface MeuCadastro {
  nome: string; cpf: string;
  celular: string | null; emailPessoal: string | null; contatoEmergencia: string | null;
  cadastroAtualizadoEm: string | null;
  foto: { status: 'REVISAR' | 'APROVADA' | 'RECUSADA'; motivo: string | null; miniatura: string; enviadaEm: string } | null;
  avatarSemente: number | null;
  precisaAtualizar: boolean;
}

type Passo = 'aviso' | 'dicas' | 'camera' | 'conferir' | 'dados' | 'pronto';
const fmtCpf = (c: string) => c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');

/** Brilho médio (0–255) de uma área da imagem. */
function brilho(fonte: CanvasImageSource, sx: number, sy: number, sw: number, sh: number): number {
  const c = document.createElement('canvas'); c.width = 24; c.height = 24;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(fonte, sx, sy, sw, sh, 0, 0, 24, 24);
  const d = g.getImageData(0, 0, 24, 24).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
  return s / (d.length / 4);
}

/** Detector de rosto do navegador, quando existe (Chrome Android). Sem ele, só conferimos a luz. */
type Detector = { detect: (s: CanvasImageSource) => Promise<{ boundingBox: DOMRectReadOnly }[]> };
function criarDetector(): Detector | null {
  const FD = (window as unknown as { FaceDetector?: new (o: object) => Detector }).FaceDetector;
  try { return FD ? new FD({ fastMode: true, maxDetectedFaces: 3 }) : null; } catch { return null; }
}

interface Recorte { img: HTMLImageElement | HTMLCanvasElement; w: number; h: number; zoom: number; dx: number; dy: number; origem: 'CAMERA' | 'GALERIA' }

/** Desenha o recorte quadrado (o que aparece no círculo) num canvas do tamanho pedido. */
function renderizar(r: Recorte, lado: number): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = lado; c.height = lado;
  const g = c.getContext('2d')!;
  const base = Math.min(r.w, r.h) / r.zoom;          // lado do quadrado na imagem original
  const cx = r.w / 2 - r.dx * base, cy = r.h / 2 - r.dy * base;
  g.imageSmoothingQuality = 'high';
  g.drawImage(r.img, cx - base / 2, cy - base / 2, base, base, 0, 0, lado, lado);
  return c;
}

/**
 * Atualização cadastral obrigatória: foto (câmera ou galeria) + conferir
 * contatos. Também serve para trocar a foto depois (modo "trocar").
 */
export function AtualizacaoCadastral({ meu, modo = 'obrigatorio', onConcluir, onCancelar }: {
  meu: MeuCadastro; modo?: 'obrigatorio' | 'trocar'; onConcluir: (m: MeuCadastro) => void; onCancelar?: () => void;
}) {
  const [passo, setPasso] = useState<Passo>(modo === 'trocar' ? 'dicas' : 'aviso');
  const [recorte, setRecorte] = useState<Recorte | null>(null);
  const [celular, setCelular] = useState(meu.celular ?? '');
  const [email, setEmail] = useState(meu.emailPessoal ?? '');
  const [emergencia, setEmergencia] = useState(meu.contatoEmergencia ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [final, setFinal] = useState<MeuCadastro | null>(null);
  const galeria = useRef<HTMLInputElement>(null);
  const primeiro = meu.nome.split(' ')[0];
  const recusada = meu.foto?.status === 'RECUSADA';

  function abrirGaleria() { setErro(null); galeria.current?.click(); }
  function lerArquivo(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith('image/')) { setErro('Escolha uma imagem (foto).'); return; }
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => { setRecorte({ img, w: img.naturalWidth, h: img.naturalHeight, zoom: 1, dx: 0, dy: 0, origem: 'GALERIA' }); setPasso('conferir'); };
    img.onerror = () => setErro('Não deu para abrir essa imagem. Tente outra ou tire uma foto agora.');
    img.src = url;
  }

  async function salvar() {
    if (!recorte) { setPasso('dicas'); return; }
    setSalvando(true); setErro(null);
    try {
      const foto = renderizar(recorte, 320).toDataURL('image/jpeg', 0.86).split(',')[1];
      const miniatura = renderizar(recorte, 96).toDataURL('image/jpeg', 0.8).split(',')[1];
      const r = await api.put<MeuCadastro>('/cadastro/meu', { foto, miniatura, origem: recorte.origem, celular, emailPessoal: email, contatoEmergencia: emergencia });
      setFinal(r); setPasso('pronto');
    } catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  }

  const progresso = passo === 'aviso' ? 0 : passo === 'dados' ? 2 : passo === 'pronto' ? 3 : 1;
  return (
    <div className={css.tela}>
      <input ref={galeria} type="file" accept="image/*" hidden onChange={(e) => { lerArquivo(e.target.files?.[0]); e.target.value = ''; }} />
      {passo !== 'camera' && (
        <div className={css.passos} aria-hidden="true">{[1, 2, 3].map((i) => <i key={i} className={progresso >= i ? css.on : ''} />)}</div>
      )}

      {passo === 'aviso' && (
        <section className={css.sec}>
          <p className={css.eyebrow}>Atualização cadastral</p>
          <h1>{recusada ? 'O RH pediu outra foto' : 'Antes de bater o ponto, sua foto'}</h1>
          <p className={css.lead}>{recusada ? `Motivo: ${meu.foto?.motivo ?? 'a foto não ficou boa'}. Leva 1 minuto.` : 'Leva 1 minuto. Só precisa fazer uma vez.'}</p>
          <div className={css.heroi} aria-hidden="true">
            <span className={css.heroiAv}><Caricatura semente={hash(`${meu.cpf}a`)} /></span>
            <span className={`${css.heroiAv} ${css.heroiVazio}`}>+</span>
            <span className={css.heroiAv}><Caricatura semente={hash(`${meu.cpf}b`)} /></span>
          </div>
          <div className={css.porque}>
            <div><span className={css.ic}>👤</span><p><b>Seu rosto no lugar do desenho</b><span>O RH e a equipe reconhecem você mais rápido.</span></p></div>
            <div><span className={css.ic}>✓</span><p><b>Confere seus dados</b><span>Celular e e-mail, para o RH conseguir falar com você.</span></p></div>
          </div>
          <div className={css.pilha}>
            <button className={css.pri} onClick={() => setPasso('dicas')}>Começar</button>
            <p className={css.privado}>A foto fica no sistema da empresa e só aparece para o RH e para você. Não é usada para reconhecimento facial.</p>
          </div>
        </section>
      )}

      {passo === 'dicas' && (
        <section className={css.sec}>
          <p className={css.eyebrow}>Passo 1 de 3 · Foto</p>
          <h1>Como fica uma boa foto</h1>
          <div className={css.dicas}>
            <div className={css.dica}><span className={`${css.selo} ${css.sim}`}>✓</span><span className={css.miniAv}><Caricatura semente={7} /></span><b>Assim</b><small>de frente, luz no rosto, pode sorrir 😄</small></div>
            <div className={css.dica}><span className={`${css.selo} ${css.nao}`}>✕</span><span className={`${css.miniAv} ${css.escura}`}><Caricatura semente={7} /></span><b>Assim não</b><small>escura, de óculos escuros ou boné</small></div>
          </div>
          <ul className={css.regras}>
            <li>Rosto e ombros dentro do círculo, olhando para a câmera.</li>
            <li>Fique de frente para uma janela ou luz. Evite luz atrás de você.</li>
            <li>Fundo liso, sem outras pessoas na foto.</li>
            <li>Sem boné, chapéu ou óculos escuros. Óculos de grau pode.</li>
            <li><span className={css.sorria}>Pode sorrir!</span> É a foto que a equipe vai ver.</li>
          </ul>
          {erro && <p className={css.erro} role="alert">{erro}</p>}
          <div className={css.pilha}>
            <button className={css.pri} onClick={() => { setErro(null); setPasso('camera'); }}>📷 Tirar foto agora</button>
            <button className={css.sec2} onClick={abrirGaleria}>🖼 Escolher da galeria</button>
            {modo === 'trocar' && onCancelar && <button className={css.ter} onClick={onCancelar}>Cancelar</button>}
          </div>
        </section>
      )}

      {passo === 'camera' && (
        <Camera onFoto={(c) => { setRecorte({ img: c, w: c.width, h: c.height, zoom: 1, dx: 0, dy: 0, origem: 'CAMERA' }); setPasso('conferir'); }}
          onGaleria={abrirGaleria} onVoltar={() => setPasso('dicas')}
          onFalha={(m) => { setErro(m); setPasso('dicas'); }} />
      )}

      {passo === 'conferir' && recorte && (
        <Conferir recorte={recorte} onMudar={setRecorte} onOutra={() => setPasso(recorte.origem === 'CAMERA' ? 'camera' : 'dicas')}
          onUsar={() => setPasso('dados')} />
      )}

      {passo === 'dados' && (
        <section className={css.sec}>
          <p className={css.eyebrow}>Passo 2 de 3 · Seus dados</p>
          <h1>Confira seus dados</h1>
          <p className={css.lead}>Nome e CPF vêm da empresa. Se estiver errado, avise o RH.</p>
          <div className={css.trava}><b>{meu.nome}</b><span>nome</span></div>
          <div className={css.trava}><b>{fmtCpf(meu.cpf)}</b><span>CPF</span></div>
          <label className={css.campo}><span>Celular (WhatsApp)</span>
            <input value={celular} onChange={(e) => setCelular(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="(71) 98812-3344" />
            <small>Para o RH falar com você sobre ponto e benefícios.</small></label>
          <label className={css.campo}><span>E-mail pessoal</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" placeholder="nome@gmail.com" />
            <small>Usado para recuperar a senha.</small></label>
          <label className={css.campo}><span>Contato de emergência (opcional)</span>
            <input value={emergencia} onChange={(e) => setEmergencia(e.target.value)} placeholder="Nome e telefone" /></label>
          {erro && <p className={css.erro} role="alert">{erro}</p>}
          <div className={css.pilha}>
            <button className={css.pri} onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar e continuar'}</button>
            <button className={css.ter} onClick={() => setPasso('conferir')} disabled={salvando}>Voltar para a foto</button>
          </div>
        </section>
      )}

      {passo === 'pronto' && final && (
        <section className={css.sec}>
          <div className={css.pronto}>
            <div className={css.prontoFoto}><img src={final.foto?.miniatura} alt="Sua foto" /><span>✓</span></div>
            <h1>Tudo certo, {primeiro}!</h1>
            <p className={css.lead}>{modo === 'trocar' ? 'Foto atualizada.' : 'Cadastro atualizado. Agora é só bater o ponto.'}</p>
          </div>
          <div className={css.pilha}>
            <button className={css.pri} onClick={() => onConcluir(final)} data-autofoco>{modo === 'trocar' ? 'Voltar' : 'Ir para o ponto'}</button>
            <p className={css.privado}>Quer trocar a foto depois? Menu › Minha foto e dados.</p>
          </div>
        </section>
      )}
    </div>
  );
}

/** Câmera frontal com moldura e dicas ao vivo (luz e, quando o navegador permite, rosto). */
function Camera({ onFoto, onGaleria, onVoltar, onFalha }: {
  onFoto: (c: HTMLCanvasElement) => void; onGaleria: () => void; onVoltar: () => void; onFalha: (m: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [dica, setDica] = useState<{ t: string; ok: boolean }>({ t: 'Abrindo a câmera…', ok: false });
  const [checks, setChecks] = useState<{ luz: boolean | null; rosto: boolean | null; um: boolean | null }>({ luz: null, rosto: null, um: null });
  const [frente, setFrente] = useState(true);
  const stream = useRef<MediaStream | null>(null);
  const detector = useRef<Detector | null>(criarDetector());
  const falha = useRef(onFalha);
  falha.current = onFalha;

  const parar = useCallback(() => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { falha.current('Este navegador não abre a câmera. Escolha uma foto da galeria.'); return; }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: frente ? 'user' : 'environment', width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false });
        if (!vivo) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => {}); }
      } catch (e) {
        const nome = (e as Error).name;
        falha.current(nome === 'NotAllowedError' ? 'A câmera foi bloqueada. Libere nas configurações do navegador ou escolha uma foto da galeria.' : 'Não deu para abrir a câmera. Escolha uma foto da galeria.');
      }
    })();
    return () => { vivo = false; parar(); };
  }, [frente, parar]);

  // Dicas ao vivo, a cada ~0,5 s.
  useEffect(() => {
    let parado = false;
    const t = setInterval(async () => {
      const v = video.current;
      if (parado || !v || v.readyState < 2 || !v.videoWidth) return;
      const lado = Math.min(v.videoWidth, v.videoHeight);
      const b = brilho(v, (v.videoWidth - lado) / 2 + lado * 0.25, (v.videoHeight - lado) / 2 + lado * 0.15, lado * 0.5, lado * 0.6);
      const luz = b > 70 && b < 230;
      let rosto: boolean | null = null, um: boolean | null = null, perto = true;
      if (detector.current) {
        try {
          const fs = await detector.current.detect(v);
          um = fs.length <= 1; rosto = fs.length >= 1;
          if (fs[0]) perto = fs[0].boundingBox.width > lado * 0.28;
        } catch { detector.current = null; }
      }
      setChecks({ luz, rosto, um });
      if (!luz) setDica({ t: b <= 70 ? 'Pouca luz: vire para a janela' : 'Luz forte demais: saia do sol direto', ok: false });
      else if (rosto === false) setDica({ t: 'Coloque o rosto dentro do oval', ok: false });
      else if (um === false) setDica({ t: 'Só você na foto', ok: false });
      else if (!perto) setDica({ t: 'Aproxime um pouco o rosto', ok: false });
      else setDica({ t: detector.current ? 'Perfeito! Pode sorrir 😄' : 'Boa luz. Centralize o rosto e sorria 😄', ok: true });
    }, 500);
    return () => { parado = true; clearInterval(t); };
  }, []);

  function disparar() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const lado = Math.min(v.videoWidth, v.videoHeight);
    const c = document.createElement('canvas'); c.width = lado; c.height = lado;
    const g = c.getContext('2d')!;
    // Selfie: a pré-visualização é espelhada; a foto salva também, como a pessoa se viu.
    if (frente) { g.translate(lado, 0); g.scale(-1, 1); }
    g.drawImage(v, (v.videoWidth - lado) / 2, (v.videoHeight - lado) / 2, lado, lado, 0, 0, lado, lado);
    parar();
    onFoto(c);
  }

  return (
    <section className={css.cam}>
      <div className={css.camTopo}>
        <button onClick={() => { parar(); onVoltar(); }} aria-label="Voltar">←</button>
        <span>Centralize o rosto</span>
        <span style={{ width: 44 }} />
      </div>
      <div className={css.visor}>
        <video ref={video} playsInline muted autoPlay className={`${css.video} ${frente ? css.espelho : ''}`} />
        <div className={css.oval} aria-hidden="true" />
        <div className={`${css.camDica} ${dica.ok ? css.camDicaOk : ''}`} role="status" aria-live="polite">{dica.t}</div>
        <div className={css.checks}>
          {checks.rosto !== null && <span className={checks.rosto ? css.chOk : ''}>rosto no oval</span>}
          {checks.luz !== null && <span className={checks.luz ? css.chOk : ''}>boa luz</span>}
          {checks.um !== null && <span className={checks.um ? css.chOk : ''}>só você</span>}
        </div>
      </div>
      <div className={css.camBase}>
        <button className={css.galeria} onClick={() => { parar(); onGaleria(); }}><i aria-hidden="true">🖼</i>Galeria</button>
        <button className={css.disparo} onClick={disparar} aria-label="Tirar foto" />
        <button className={css.virar} onClick={() => setFrente((f) => !f)} aria-label="Virar câmera">⟲</button>
      </div>
    </section>
  );
}

/** Ajuste do enquadramento (zoom e arrastar) e conferência antes de usar. */
function Conferir({ recorte, onMudar, onOutra, onUsar }: { recorte: Recorte; onMudar: (r: Recorte) => void; onOutra: () => void; onUsar: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const arrasto = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const [verif, setVerif] = useState<{ luz: boolean; rosto: boolean | null; um: boolean | null } | null>(null);

  useEffect(() => {
    const c = canvas.current; if (!c) return;
    const r = renderizar(recorte, 400);
    c.getContext('2d')!.drawImage(r, 0, 0);
  }, [recorte]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const r = renderizar(recorte, 320);
      const b = brilho(r, 80, 50, 160, 200);
      let rosto: boolean | null = null, um: boolean | null = null;
      const d = criarDetector();
      if (d) { try { const fs = await d.detect(r); rosto = fs.length >= 1; um = fs.length <= 1; } catch { /* sem detector */ } }
      if (vivo) setVerif({ luz: b > 70 && b < 230, rosto, um });
    })();
    return () => { vivo = false; };
  }, [recorte]);

  const limitar = (v: number, z: number) => { const m = (1 - 1 / z) / 2 + 0.02; return Math.max(-m, Math.min(m, v)); };
  function mover(ev: React.PointerEvent) {
    const a = arrasto.current; if (!a) return;
    const lado = (ev.currentTarget as HTMLElement).clientWidth;
    const dx = limitar(a.dx + (ev.clientX - a.x) / lado / recorte.zoom, recorte.zoom);
    const dy = limitar(a.dy + (ev.clientY - a.y) / lado / recorte.zoom, recorte.zoom);
    onMudar({ ...recorte, dx, dy });
  }

  return (
    <section className={css.sec}>
      <p className={css.eyebrow}>Passo 1 de 3 · Foto</p>
      <h1>Ficou boa?</h1>
      <div className={css.previa}>
        <canvas ref={canvas} width={400} height={400} className={css.recorte} aria-label="Sua foto, arraste para ajustar"
          onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); arrasto.current = { x: e.clientX, y: e.clientY, dx: recorte.dx, dy: recorte.dy }; }}
          onPointerMove={mover} onPointerUp={() => { arrasto.current = null; }} />
        <label className={css.zoom}><span aria-hidden="true">−</span>
          <input type="range" min={1} max={3} step={0.05} value={recorte.zoom} aria-label="Aproximar"
            onChange={(e) => { const z = Number(e.target.value); onMudar({ ...recorte, zoom: z, dx: limitar(recorte.dx, z), dy: limitar(recorte.dy, z) }); }} />
          <span aria-hidden="true">+</span></label>
        <small className={css.mudo}>Arraste a foto para ajustar o enquadramento</small>
      </div>
      <div className={css.verif}>
        {!verif && <div>Conferindo a foto…</div>}
        {verif && <div><b className={verif.luz ? css.vOk : css.vAv}>{verif.luz ? '✓' : '!'}</b>{verif.luz ? 'Boa iluminação' : 'Foto escura ou estourada: tente com mais luz no rosto'}</div>}
        {verif?.rosto != null && <div><b className={verif.rosto ? css.vOk : css.vAv}>{verif.rosto ? '✓' : '!'}</b>{verif.rosto ? 'Rosto encontrado' : 'Não achamos um rosto: centralize e aproxime'}</div>}
        {verif?.um != null && <div><b className={verif.um ? css.vOk : css.vAv}>{verif.um ? '✓' : '!'}</b>{verif.um ? 'Só uma pessoa' : 'Tem mais de uma pessoa na foto'}</div>}
        {verif && verif.rosto == null && <div><b className={css.vInfo}>i</b>Confira: rosto de frente, sem óculos escuros ou boné</div>}
      </div>
      <div className={css.pilha}>
        <button className={css.pri} onClick={onUsar}>Usar esta foto</button>
        <button className={css.ter} onClick={onOutra}>{recorte.origem === 'CAMERA' ? 'Tirar outra' : 'Escolher outra'}</button>
      </div>
    </section>
  );
}
