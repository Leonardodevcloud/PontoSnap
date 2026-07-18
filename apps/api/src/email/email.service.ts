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
