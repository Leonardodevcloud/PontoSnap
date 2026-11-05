import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export interface Mensagem { papel: 'user' | 'assistant'; conteudo: string }
export interface PedidoTexto {
  sistema: string;
  mensagens: Mensagem[];
  json?: boolean;
  temperatura?: number;
  maxTokens?: number;
  /** DeepSeek: "desligado" para respostas rápidas; "baixo"/"alto" para análises. */
  raciocinio?: 'desligado' | 'baixo' | 'alto';
}

/**
 * Cliente para a API do DeepSeek (compatível com OpenAI). Trocar de provedor é
 * trocar DEEPSEEK_BASE_URL e DEEPSEEK_MODELO (ex.: para a OpenAI).
 */
@Injectable()
export class DeepSeekService {
  private readonly baseUrl = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '');
  private readonly modelo = process.env.DEEPSEEK_MODELO ?? 'deepseek-chat';
  private readonly chave = process.env.DEEPSEEK_CHAVE ?? '';

  get ativo(): boolean { return !!this.chave; }

  async gerar(p: PedidoTexto): Promise<string> {
    if (!this.chave) throw new ServiceUnavailableException('A IA do Argos não está ligada (falta DEEPSEEK_CHAVE).');
    const deepseek = /deepseek/i.test(this.baseUrl);
    const corpo: Record<string, unknown> = {
      model: this.modelo,
      messages: [{ role: 'system', content: p.sistema }, ...p.mensagens.map((m) => ({ role: m.papel, content: m.conteudo }))],
      temperature: p.temperatura ?? 0.2,
      max_tokens: p.maxTokens ?? 1500,
      ...(p.json ? { response_format: { type: 'json_object' } } : {}),
    };
    if (deepseek && p.raciocinio === 'desligado') corpo.thinking = { type: 'disabled' };
    else if (deepseek && p.raciocinio) Object.assign(corpo, { thinking: { type: 'enabled' }, reasoning_effort: p.raciocinio === 'baixo' ? 'low' : 'high' });

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 60_000);
    try {
      const r = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.chave}` },
        body: JSON.stringify(corpo),
        signal: ctrl.signal,
      });
      if (!r.ok) throw new ServiceUnavailableException(`A IA respondeu com erro ${r.status}. Tente de novo em instantes.`);
      const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
      return j.choices?.[0]?.message?.content ?? '';
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
      throw new ServiceUnavailableException('Não consegui falar com a IA agora. Tente de novo em instantes.');
    } finally {
      clearTimeout(t);
    }
  }
}
