import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

export interface Email {
  para: string;
  assunto: string;
  html: string;
}

/**
 * Envio de e-mail transacional via Resend.
 *
 * Sem RESEND_API_KEY, cai em modo LOG: registra o e-mail no console em vez de
 * enviar. Isso deixa dev e testes rodarem sem credencial, e produção só liga o
 * envio de verdade quando a key existe. Falha de envio nunca derruba a ação que
 * pediu o e-mail — no máximo o usuário não recebe e tenta de novo.
 */
@Injectable()
export class EmailService {
  private readonly log = new Logger('EmailService');
  private readonly resend: Resend | null;
  private readonly remetente: string;

  constructor() {
    const key = process.env.RESEND_API_KEY;
    this.resend = key ? new Resend(key) : null;
    // Domínio precisa estar verificado no painel do Resend. Antes disso,
    // 'onboarding@resend.dev' funciona só para o e-mail dono da conta (teste).
    this.remetente = process.env.EMAIL_REMETENTE ?? 'PontoSnap <onboarding@resend.dev>';
    if (!this.resend) {
      this.log.warn('RESEND_API_KEY ausente — e-mails vão para o log, não são enviados.');
    }
  }

  /** Tem chave do Resend (envia de verdade)? Sem ela, só registra no log. */
  get ativo(): boolean { return !!this.resend; }
  get de(): string { return this.remetente; }

  /** Envia e devolve o motivo da recusa (para o teste de e-mail do painel). */
  async enviarComDetalhe(e: Email): Promise<{ ok: boolean; erro: string | null; id: string | null }> {
    if (!this.resend) return { ok: false, erro: 'RESEND_API_KEY não está configurada no servidor da API.', id: null };
    try {
      const { data, error } = await this.resend.emails.send({ from: this.remetente, to: e.para, subject: e.assunto, html: e.html });
      if (error) { this.log.error(`Resend recusou para ${e.para}: ${error.message}`); return { ok: false, erro: error.message, id: null }; }
      return { ok: true, erro: null, id: data?.id ?? null };
    } catch (err) {
      return { ok: false, erro: (err as Error).message, id: null };
    }
  }

  /** Envia. Devolve true se saiu (ou foi logado), false em erro de envio. */
  async enviar(e: Email): Promise<boolean> {
    if (!this.resend) {
      this.log.log(`[EMAIL-LOG] para=${e.para} assunto="${e.assunto}"`);
      return true;
    }
    try {
      const { error } = await this.resend.emails.send({
        from: this.remetente, to: e.para, subject: e.assunto, html: e.html,
      });
      if (error) {
        this.log.error(`Resend recusou para ${e.para}: ${error.message}`);
        return false;
      }
      return true;
    } catch (err) {
      this.log.error(`Falha ao enviar para ${e.para}: ${(err as Error).message}`);
      return false;
    }
  }
}
