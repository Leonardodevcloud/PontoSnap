import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Readable } from 'node:stream';

/**
 * Voz da Pri: transcrição (Groq Whisper) e fala (OpenAI gpt-4o-mini-tts).
 * Ambas por chave própria; sem a chave, o recurso fica desligado e a interface
 * cai para a voz do navegador (na fala) ou só texto.
 */
@Injectable()
export class VozArgosService {
  private readonly groqChave = process.env.GROQ_CHAVE ?? '';
  private readonly groqModelo = process.env.GROQ_MODELO ?? 'whisper-large-v3-turbo';
  private readonly groqBase = (process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1').replace(/\/$/, '');

  private readonly ttsChave = process.env.OPENAI_CHAVE ?? '';
  private readonly ttsModelo = process.env.OPENAI_TTS_MODELO ?? 'gpt-4o-mini-tts';
  private readonly ttsBase = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  private readonly voz = process.env.ARGOS_VOZ ?? 'coral';
  private readonly velocidade = Number(process.env.ARGOS_VELOCIDADE ?? '1.18');

  get transcricaoAtiva(): boolean { return !!this.groqChave; }
  get falaAtiva(): boolean { return !!this.ttsChave; }

  /** Áudio (base64) -> texto. Groq Whisper, compatível com a API da OpenAI. */
  async transcrever(audioBase64: string, mime: string): Promise<string> {
    if (!this.groqChave) throw new ServiceUnavailableException('Transcrição desligada (falta GROQ_CHAVE).');
    const tipo = (mime || 'audio/webm').split(';')[0]!.trim();
    const ext = ({ 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' } as Record<string, string>)[tipo] ?? 'webm';
    const buf = Buffer.from(audioBase64, 'base64');
    if (!buf.length) throw new ServiceUnavailableException('Áudio vazio.');

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buf)], { type: tipo }), `fala.${ext}`);
    form.append('model', this.groqModelo);
    form.append('language', 'pt');
    form.append('temperature', '0');
    // Vocabulário da casa ajuda o Whisper: termos de ponto, folha e nomes comuns.
    form.append('prompt', 'Argos, por que essa pessoa ficou com horas extras? Intervalo, atraso, DSR, falta, banco de horas, apuração, folha, contracheque. CLT, convenção, tolerância. Em outubro, em setembro, no mês passado.');

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const r = await fetch(`${this.groqBase}/audio/transcriptions`, {
        method: 'POST', headers: { authorization: `Bearer ${this.groqChave}` }, body: form, signal: ctrl.signal,
      });
      if (!r.ok) throw new ServiceUnavailableException(`A transcrição falhou (${r.status}).`);
      const j = (await r.json()) as { text?: string };
      return (j.text ?? '').trim();
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
      throw new ServiceUnavailableException('Não consegui transcrever o áudio agora.');
    } finally { clearTimeout(t); }
  }

  /** Texto -> fala (mp3 em base64). OpenAI gpt-4o-mini-tts. */
  async falar(texto: string): Promise<string> {
    const r = await this.pedirFala(texto);
    return Buffer.from(await r.arrayBuffer()).toString('base64');
  }

  /** Texto -> fala, entregue em fluxo (começa a tocar quase na hora). mp3. */
  async falarFluxo(texto: string): Promise<Readable> {
    const r = await this.pedirFala(texto);
    if (!r.body) return Readable.from(Buffer.from(await r.arrayBuffer()));
    return Readable.fromWeb(r.body as Parameters<typeof Readable.fromWeb>[0]);
  }

  private async pedirFala(texto: string): Promise<Response> {
    if (!this.ttsChave) throw new ServiceUnavailableException('Voz natural desligada (falta OPENAI_CHAVE).');
    const limpo = texto
      .replace(/\[[A-Z_]+-?[A-Z0-9_]*\]/g, '')
      .replace(/\[(\d+)\]/g, '')
      .replace(/[*_`>#|]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s+([.,;:!?])/g, '$1')
      .trim();
    if (!limpo) throw new ServiceUnavailableException('Nada para falar.');
    const corpo = {
      model: this.ttsModelo,
      voice: this.voz,
      input: limpo.slice(0, 1200),
      instructions:
        'Fale em português do Brasil, com sotaque brasileiro natural. Voz feminina, de uma colega de trabalho simpática e segura: ' +
        'calorosa, direta, conversada, nunca robótica nem de locutora. Ritmo ágil, frases fluidas, pausas curtas. ' +
        'Diga números e valores como uma pessoa diria ("três horas e doze minutos", "noventa e um por cento").',
      speed: this.velocidade,
      response_format: 'mp3',
    };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const r = await fetch(`${this.ttsBase}/audio/speech`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.ttsChave}` },
        body: JSON.stringify(corpo), signal: ctrl.signal,
      });
      if (!r.ok) throw new ServiceUnavailableException(`A voz falhou (${r.status}).`);
      clearTimeout(t);
      return r;
    } catch (e) {
      clearTimeout(t);
      if (e instanceof ServiceUnavailableException) throw e;
      throw new ServiceUnavailableException('Não consegui gerar a voz agora.');
    }
  }
}
